// Regenerates every icon in public/ from the SVG sources in brand/.
// Run: pnpm assets   (node brand/generate.mjs)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import sharp from 'sharp';
import { optimize } from 'svgo';
import opentype from 'opentype.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
const src = (f) => readFile(path.join(here, f), 'utf8');
const out = (f, d) => writeFile(path.join(pub, f), d);
const png = (buf, size, w = size, h = size) =>
  sharp(buf, { density: 384 })
    .resize(w, h)
    .png({ compressionLevel: 9, effort: 10, palette: false })
    .toBuffer();

// --- og-image.svg: bake the wordmark/tagline into outlines (Inter, OFL) ---
const fontPath = require.resolve('@fontsource/inter/files/inter-latin-800-normal.woff');
const tagFontPath = require.resolve('@fontsource/inter/files/inter-latin-500-normal.woff');
const load = async (p) => {
  const b = await readFile(p);
  return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const bold = await load(fontPath);
const med = await load(tagFontPath);
// Manual layout (no GSUB shaping: opentype.js chokes on Inter's lookups); plain Latin text needs no ligatures.
const d = (font, text, x, y, size) => {
  const scale = size / font.unitsPerEm;
  let pen = x;
  let data = '';
  for (const ch of text) {
    const g = font.charToGlyph(ch);
    data += g.getPath(pen, y, size).toPathData(2);
    pen += g.advanceWidth * scale;
  }
  return data;
};
let og = await src('og-template.svg');
og = og
  .replace('@WORDMARK@', d(bold, 'Room Planner', 272, 262, 88))
  .replace('@TAG1@', d(med, 'Plan your room layout in the browser', 96, 392, 38))
  .replace('@TAG2@', d(med, '\u2014 free, private, no sign-up', 96, 440, 38));
await writeFile(path.join(here, 'og-image.svg'), og);

// --- SVGs ---
const svgo = (s) => optimize(s, { multipass: true }).data;
await out('favicon.svg', svgo(await src('logo.svg')));

// --- PNGs ---
const logo = Buffer.from(await src('logo.svg'));
const small = Buffer.from(await src('logo-small.svg'));
await out('pwa-64x64.png', await png(logo, 64));
await out('pwa-192x192.png', await png(logo, 192));
await out('pwa-512x512.png', await png(logo, 512));
await out('maskable-icon-512x512.png', await png(Buffer.from(await src('logo-maskable.svg')), 512));
await out('apple-touch-icon.png', await png(Buffer.from(await src('logo-apple.svg')), 180));
await out(
  'og-image.png',
  await sharp(Buffer.from(og), { density: 72 })
    .resize(1200, 630)
    .png({ compressionLevel: 9, effort: 10, palette: false })
    .toBuffer(),
);

// --- favicon.ico (16/32 from the chunky small design, 48 from the master), PNG-in-ICO ---
const frames = [
  [16, await png(small, 16)],
  [32, await png(small, 32)],
  [48, await png(logo, 48)],
];
const head = Buffer.alloc(6 + 16 * frames.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(frames.length, 4);
let off = head.length;
frames.forEach(([s, b], i) => {
  const o = 6 + 16 * i;
  head[o] = s;
  head[o + 1] = s;
  head.writeUInt16LE(1, o + 4);
  head.writeUInt16LE(32, o + 6);
  head.writeUInt32LE(b.length, o + 8);
  head.writeUInt32LE(off, o + 12);
  off += b.length;
});
await out('favicon.ico', Buffer.concat([head, ...frames.map(([, b]) => b)]));
console.log('brand assets written to public/');
