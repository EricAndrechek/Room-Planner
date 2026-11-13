import { expect, test, type Locator, type Page } from '@playwright/test';

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

  // The sidebar is an off-canvas drawer on narrow screens.
  await page.getByRole('button', { name: 'Edit room settings' }).tap();
  await page.getByRole('button', { name: /^2\. (Furniture|Items)/ }).tap();
  await page.getByRole('button', { name: 'Add new furniture item' }).tap();
  const piece = page.getByRole('button', { name: /^New Item,/ });
  await expect(piece).toBeVisible();
  const before = (await storedItems(page)).find((i: { label: string }) => i.label === 'New Item');

  await touchDrag(page, piece, 50, -70);
  await expect
    .poll(
      async () =>
        (await storedItems(page)).find((i: { label: string }) => i.label === 'New Item').x,
    )
    .toBeGreaterThan(before.x + 0.3);

  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await page.getByRole('button', { name: 'Share and save layout' }).tap();
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
