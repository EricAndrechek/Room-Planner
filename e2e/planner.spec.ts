import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(new URL(`../src/lib/__fixtures__/${name}`, import.meta.url), 'utf8'));

/** Wait for the island to mount and for the initial auto-fit zoom (500ms) to settle. */
async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

const storedItems = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('room-sim-v3-items') ?? '[]'));

const center = async (page: Page, selector: Parameters<Page['locator']>[0]) => {
  const box = (await page.locator(selector).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test('static shell is served for crawlers and no-JS visitors', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveTitle('Room Planner — Free Online Room Layout & Furniture Planner');
  await expect(page.getByRole('heading', { name: 'Room Planner' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'How to use Room Planner' })).toHaveAttribute(
    'href',
    '/help/',
  );
  const jsonLd = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent())!,
  );
  expect(jsonLd['@graph'][0]).toMatchObject({
    '@type': 'WebSite',
    name: 'Room Planner',
    alternateName: 'RoomPlanner',
  });
  await context.close();
});

test('add, drag, rotate, undo, share, reopen and reload', async ({ page, browser, isMobile }) => {
  test.skip(
    isMobile,
    'mouse drag/rotate on the desktop layout; touch is covered by mobile.spec.ts',
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await ready(page);
  await expect(page.getByTestId('room')).toBeVisible();

  // Name the plan with non-Latin-1 text (the old share encoder broke on this).
  await page.getByTitle('Click to rename').click();
  await page.getByLabel('Floor plan name').fill('Bedroom 🛏️');
  await page.getByLabel('Floor plan name').press('Enter');
  await expect(page.getByRole('heading', { name: 'Bedroom 🛏️' })).toBeVisible();

  // Add furniture.
  await page.getByRole('button', { name: '2. Furniture' }).click();
  await page.getByRole('button', { name: 'Add new furniture item' }).click();
  const piece = page.getByRole('button', { name: /^New Item,/ });
  await expect(piece).toBeVisible();
  const before = (await storedItems(page)).find((i: { label: string }) => i.label === 'New Item');
  expect(before).toMatchObject({ x: 4.5, y: 5, width: 3, height: 2, rotation: 0 });

  // Drag it.
  const start = await center(page, 'role=button[name=/^New Item,/]');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y - 90, { steps: 10 });
  await page.mouse.up();
  const dragged = (await storedItems(page)).find((i: { label: string }) => i.label === 'New Item');
  expect(dragged.x).toBeGreaterThan(before.x + 0.5);
  expect(dragged.y).toBeLessThan(before.y - 0.5);

  // Rotate it ~90deg clockwise with the handle; it snaps to exactly 90.
  await piece.click();
  const handle = page.getByLabel('Rotate handle');
  await expect(handle).toBeVisible();
  const c = await center(page, 'role=button[name=/^New Item,/]');
  const h = await center(page, '[aria-label="Rotate handle"]');
  const r = Math.hypot(h.x - c.x, h.y - c.y);
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  for (let a = -90; a <= -2; a += 4) {
    const rad = (a * Math.PI) / 180;
    await page.mouse.move(c.x + r * Math.cos(rad), c.y + r * Math.sin(rad));
  }
  await page.mouse.up();
  const rotation = page.getByLabel('Rotation of New Item');
  await expect(rotation).toHaveValue('90');

  // Undo reverts just the rotation; redo re-applies it.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(rotation).toHaveValue('0');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(rotation).toHaveValue('90');

  // Let autosave run, then create a share link.
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await page.getByRole('button', { name: 'Share and save layout' }).click();
  const shareInput = page.locator('#share-url');
  await expect(shareInput).toHaveValue(/#s=[A-Za-z0-9_-]+$/);
  const shareUrl = await shareInput.inputValue();
  expect(new URL(shareUrl).search).toBe('');
  await page.getByLabel('Close modal').click();
  const layoutHere = await storedItems(page);

  // Open the link in a fresh browser context: same layout, same (unicode) name.
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const other = await fresh.newPage();
  await other.goto(shareUrl);
  await ready(other);
  await expect(other.getByRole('heading', { name: 'Bedroom 🛏️' })).toBeVisible();
  await expect(other.getByRole('button', { name: /^New Item,/ })).toBeVisible();
  expect(other.url()).not.toContain('#s=');
  const layoutThere = await storedItems(other);
  expect(layoutThere).toHaveLength(layoutHere.length);
  for (const [i, item] of layoutHere.entries()) {
    expect(layoutThere[i].label).toBe(item.label);
    expect(layoutThere[i].rotation).toBe(item.rotation);
    expect(layoutThere[i].x).toBeCloseTo(item.x, 5);
    expect(layoutThere[i].y).toBeCloseTo(item.y, 5);
  }
  await fresh.close();

  // Reload keeps everything.
  await page.reload();
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Bedroom 🛏️' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^New Item,/ })).toBeVisible();
  await expect(page.getByLabel('Rotation of New Item')).toHaveValue('90');
  expect(await storedItems(page)).toEqual(layoutHere);

  expect(errors).toEqual([]);
});

test("loads data saved by the original app's localStorage", async ({ page, isMobile }) => {
  const { localStorage: seed } = fixture('original-storage.json');
  await page.addInitScript((data: Record<string, string>) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    sessionStorage.setItem('seeded', '1');
  }, seed);
  await page.goto('/');
  await ready(page);

  await expect(page.getByRole('heading', { name: 'Café Plan' })).toBeVisible();
  // The area summary is truncated out of view on narrow layouts.
  if (!isMobile) await expect(page.getByText(`14'6" × 11' (159.5 sq ft)`)).toBeVisible();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await expect(page.getByTestId('furniture-card')).toHaveCount(4);
  await expect(page.getByLabel('Rotation of Desk')).toHaveValue('90');
  await expect(page.getByRole('button', { name: /^Wardrobe,.*\(locked\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Rug,/ })).toHaveCount(0); // hidden
  if (!isMobile) await expect(page.getByRole('button', { name: 'Show Rug' })).toBeVisible();

  // Nothing was rewritten just by loading.
  const after = await page.evaluate(() =>
    Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
  );
  for (const [k, v] of Object.entries(seed)) expect(after[k]).toBe(v);
  expect(after['room-planner-schema']).toBe('1');
});

test('legacy ?config= links from the original app still open', async ({ page, isMobile }) => {
  const links = fixture('original-share-links.json');
  const legacy = new URL(links.ftIn.url);
  await page.goto(`/${legacy.search}`);
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Café Plan' })).toBeVisible();
  // The area summary is truncated out of view on narrow layouts.
  if (!isMobile) await expect(page.getByText(`14'6" × 11' (159.5 sq ft)`)).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  const items = await storedItems(page);
  expect(items.map((i: { label: string }) => i.label)).toEqual(['Bed', 'Desk', 'Wardrobe', 'Rug']);
  expect(items[1]).toMatchObject({ rotation: 90, color: '#123abc' });
});

test('help page and 404', async ({ page }) => {
  await page.goto('/help/');
  await expect(page.getByRole('heading', { name: 'Help & FAQ', level: 1 })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/help\/$/);
  const res = await page.goto('/robots.txt');
  expect(await res!.text()).toMatch(/Sitemap: https?:\/\/.+\/sitemap-index\.xml/);
  const missing = await page.goto('/no-such-page/');
  expect(missing!.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
