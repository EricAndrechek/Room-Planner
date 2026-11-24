import { expect, test, type Page } from '@playwright/test';
import { openStep } from './ui';

// Adding doors/windows (issue #25): each new one lands in its own spot, is selected, and its
// sidebar card is scrolled into view and highlighted, on the desktop panel and the phone sheet.

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

const KINDS = [
  { kind: 'door', label: 'Door', key: 'room-sim-v3-doors' },
  { kind: 'window', label: 'Window', key: 'room-sim-v3-windows' },
] as const;

/** Bounding boxes of the on-canvas handles, rounded to whole pixels. */
const handleBoxes = (page: Page, label: string) =>
  page.getByRole('button', { name: new RegExp(`^${label} handle`) }).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map(Math.round).join(',');
    }),
  );

async function addThreeThenDelete(page: Page, { kind, label, key }: (typeof KINDS)[number]) {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'room');

  const cards = page.getByTestId(`${kind}-card`);
  const before = await cards.count();
  const add = page.getByRole('button', { name: `Add ${label}` });
  for (let i = 1; i <= 3; i++) {
    await add.click();
    await expect(cards).toHaveCount(before + i);
    // Each new card is smooth-scrolled into view (the cards are taller with the wall control):
    // let it arrive before the next click, which would otherwise hit a moving button.
    await expect(cards.last()).toBeInViewport();
  }

  // The newest card is in view and highlighted; the highlight fades.
  const newest = cards.last();
  await expect(newest).toContainText(`${label} ${before + 3}`);
  await expect(newest).toHaveAttribute('data-highlighted', 'true');
  await expect(newest).toBeInViewport();
  await expect(page.locator('[role="status"][aria-live="polite"]').first()).toContainText(
    new RegExp(`${label} ${before + 3} added on the (top|right|bottom|left) wall`),
  );
  await expect(newest).not.toHaveAttribute('data-highlighted', 'true', { timeout: 4000 });

  // Three distinct spots: in the saved layout and on the canvas.
  const stored: { wall: string; position: number }[] = await page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k) ?? '[]'),
    key,
  );
  expect(stored).toHaveLength(before + 3);
  const spots = stored.map((o) => `${o.wall}@${o.position}`);
  expect(new Set(spots).size).toBe(spots.length);
  const boxes = await handleBoxes(page, label);
  expect(boxes).toHaveLength(before + 3);
  expect(new Set(boxes).size).toBe(boxes.length);

  // Deleting works (and removes the newest first, as a user tapping the last card would).
  for (let i = 0; i < 3; i++) {
    await cards
      .last()
      .getByRole('button', { name: `Delete ${kind}` })
      .click();
  }
  await expect(cards).toHaveCount(before);
}

for (const opening of KINDS) {
  test(`adding ${opening.kind}s places each in a new spot and shows its card`, async ({ page }) => {
    await addThreeThenDelete(page, opening);
  });
}

// The phone layout (the bottom sheet, half open) in every project, including the desktop-only `ci` run.
test.describe('phone-sized viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const opening of KINDS) {
    test(`adding ${opening.kind}s in the bottom sheet keeps the new card in view`, async ({
      page,
    }) => {
      await addThreeThenDelete(page, opening);
    });
  }
});
