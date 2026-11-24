import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { openStep, viewPlan } from './ui';

// "Open on another device" in the Share / Save dialog: the plan's link (which holds the whole
// plan) with Copy link, Share… (Web Share API), Email it to me, and a QR code on wide screens.

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

/** Replace (or remove) the Web Share API; calls are recorded in `window.__shared`. */
const mockShare = (page: Page, available: boolean) =>
  page.addInitScript((on) => {
    const proto = Object.getPrototypeOf(navigator);
    const w = window as unknown as { __shared: unknown[] };
    w.__shared = [];
    Object.defineProperty(proto, 'share', {
      configurable: true,
      value: on
        ? (data: unknown) => {
            w.__shared.push(data);
            return Promise.resolve();
          }
        : undefined,
    });
    Object.defineProperty(proto, 'canShare', {
      configurable: true,
      value: on ? () => true : undefined,
    });
  }, available);

async function openShare(page: Page) {
  await page.getByRole('button', { name: 'Share / Save' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Open on another device' })).toBeVisible();
  await expect(dialog.locator('#share-url')).toHaveValue(/#s=[A-Za-z0-9_-]+$/);
  return dialog;
}

/** Read the QR code the way a camera would: rasterize the drawn SVG and decode it. */
async function scanQr(page: Page): Promise<string | null> {
  const img = await page.getByTestId('handoff-qr').evaluate(async (svg) => {
    const xml = new XMLSerializer().serializeToString(svg);
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: data.width, height: data.height, data: Array.from(data.data) };
  });
  return jsQR(Uint8ClampedArray.from(img.data), img.width, img.height)?.data ?? null;
}

test('wide screens: Copy link, Email it to me and a QR code that scans to the same link', async ({
  page,
  context,
  browserName,
  isMobile,
}) => {
  test.skip(isMobile, 'the QR code is for wide screens');
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await mockShare(page, false);
  await page.goto('/');
  await ready(page);
  // A plan with some content, so the link is a realistic length.
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Add Item' }).click();
  const dialog = await openShare(page);
  const url = await dialog.locator('#share-url').inputValue();

  await dialog.getByRole('button', { name: 'Copy link' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  if (browserName === 'chromium') {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  }

  // No Web Share API here: no Share… button.
  await expect(dialog.getByRole('button', { name: 'Share…' })).toHaveCount(0);

  const email = dialog.getByRole('link', { name: 'Email it to me' });
  const href = (await email.getAttribute('href'))!;
  expect(href.startsWith('mailto:?subject=')).toBe(true);
  const body = new URLSearchParams(href.slice('mailto:?'.length)).get('body')!;
  expect(body).toContain(url);

  await expect(page.getByTestId('handoff-qr')).toBeVisible();
  expect(await scanQr(page)).toBe(url);
});

test('a long plan link still gives a QR code that scans', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the QR code is for wide screens');
  // 25 pieces with long names: a link of well over 600 characters.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const items = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      label: `Piece number ${i + 1} with a longer name`,
      width: 1 + (i % 3),
      height: 1 + (i % 2),
      x: (i % 5) * 2.3,
      y: Math.floor(i / 5) * 2.3,
      rotation: (i * 15) % 90,
      color: '#93c5fd',
      visible: true,
    }));
    localStorage.setItem('room-sim-v3-items', JSON.stringify(items));
  });
  await page.goto('/');
  await ready(page);
  const dialog = await openShare(page);
  const url = await dialog.locator('#share-url').inputValue();
  expect(url.length).toBeGreaterThan(600);
  test.info().annotations.push({ type: 'link-length', description: String(url.length) });
  await expect(page.getByTestId('handoff-qr')).toBeVisible();
  expect(await scanQr(page)).toBe(url);
});

test('phones: Share… opens the share sheet with the link; no QR code', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'phone layout');
  await mockShare(page, true);
  await page.goto('/');
  await ready(page);
  const dialog = await openShare(page);
  const url = await dialog.locator('#share-url').inputValue();
  await expect(page.getByTestId('handoff-qr-block')).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Email it to me' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Share…' }).click();
  const shared = await page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared);
  expect(shared).toEqual([{ title: expect.stringMatching(/^Room Planner: /), url }]);
});

test('phones without the Web Share API: no Share… button, Copy link and email still there', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'phone layout');
  await mockShare(page, false);
  await page.goto('/');
  await ready(page);
  const dialog = await openShare(page);
  await expect(dialog.getByRole('button', { name: 'Share…' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Email it to me' })).toBeVisible();
});

test('the link opens the same plan on another device, saved there as its own plan', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await ready(page);
  await page.getByTitle('Click to rename').click();
  await page.getByLabel('Floor plan name').fill('Laptop plan');
  await page.getByLabel('Floor plan name').press('Enter');
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Add Item' }).click();
  await viewPlan(page);
  const dialog = await openShare(page);
  const url = await dialog.locator('#share-url').inputValue();

  // Another device: a fresh browser context with nothing stored.
  const other = await browser.newContext(test.info().project.use);
  const phone = await other.newPage();
  await phone.goto(url);
  await ready(phone);
  await expect(phone.getByRole('heading', { name: 'Laptop plan' })).toBeVisible();
  await expect(phone.getByRole('button', { name: /^New Item,/ })).toBeVisible();
  await expect(phone.getByRole('button', { name: /^Bed,/ })).toBeVisible();
  // The payload is dropped from the address bar, and the plan is a normal saved plan there.
  expect(phone.url()).not.toContain('#s=');
  await phone.getByRole('button', { name: 'Open file browser' }).click();
  await expect(phone.getByTestId('project-row')).toHaveCount(1);
  await expect(phone.getByTestId('project-row')).toContainText('Laptop plan');
  await phone.getByLabel('Close modal').click();
  await phone.reload();
  await ready(phone);
  await expect(phone.getByRole('heading', { name: 'Laptop plan' })).toBeVisible();
  await expect(phone.getByRole('button', { name: /^New Item,/ })).toBeVisible();
  await other.close();
});
