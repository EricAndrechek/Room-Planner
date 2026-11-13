// Captures the web-app-manifest screenshots (public/screenshots/*.webp) from the built app.
//   pnpm build && pnpm exec astro preview --port 43291 &   then   pnpm screenshots
// Seeds localStorage (current schema) with a furnished living room, so the output is deterministic.
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const BASE = process.env.BASE_URL ?? 'http://localhost:43291';
const OUT = new URL('../public/screenshots/', import.meta.url);

const item = (id, label, width, height, x, y, color, rotation = 0) => ({
  id,
  label,
  width,
  height,
  x,
  y,
  rotation,
  color,
  visible: true,
  locked: false,
});
const layout = {
  dims: { width: 16, height: 12 },
  doors: [{ id: 1, width: 3, position: 2, wall: 'bottom', hinge: 'left', type: 'swing-in' }],
  windows: [
    { id: 2, width: 4, position: 2, wall: 'top' },
    { id: 3, width: 3, position: 10, wall: 'top' },
  ],
  items: [
    item(11, 'Sofa', 7, 3, 5.5, 7.4, '#93c5fd'),
    item(12, 'Coffee table', 3.5, 1.8, 7.25, 4.6, '#fcd34d'),
    item(13, 'TV stand', 5, 1.5, 5.5, 1, '#a5b4fc'),
    item(14, 'Armchair', 2.8, 2.8, 1.4, 5, '#6ee7b7', 30),
    item(15, 'Bookshelf', 1.2, 5, 14.5, 3.2, '#fdba74'),
    item(16, 'Plant', 1.5, 1.5, 13.2, 9.8, '#bef264'),
    item(17, 'Side table', 1.6, 1.6, 12.9, 7.6, '#f9a8d4'),
  ],
};
const now = new Date().toISOString();
const project = {
  id: 'project-seed',
  name: 'Living room',
  data: {
    roomDims: layout.dims,
    doors: layout.doors,
    windows: layout.windows,
    items: layout.items,
    designMode: 'furniture',
    unitSystem: 'ft-in',
  },
  createdAt: now,
  updatedAt: now,
};
const seed = {
  'room-planner-schema': '1',
  'room-planner-projects': JSON.stringify([project]),
  'room-sim-v3-currentProject': project.id,
  'room-sim-v3-units': 'ft-in',
  'room-sim-v3-mode': 'furniture',
  'room-sim-v3-dims': JSON.stringify(layout.dims),
  'room-sim-v3-doors': JSON.stringify(layout.doors),
  'room-sim-v3-windows': JSON.stringify(layout.windows),
  'room-sim-v3-items': JSON.stringify(layout.items),
};

const browser = await chromium.launch();
for (const [name, viewport, scale] of [
  ['wide', { width: 1280, height: 800 }, 1],
  ['narrow', { width: 390, height: 844 }, 2],
]) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: scale,
    serviceWorkers: 'block',
    isMobile: name === 'narrow',
    hasTouch: name === 'narrow',
  });
  await context.addInitScript((s) => {
    for (const [k, v] of Object.entries(s))
      if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  }, seed);
  const page = await context.newPage();
  await page.goto(BASE + '/');
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(1200);
  const png = await page.screenshot();
  const file = new URL(`${name}.webp`, OUT);
  await sharp(png).webp({ quality: 88, effort: 6 }).toFile(file.pathname);
  console.log('wrote', file.pathname);
  await context.close();
}
await browser.close();
