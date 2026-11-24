import { expect, test, type Locator, type Page } from '@playwright/test';
import { animationsSettled, openStep, viewPlan } from './ui';

// Touch-emulated smoke for the narrow layout. Runs only in the mobile projects.
test.beforeEach(({ isMobile }) => {
  test.skip(!isMobile, 'mobile projects only (touch + narrow layout)');
});

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

const storedItems = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('room-sim-v3-items') ?? '[]'));

/** Drag with real-looking touch pointer events (the planner uses window pointer listeners). */
async function touchDrag(page: Page, el: Locator, dx: number, dy: number) {
  const box = (await el.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(
    async ({ x, y, dx, dy, sel }) => {
      const target = document.querySelector(sel)!;
      const opts = (cx: number, cy: number, buttons: number) => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        clientX: cx,
        clientY: cy,
        button: 0,
        buttons,
      });
      target.dispatchEvent(new PointerEvent('pointerdown', opts(x, y, 1)));
      for (let i = 1; i <= 10; i++) {
        window.dispatchEvent(
          new PointerEvent('pointermove', opts(x + (dx * i) / 10, y + (dy * i) / 10, 1)),
        );
        await new Promise((r) => setTimeout(r, 16));
      }
      window.dispatchEvent(new PointerEvent('pointerup', opts(x + dx, y + dy, 0)));
    },
    { x, y, dx, dy, sel: '[data-testid="furniture-piece"], [aria-label^="New Item,"]' },
  );
}

test('tap through the tabs, add furniture, touch-drag it, share link round-trips', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await ready(page);
  await expect(page.getByTestId('room')).toBeVisible();

  // The editor is a bottom sheet, half open on a first visit (which starts in Furniture mode).
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Add Item' }).tap();
  const piece = page.getByRole('button', { name: /^New Item,/ });
  await expect(piece).toBeVisible();
  // The new piece shows on the plan above the sheet.
  await animationsSettled(page);
  const sheetTop = (await page.getByTestId('sidebar').boundingBox())!.y;
  expect((await piece.boundingBox())!.y + (await piece.boundingBox())!.height).toBeLessThan(
    sheetTop,
  );
  const before = (await storedItems(page)).find((i: { label: string }) => i.label === 'New Item');

  await touchDrag(page, piece, 50, -70);
  await expect
    .poll(
      async () =>
        (await storedItems(page)).find((i: { label: string }) => i.label === 'New Item').x,
    )
    .toBeGreaterThan(before.x + 0.3);

  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await page.getByRole('button', { name: 'Share / Save' }).tap();
  const shareInput = page.locator('#share-url');
  await expect(shareInput).toHaveValue(/#s=[A-Za-z0-9_-]+$/);
  const shareUrl = await shareInput.inputValue();
  await page.getByLabel('Close modal').tap();

  const fresh = await browser.newContext(test.info().project.use);
  const other = await fresh.newPage();
  await other.goto(shareUrl);
  await ready(other);
  await expect(other.getByRole('button', { name: /^New Item,/ })).toBeVisible();
  await fresh.close();

  expect(errors).toEqual([]);
});

test('no horizontal page scroll on the narrow layout', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('the offline toast never covers the bottom controls: the sheet handle works right away', async ({
  page,
}) => {
  // A returning visitor (a layout is stored) whose service worker installs now: the one-time
  // "Ready to work offline" toast shows (a first visit never shows it).
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('room-sim-v3-mode', 'room-setup');
    localStorage.setItem('room-sim-v3-dims', JSON.stringify({ width: 12, height: 12 }));
  });
  await page.goto('/');
  await page.waitForSelector('html[data-planner-ready]');
  const toast = page.getByTestId('pwa-toast');
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await animationsSettled(page);
  const t = (await toast.boundingBox())!;
  const controls = page
    .getByRole('button', {
      name: /^(Resize editor|Zoom out|Zoom in|Fit to view|Snap|Next: Items)$/,
    })
    .filter({ visible: true });
  expect(await controls.count()).toBeGreaterThanOrEqual(5);
  for (const control of await controls.all()) {
    const b = (await control.boundingBox())!;
    const overlaps =
      t.x < b.x + b.width && b.x < t.x + t.width && t.y < b.y + b.height && b.y < t.y + t.height;
    expect(overlaps, `${await control.getAttribute('aria-label')} is covered`).toBe(false);
  }
  // Tappable now, while the toast is still up (a covered button would time out here).
  await expect(toast).toBeVisible();
  await page.getByRole('button', { name: 'Resize editor' }).tap({ timeout: 1000 });
  await expect(page.getByTestId('sidebar')).toHaveAttribute('data-detent', 'full');
});

