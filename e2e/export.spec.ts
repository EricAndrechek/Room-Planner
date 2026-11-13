import { expect, test, type BrowserContext, type Download, type Page } from '@playwright/test';
import fs from 'node:fs';
import { isProblem } from './problems';

/** A layout with rotated furniture and doors/windows on every wall. */
const LAYOUT = {
  dims: { width: 16, height: 11.5 },
  doors: [
    { id: 1, width: 3, position: 1, wall: 'bottom', hinge: 'left', type: 'swing-in' },
    { id: 2, width: 2.5, position: 6, wall: 'left', hinge: 'right', type: 'swing-in' },
    { id: 3, width: 6, position: 8, wall: 'top', hinge: 'left', type: 'sliding' },
    { id: 4, width: 2.75, position: 2, wall: 'right', hinge: 'left', type: 'swing-out' },
  ],
  windows: [
    { id: 1, width: 4, position: 1.5, wall: 'top' },
    { id: 2, width: 3, position: 7, wall: 'right' },
  ],
  items: [
    { id: 1, label: 'Sofa', width: 7, height: 3, x: 4.5, y: 7.5, rotation: 0, color: '#a5b4fc' },
    {
      id: 2,
      label: 'Armchair',
      width: 2.75,
      height: 2.75,
      x: 10.5,
      y: 4,
      rotation: 45,
      color: '#fdba74',
    },
    {
      id: 3,
      label: '<Desk & "Chair">',
      width: 4.5,
      height: 2.2,
      x: 11,
      y: 0.3,
      rotation: 0,
      color: '#6ee7b7',
    },
  ],
};

/** Seed the working layout in localStorage before the app boots (first load only). */
async function seed(context: BrowserContext) {
  await context.addInitScript((l) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('room-planner-schema', '1');
    localStorage.setItem('room-sim-v3-dims', JSON.stringify(l.dims));
    localStorage.setItem('room-sim-v3-doors', JSON.stringify(l.doors));
    localStorage.setItem('room-sim-v3-windows', JSON.stringify(l.windows));
    localStorage.setItem('room-sim-v3-items', JSON.stringify(l.items));
  }, LAYOUT);
}

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

async function rename(page: Page, name: string) {
  await page.getByTitle('Click to rename').click();
  await page.getByLabel('Floor plan name').fill(name);
  await page.getByLabel('Floor plan name').press('Enter');
}

/** A file the app handed over: downloaded, or (iOS) passed to the share sheet. */
interface Saved {
  name: string;
  bytes: Buffer;
}

/** iPhone/iPad: the app uses the share sheet instead of a download (see `saveFile`). */
const sharesFiles = (browserName: string, isMobile: boolean) =>
  browserName === 'webkit' && isMobile;

/** Stand in for the iOS share sheet: record every shared file (name, type, base64 bytes). */
async function stubShareSheet(context: BrowserContext) {
  await context.addInitScript(() => {
    const shared: { name: string; type: string; data: string }[] = [];
    (window as unknown as { __shared: typeof shared }).__shared = shared;
    const proto = Object.getPrototypeOf(navigator);
    Object.defineProperty(proto, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(proto, 'share', {
      configurable: true,
      value: async ({ files }: { files: File[] }) => {
        for (const f of files) {
          const data = await new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
            r.readAsDataURL(f);
          });
          shared.push({ name: f.name, type: f.type, data });
        }
      },
    });
  });
}

/**
 * The name the browser saved a download under, back in the app's spelling: macOS WebKit stores
 * names decomposed (NFD: "e" + combining accent), and Linux WebKit swaps spaces for "_".
 */
const savedName = (d: Download, browserName: string) => {
  const name = d.suggestedFilename().normalize('NFC');
  return browserName === 'webkit' ? name.replace(/_/g, ' ') : name;
};

async function save(page: Page, button: string, viaShare: boolean): Promise<Saved> {
  if (viaShare) {
    const before = await page.evaluate(
      () => (window as unknown as { __shared: [] }).__shared.length,
    );
    await page.getByRole('button', { name: button }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __shared: [] }).__shared.length))
      .toBe(before + 1);
    const f = await page.evaluate(
      (i) => (window as unknown as { __shared: { name: string; data: string }[] }).__shared[i]!,
      before,
    );
    return { name: f.name, bytes: Buffer.from(f.data, 'base64') };
  }
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const d = await pending;
  const browserName = page.context().browser()!.browserType().name();
  return { name: savedName(d, browserName), bytes: fs.readFileSync((await d.path())!) };
}

/** Width x height from a PNG's IHDR chunk. */
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/** The plan SVG's natural size, read from the print container the Print button fills. */
async function planSize(page: Page) {
  const svg = page.locator('#print-plan svg');
  return {
    width: Number(await svg.getAttribute('width')),
    height: Number(await svg.getAttribute('height')),
  };
}

