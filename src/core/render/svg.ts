/**
 * Standalone SVG of the floor plan (used for the PNG export and for printing).
 * Pure: no DOM, no external resources - text uses the system sans-serif so it
 * renders when the SVG is drawn onto a canvas, offline and under a strict CSP.
 */
import {
  buildPlanScene,
  type PathCommand,
  type PlanInput,
  type Rotation,
  type Scene,
  type SceneNode,
} from './scene';

export const PLAN_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, 'Noto Sans', sans-serif";

/** Control characters XML 1.0 forbids (and U+FFFE/U+FFFF). */
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** Drop characters that would make the document unparseable (incl. lone surrogates). */
const xmlSafe = (text: string): string => {
  let out = '';
  for (const ch of text.replace(INVALID_XML_CHARS, '')) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0xd800 || cp > 0xdfff) out += ch;
  }
  return out;
};

/** Escape text for an XML text node or attribute value. */
export const escapeXml = (text: string): string =>
  xmlSafe(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const n = (v: number) => String(Math.round(v * 100) / 100);

const pathData = (d: PathCommand[]) =>
  d
    .map((c) =>
      c[0] === 'Z'
        ? 'Z'
        : c[0] +
          c
            .slice(1)
            .map((v) => n(v as number))
            .join(' '),
    )
    .join('');

const attrs = (pairs: Record<string, string | number | undefined>) =>
  Object.entries(pairs)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? n(v) : escapeXml(v!)}"`)
    .join('');

const transform = (r?: Rotation) => (r ? `rotate(${n(r.deg)} ${n(r.cx)} ${n(r.cy)})` : undefined);

const paint = (node: {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
}) => ({
  fill: node.fill ?? 'none',
  stroke: node.stroke,
  'stroke-width': node.stroke ? (node.strokeWidth ?? 1) : undefined,
  'stroke-dasharray': node.dash?.map(n).join(' '),
});

const renderNode = (node: SceneNode, indent: string): string => {
  switch (node.kind) {
    case 'group': {
      const data = Object.fromEntries(
        Object.entries(node.attrs ?? {}).map(([k, v]) => [`data-${k}`, v]),
      );
      const inner = node.children.map((c) => renderNode(c, `${indent}  `)).join('');
      return `${indent}<g${attrs({ 'data-role': node.role, ...data })}>\n${inner}${indent}</g>\n`;
    }
    case 'rect':
      return `${indent}<rect${attrs({
        x: node.x,
        y: node.y,
        width: node.w,
        height: node.h,
        rx: node.rx || undefined,
        ...paint(node),
        transform: transform(node.rotate),
      })}/>\n`;
    case 'path':
      return `${indent}<path${attrs({
        d: pathData(node.d),
        ...paint(node),
        'stroke-linecap': node.stroke ? 'round' : undefined,
        transform: transform(node.rotate),
      })}/>\n`;
    case 'text':
      return `${indent}<text${attrs({
        x: node.x,
        y: node.y,
        'font-size': node.size,
        'font-weight': node.bold ? 700 : undefined,
        'text-anchor': node.anchor === 'start' ? undefined : node.anchor,
        fill: node.fill,
        transform: transform(node.rotate),
      })}>${escapeXml(node.text)}</text>\n`;
  }
};

/** Serialize a scene as a standalone SVG document. */
export const sceneToSvg = (scene: Scene): string => {
  const { width, height } = scene;
  const body = scene.nodes.map((node) => renderNode(node, '  ')).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${attrs({
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      'font-family': PLAN_FONT_STACK,
      role: 'img',
      'aria-label': `Floor plan: ${scene.title}`,
    })}>\n` +
    `  <title>${escapeXml(scene.title)}</title>\n` +
    `  <rect width="${width}" height="${height}" fill="${scene.background}"/>\n` +
    body +
    `</svg>\n`
  );
};

/** The floor plan as a standalone SVG string. */
export const planSvg = (input: PlanInput): string => sceneToSvg(buildPlanScene(input));
