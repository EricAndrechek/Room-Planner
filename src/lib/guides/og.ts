/**
 * Build-time social cards (1200x630 PNG) for the guide pages: the guide's title next to its first
 * example plan. All text is converted to outlines (Inter, OFL, from @fontsource/inter) before
 * rasterizing, so the result doesn't depend on the fonts installed on the build machine.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import opentype, { type Font } from 'opentype.js';
import sharp from 'sharp';
import { sceneToSvg } from '../export/planSvg';
import type { PathCommand, Scene, SceneNode } from '../export/scene';
import { measureText } from '../export/fontMetrics';
import { examplesFor } from './examples';
import { findGuide } from './index';
import { exampleScene } from './render';

const W = 1200;
const H = 630;

const fonts = new Map<number, Font>();
const inter = (weight: 500 | 700 | 800): Font => {
  let font = fonts.get(weight);
  if (!font) {
    // From the project root (this module is bundled into Astro's build output, so not relative).
    const file = join(
      process.cwd(),
      `node_modules/@fontsource/inter/files/inter-latin-${weight}-normal.woff`,
    );
    const b = readFileSync(file);
    font = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    fonts.set(weight, font);
  }
  return font;
};

// Manual layout, glyph by glyph: opentype.js's text shaping chokes on Inter's GSUB lookups (as in
// brand/generate.mjs). Plain Latin text needs no ligatures; kerning is skipped.
const advance = (font: Font, text: string, size: number): number =>
  [...text].reduce((w, ch) => w + (font.charToGlyph(ch).advanceWidth ?? 0), 0) *
  (size / font.unitsPerEm);

/** Glyph outlines as scene path commands (quadratic curves raised to cubic). */
const outline = (font: Font, text: string, x: number, y: number, size: number): PathCommand[] => {
  const commands = [];
  let pen = x;
  for (const ch of text) {
    const glyph = font.charToGlyph(ch);
    commands.push(...glyph.getPath(pen, y, size).commands);
    pen += (glyph.advanceWidth ?? 0) * (size / font.unitsPerEm);
  }
  const out: PathCommand[] = [];
  let cx = 0;
  let cy = 0;
  for (const c of commands) {
    if (c.type === 'Z') {
      out.push(['Z']);
      continue;
    }
    const px = c.x!;
    const py = c.y!;
    if (c.type === 'M' || c.type === 'L') out.push([c.type, px, py]);
    else if (c.type === 'C') out.push(['C', c.x1!, c.y1!, c.x2!, c.y2!, px, py]);
    else {
      const q = { x: c.x1!, y: c.y1! };
      out.push([
        'C',
        cx + (2 / 3) * (q.x - cx),
        cy + (2 / 3) * (q.y - cy),
        px + (2 / 3) * (q.x - px),
        py + (2 / 3) * (q.y - py),
        px,
        py,
      ]);
    }
    cx = px;
    cy = py;
  }
  return out;
};

/** The plan with every label as outlines, sized to the width the export's layout measured. */
const outlinedScene = (scene: Scene): Scene => {
  const convert = (node: SceneNode): SceneNode => {
    if (node.kind === 'group') return { ...node, children: node.children.map(convert) };
    if (node.kind !== 'text') return node;
    const font = inter(node.bold ? 700 : 500);
    const planned = measureText(node.text, node.size, node.bold);
    let size = node.size;
    const actual = advance(font, node.text, size);
    if (actual > planned) size *= planned / actual;
    const width = advance(font, node.text, size);
    const x =
      node.anchor === 'middle'
        ? node.x - width / 2
        : node.anchor === 'end'
          ? node.x - width
          : node.x;
    return {
      kind: 'path',
      d: outline(font, node.text, x, node.y, size),
      fill: node.fill,
      rotate: node.rotate,
    };
  };
  return { ...scene, nodes: scene.nodes.map(convert) };
};

/** Greedy word wrap by measured width. */
const wrap = (font: Font, text: string, size: number, max: number): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && advance(font, next, size) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
};

const pathEl = (d: PathCommand[], fill: string) =>
  `<path fill="${fill}" d="${d
    .map((c) =>
      c[0] === 'Z'
        ? 'Z'
        : c[0] +
          c
            .slice(1)
            .map((v) => Math.round((v as number) * 100) / 100)
            .join(' '),
    )
    .join('')}"/>`;

const LOGO = `<rect width="100" height="100" rx="22" fill="#4f46e5"/><rect x="18" y="18" width="64" height="64" rx="5" fill="none" stroke="#fff" stroke-width="6"/><rect x="29" y="29" width="26" height="20" rx="3" fill="#fff"/><rect x="61" y="53" width="14" height="22" rx="3" fill="#fff" opacity=".8"/><rect x="29" y="58" width="22" height="17" rx="3" fill="#fff" opacity=".9"/>`;

/** The guide's social card as an SVG document (text already outlined). */
export const guideOgSvg = (slug: string): string => {
  const guide = findGuide(slug);
  const [example] = examplesFor(slug);
  const bold = inter(800);
  const medium = inter(500);

  // Left column: brand, title, subtitle, site.
  const left = 72;
  const colW = 560;
  let size = 60;
  let lines = wrap(bold, guide.heading, size, colW);
  while (lines.length > 3 && size > 40) lines = wrap(bold, guide.heading, (size -= 4), colW);
  const brand = pathEl(outline(bold, 'Room Planner', left + 64, 112, 30), '#4f46e5');
  const titleTop = 200;
  const lead = size * 1.15;
  const title = lines
    .map((l, n) => pathEl(outline(bold, l, left, titleTop + size + n * lead, size), '#0f172a'))
    .join('');
  const subY = titleTop + size + (lines.length - 1) * lead + 64;
  const sub = pathEl(
    outline(medium, 'Sizes, clearances and example floor plans', left, subY, 26),
    '#475569',
  );
  const foot = pathEl(
    outline(medium, 'room-planner.andrechek.com · free, no sign-up', left, H - 64, 22),
    '#64748b',
  );

  // Right column: the first example plan on a card.
  const plan = sceneToSvg(outlinedScene(exampleScene(example)));
  const box = { x: 680, y: 40, w: 480, h: 550 };
  const pad = 16;
  const nested = plan.replace(
    /^<svg([^>]*?) width="[\d.]+" height="[\d.]+"/,
    `<svg$1 x="${box.x + pad}" y="${box.y + pad}" width="${box.w - 2 * pad}" height="${box.h - 2 * pad}" preserveAspectRatio="xMidYMid meet"`,
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#f8fafc"/>` +
    `<g transform="translate(${left} 80) scale(.46)">${LOGO}</g>` +
    brand +
    title +
    sub +
    foot +
    `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="18" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>` +
    nested +
    `</svg>`
  );
};

/** The guide's social card as a PNG. */
export const guideOgPng = (slug: string): Promise<Buffer> =>
  sharp(Buffer.from(guideOgSvg(slug)))
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer();
