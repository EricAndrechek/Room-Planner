import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { animationsSettled, openStep, viewPlan } from './ui';

/** Wait for the island to mount and the initial auto-fit zoom to settle. */
async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

/** Zero serious/critical axe violations (WCAG 2.x A/AA + best practices). */
async function expectNoSeriousViolations(page: Page) {
  // Contrast is judged on final colors: a scan taken mid fade-in sees blended, washed-out ones.
  await animationsSettled(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const summary = serious.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes.length} node(s)\n` +
      v.nodes
        .slice(0, 4)
        .map((n) => `   ${n.target.join(' ')}\n   ${n.failureSummary?.split('\n')[1] ?? ''}`)
        .join('\n'),
  );
  expect(summary, summary.join('\n')).toEqual([]);
}

for (const [name, viewport] of [
  ['desktop', { width: 1280, height: 800 }],
  ['mobile 390x844', { width: 390, height: 844 }],
] as const) {
  test.describe(name, () => {
    // Reduced motion makes entrance animations (dialogs, the "Ready to work offline" toast that can
    // pop up at any moment once the service worker is installed) effectively instant, so a scan
    // never samples a half-faded element. The scans judge the settled UI, which is the same.
    test.use({ viewport, reducedMotion: 'reduce' });

    test('planner page has no serious violations', async ({ page }) => {
      await page.goto('/');
      await ready(page);
      await expectNoSeriousViolations(page);
    });

    test('planner with a dialog open has no serious violations', async ({ page }) => {
      await page.goto('/');
      await ready(page);
      await page.getByRole('button', { name: 'Share / Save' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoSeriousViolations(page);
    });

    test('planner with the Export dialog open has no serious violations', async ({ page }) => {
      await page.goto('/');
      await ready(page);
      await page.getByRole('button', { name: 'Export as image or PDF' }).click();
      // Found by its heading, not getByRole('dialog', { name }): in Playwright's Firefox, resolving a
      // dialog's aria-labelledby name and then running axe's aria-dialog-name rule crashes the page
      // (reproduces on a one-line static page; not an app bug).
      const dialog = page
        .getByRole('dialog')
        .filter({ has: page.getByRole('heading', { name: 'Export Floor Plan' }) });
      await expect(dialog).toBeVisible();
      await expectNoSeriousViolations(page);
    });

    test('planner with the Clear room confirmation has no serious violations', async ({ page }) => {
      await page.goto('/');
      await ready(page);
      await openStep(page, 'furniture');
      await page.getByRole('button', { name: 'Clear room' }).click();
      await expect(page.getByRole('alert').filter({ hasText: /Remove all/ })).toBeVisible();
      await expectNoSeriousViolations(page);
    });

    test('help page has no serious violations', async ({ page }) => {
      await page.goto('/help/');
      await expectNoSeriousViolations(page);
    });

    test('404 page has no serious violations', async ({ page }) => {
      await page.goto('/404');
      await expectNoSeriousViolations(page);
    });
  });
}

test('furniture can be selected, moved, rotated, undone and removed with the keyboard only', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  const items = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('room-sim-v3-items') ?? '[]'));
  const itemOf = async () => (await items()).find((i: { label: string }) => i.label === 'New Item');

  // Set up one piece (setup itself is mouse-free: Tab + Enter would work, click is just shorter).
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Add Item' }).click(); // closes the sheet on phones
  const piece = page.getByRole('button', { name: /^New Item,/ });
  await expect(piece).toBeVisible();
  const start = await itemOf();

  // Skip link jumps to the canvas; Tab then reaches the piece.
  await page.getByRole('link', { name: 'Skip to floor plan' }).focus();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 10 && !(await piece.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(piece).toBeFocused();
  await expect(piece).toHaveAttribute('aria-pressed', 'true');
  // Visible focus indicator.
  const outline = await piece.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe('solid');
  await expect(piece).toHaveAccessibleName(/^New Item, .* by .*, at .*, rotated 0°$/);

  // Arrow = 0.25 ft, Shift+arrow = 1 ft.
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await itemOf()).x).toBeCloseTo(start.x + 0.25, 5);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await itemOf()).y).toBeCloseTo(start.y + 1, 5);
  await expect(piece).toBeFocused();
  await expect(piece).toHaveAccessibleName(/at 4 ft 9 in, 6 ft 0 in|rotated 0°/);

  // Rotate both ways.
  await page.keyboard.press('r');
  await expect.poll(async () => (await itemOf()).rotation).toBe(90);
  await expect(piece).toHaveAccessibleName(/rotated 90°$/);
  await page.keyboard.press('Shift+R');
  await expect.poll(async () => (await itemOf()).rotation).toBe(0);
  await page.keyboard.press('r');
  await expect.poll(async () => (await itemOf()).rotation).toBe(90);

  // Undo steps back through the rotation.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await itemOf()).rotation).toBe(0);
  // The live region announces it (debounced).
  await expect(page.getByRole('status').filter({ hasText: /Undo/ })).toBeAttached();

  // Escape deselects and moves focus off the piece onto the canvas.
  await page.keyboard.press('Escape');
  await expect(piece).toHaveAttribute('aria-pressed', 'false');
  await expect(piece).not.toBeFocused();

  // Delete removes it (and undo brings it back).
  await piece.focus();
  await page.keyboard.press('Delete');
  await expect(piece).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('button', { name: /^New Item,/ })).toBeVisible();
});

test('modal traps focus, closes on Escape and returns focus to its trigger', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  const trigger = page.getByRole('button', { name: 'Share / Save' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Share & Save Layout' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('door handles are keyboard operable in room setup', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'room');
  await page.getByRole('button', { name: 'Add Door' }).click();
  await viewPlan(page);
  const handle = page.getByRole('button', { name: /^Door handle/ }).first();
  await handle.focus();
  const before = await handle.getAttribute('aria-label');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(handle).not.toHaveAttribute('aria-label', before!);
});