function watchProblems(context: BrowserContext, problems: string[]) {
  context.on('console', (m) => {
    if (isProblem(m)) problems.push(m.text());
  });
  context.on('weberror', (e) => problems.push(String(e.error())));
}

test('export PNG, PDF and print a clean plan', async ({ page, context, browserName, isMobile }) => {
  const problems: string[] = [];
  watchProblems(context, problems);
  await seed(context);
  const viaShare = sharesFiles(browserName, isMobile);
  if (viaShare) await stubShareSheet(context);
  await page.goto('/');
  await ready(page);
  await rename(page, 'Living room: "café" / 客厅');

  const open = () => page.getByRole('button', { name: 'Export as image or PDF' }).click();
  await open();
  await expect(page.getByRole('dialog', { name: 'Export Floor Plan' })).toBeVisible();

  const png = await save(page, 'Download PNG', viaShare);
  expect(png.name).toBe('Living room café 客厅.png');
  expect(png.bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const pngDims = pngSize(png.bytes);

  // Pick Letter explicitly (the default follows the browser locale).
  await page.getByRole('radio', { name: 'Letter' }).click();
  const pdf = await save(page, 'Download PDF', viaShare);
  expect(pdf.name).toBe('Living room café 客厅.pdf');
  expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const pdfText = pdf.bytes.toString('latin1');
  expect(pdfText).toContain('/MediaBox [0 0 792 612]'); // landscape Letter for a wide room
  expect(pdfText).toMatch(/\/XObject << \/Im1/); // the CJK title is embedded as an image
  expect(pdfText.trimEnd().endsWith('%%EOF')).toBe(true);
  expect(pdf.bytes.length).toBeGreaterThan(2_000);

  // Print: the dialog closes, the plan replaces the editor in print media, then cleans up.
  await page.evaluate(() => {
    window.print = () => {
      (window as unknown as { printed: boolean }).printed = true;
    };
  });
  await page.getByRole('button', { name: /^Print/ }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { printed: boolean }).printed)).toBe(true);
  const svg = page.locator('#print-plan svg');
  await expect(svg).toHaveCount(1);
  await expect(svg.locator('[data-role="item"]')).toHaveCount(3);
  await expect(svg.locator('[data-role="door"]')).toHaveCount(4);
  await expect(svg.locator('[data-role="window"]')).toHaveCount(2);
  await expect(svg.locator('text', { hasText: '<Desk & "Chair">' })).toHaveCount(1);
  // No editor chrome in the plan.
  expect(await svg.innerHTML()).not.toMatch(/handle|lock|warning|overlap/i);

  const size = await planSize(page);
  expect(pngDims.width).toBeGreaterThanOrEqual(size.width * 2);
  expect(pngDims.height).toBeGreaterThanOrEqual(size.height * 2);

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#print-plan')).toBeVisible();
  await expect(page.getByTestId('room')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('#print-plan')).toHaveCount(0);

  // The browser's own Print command (beforeprint) also gets the clean plan.
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      return page.locator('#print-plan svg').count();
    })
    .toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  expect(problems).toEqual([]);
});

test('export works offline', async ({ page, context, browserName, isMobile }) => {
  const problems: string[] = [];
  watchProblems(context, problems);
  await seed(context);
  const viaShare = sharesFiles(browserName, isMobile);
  if (viaShare) await stubShareSheet(context);
  await page.goto('/');
  await ready(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 })
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await ready(page);
  await page.getByRole('button', { name: 'Export as image or PDF' }).click();

  const png = await save(page, 'Download PNG', viaShare);
  expect(png.name).toMatch(/^Floor Plan - [\d ]+\.png$/);
  expect(pngSize(png.bytes).width).toBeGreaterThan(1000);
  const pdf = await save(page, 'Download PDF', viaShare);
  expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(problems.filter((p) => !/ERR_INTERNET_DISCONNECTED/.test(p))).toEqual([]);
});

test('on iOS, a refused share sheet falls back to a download', async ({
  page,
  context,
  browserName,
  isMobile,
}) => {
  test.skip(!sharesFiles(browserName, isMobile), 'the share-sheet path is iOS only');
  await context.addInitScript(() => {
    const proto = Object.getPrototypeOf(navigator);
    Object.defineProperty(proto, 'canShare', { configurable: true, value: () => true });
    // What Safari does when the click's user activation has expired by the time the file is ready.
    Object.defineProperty(proto, 'share', {
      configurable: true,
      value: () => Promise.reject(new DOMException('No user activation', 'NotAllowedError')),
    });
  });
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: 'Export as image or PDF' }).click();
  const png = await save(page, 'Download PNG', false);
  expect(png.bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0); // no "Export failed"
});