test('touch targets: sidebar icon buttons and the rotate handle are at least 44px; pieces keep their size', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  for (const name of [/^Lock /, /^Hide /, /^Delete /]) {
    const b = (await page.getByRole('button', { name }).first().boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  await viewPlan(page);
  await animationsSettled(page);

  // A piece is drawn at its real size (no 44px minimum stretching a small piece).
  const room = (await page.getByTestId('room').boundingBox())!;
  const ppf = (room.width / (12 * 40 + 8)) * 40;
  const nightstand = page.getByRole('button', { name: /^Nightstand,/ }).first();
  expect((await nightstand.boundingBox())!.width).toBeCloseTo(1.5 * ppf, 0);

  // The rotate handle's knob is smaller, but a touch within 44px of its center lands on it.
  await page.getByRole('button', { name: /^Chair,/ }).tap();
  // (A tap on a piece opens the collapsed sheet to half: let it settle.)
  await animationsSettled(page);
  await page.waitForTimeout(400);
  const knob = (await page.getByTestId('rotate-handle').boundingBox())!;
  const hit = await page.evaluate(
    ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="rotate-handle"]'),
    { x: knob.x + knob.width / 2 + 20, y: knob.y + knob.height / 2 },
  );
  expect(hit).toBe(true);
});

test('the Snap toggle rides on the sheet, clear of it and of the mode badge', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await animationsSettled(page);
  const toggle = page.getByRole('button', { name: 'Snap', exact: true });
  await expect(toggle).toBeVisible();
  const t = (await toggle.boundingBox())!;
  expect(t.height).toBeGreaterThanOrEqual(44);
  expect(t.x + t.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(t.y + t.height).toBeLessThanOrEqual((await page.getByTestId('sidebar').boundingBox())!.y);
  const badge = (await page.getByTestId('mode-badge').boundingBox())!;
  expect(badge.y + badge.height).toBeLessThan(t.y);
});

for (const size of [
  { width: 360, height: 780 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 667, height: 375 }, // landscape phone (still the narrow layout)
]) {
  for (const mode of ['room-setup', 'furniture'] as const) {
    test(`bottom controls and mode badge fit at ${size.width}x${size.height} (${mode})`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await page.addInitScript((m) => localStorage.setItem('room-sim-v3-mode', m), mode);
      await page.goto('/');
      await ready(page);
      await animationsSettled(page);
      const pill = (await page.getByTestId('zoom-pill').boundingBox())!;
      const snap = (await page
        .getByTestId('sheet-floating')
        .getByTestId('snap-toggle')
        .boundingBox())!;
      const sheet = (await page.getByTestId('sidebar').boundingBox())!;
      // Side by side above the sheet, never overlapping, both fully on screen.
      expect(pill.x + pill.width, 'zoom pill overlaps the Snap chip').toBeLessThanOrEqual(snap.x);
      expect(pill.x).toBeGreaterThanOrEqual(0);
      expect(snap.x + snap.width).toBeLessThanOrEqual(size.width);
      expect(pill.y + pill.height).toBeLessThanOrEqual(sheet.y);
      expect(snap.y + snap.height).toBeLessThanOrEqual(sheet.y);
      // The mode badge is one line (about 33px tall; two lines would be ~50).
      const badge = page.getByTestId('mode-badge');
      const b = (await badge.boundingBox())!;
      expect(b.height, 'mode badge wraps').toBeLessThan(40);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(size.width);
      // Not cut off with an ellipsis either.
      expect(await badge.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    });
  }
}
