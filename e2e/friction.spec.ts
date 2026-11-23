import { expect, test, type Page } from '@playwright/test';
import { isNarrow, openStep, viewPlan } from './ui';

/** Wait for the island to mount and for the initial auto-fit zoom (500ms) to settle. */
async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

/** Make this a returning visitor: something is stored already (here, the mode they left in). */
const returningIn = (page: Page, mode: 'room-setup' | 'furniture') =>
  page.addInitScript((m) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('room-sim-v3-mode', m);
    localStorage.setItem('room-sim-v3-dims', JSON.stringify({ width: 12, height: 12 }));
  }, mode);

const stored = <T>(page: Page, key: string): Promise<T> =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key);

const badge = (page: Page) => page.getByTestId('mode-badge');
const notice = (page: Page) => page.getByTestId('app-notice');

test.describe('locked furniture in room setup', () => {
  test('a fresh visitor starts in Furniture mode and can drag a sample piece', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await expect(badge(page)).toContainText(/Furniture Mode|Drag to move/);
    expect(await page.evaluate(() => localStorage.getItem('room-sim-v3-mode'))).toBe('furniture');
  });

  test('a returning visitor keeps the mode they were in (room setup)', async ({ page }) => {
    await returningIn(page, 'room-setup');
    await page.goto('/');
    await ready(page);
    await expect(badge(page)).toContainText(/Room Setup Mode|Room setup · furniture locked/);
  });

  test('pressing a locked piece explains why, and "Move furniture" switches mode and selects it', async ({
    page,
  }) => {
    await returningIn(page, 'room-setup');
    await page.goto('/');
    await ready(page);
    const desk = page.getByRole('button', { name: /^Desk,/ });
    const before = await desk.boundingBox();
    await desk.click();
    await expect(notice(page)).toContainText('Furniture is locked while you edit the room.');
    // Nothing moved.
    expect(await desk.boundingBox()).toEqual(before);

    // Pressing again right away does not stack or flash a second notice.
    await desk.click();
    await expect(notice(page)).toHaveCount(1);

    await notice(page).getByRole('button', { name: 'Move furniture' }).click();
    await expect(notice(page)).toHaveCount(0);
    await expect(badge(page)).toContainText(/Furniture Mode|Drag to move/);
    await expect(desk).toHaveAttribute('aria-pressed', 'true');
  });

  test('keyboard: arrows on a locked piece show the same notice', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard');
    await returningIn(page, 'room-setup');
    await page.goto('/');
    await ready(page);
    const bed = page.getByRole('button', { name: /^Bed,/ });
    await bed.focus();
    const items = await stored<{ x: number }[]>(page, 'room-sim-v3-items');
    await page.keyboard.press('ArrowRight');
    await expect(notice(page)).toContainText('Furniture is locked');
    expect(await stored(page, 'room-sim-v3-items')).toEqual(items);
  });

  test('the phone badge says furniture is locked, on one line', async ({ page }) => {
    test.skip(!isNarrow(page), 'phone layout');
    await returningIn(page, 'room-setup');
    await page.goto('/');
    await ready(page);
    await expect(badge(page).getByText('Room setup · furniture locked')).toBeVisible();
    const truncated = await badge(page).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(truncated).toBe(false);
  });
});

test.describe('room size input', () => {
  test('an over-limit size is rejected with an inline error, not clamped', async ({ page }) => {
    await returningIn(page, 'room-setup');
    await page.goto('/');
    await ready(page);
    await openStep(page, 'room');
    const width = page.getByLabel('Room width');
    await width.fill('117');
    await width.press('Enter');
    await expect(width).toHaveAttribute('aria-invalid', 'true');
    const describedBy = (await width.getAttribute('aria-describedby'))!;
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(
      `Max 100'. For 11'7", type 11 7`,
    );
    await expect(width).toHaveValue(`12'`);
    expect(await stored(page, 'room-sim-v3-dims')).toEqual({ width: 12, height: 12 });

    // Typing again clears the error; "11 7" is 11'7".
    await width.fill('11 7');
    await expect(width).not.toHaveAttribute('aria-invalid');
    await width.press('Enter');
    await expect(width).toHaveValue(`11'7"`);
    await expect
      .poll(async () => (await stored<{ width: number }>(page, 'room-sim-v3-dims')).width)
      .toBeCloseTo(11 + 7 / 12, 6);
  });

  test('the view re-fits after the room size changes, so the whole room stays visible', async ({
    page,
  }) => {
    await returningIn(page, 'room-setup');
    await page.goto('/');
    await ready(page);
    await openStep(page, 'room');
    const width = page.getByLabel('Room width');
    await width.fill('60');
    await width.press('Enter');
    await viewPlan(page);
    await page.waitForTimeout(400);
    const plan = (await page.locator('#floor-plan').boundingBox())!;
    const room = (await page.getByTestId('room').boundingBox())!;
    expect(room.x).toBeGreaterThanOrEqual(plan.x - 1);
    expect(room.x + room.width).toBeLessThanOrEqual(plan.x + plan.width + 1);
    // And it was not just left tiny: it fills most of the width.
    expect(room.width).toBeGreaterThan(plan.width * 0.6);
  });
});

test('Add Item lands in free floor near the middle, selected, with its card in view', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Add Item' }).click();
  const piece = page.getByRole('button', { name: /^New Item,/ });
  await expect(piece).toHaveAttribute('aria-pressed', 'true');
  const items = await stored<{ label: string; x: number; y: number }[]>(page, 'room-sim-v3-items');
  // Not dropped on the bed in the middle: the nearest free spot (touching the foot of the bed).
  expect(items.find((i) => i.label === 'New Item')).toMatchObject({ x: 4.5, y: 6.5 });
  await expect(page.getByText(/Overlapping|Outside room|Blocks door/)).toHaveCount(0);
  if (!isNarrow(page)) {
    // The sidebar keeps the new card in view, briefly highlighted.
    const card = page
      .locator('[data-highlighted]')
      .filter({ has: page.getByTestId('furniture-card') });
    await expect(card).toBeInViewport();
  }

  // Again: the second one finds another free spot.
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Add Item' }).click();
  await expect(page.getByRole('button', { name: /^New Item,/ })).toHaveCount(2);
  await expect(page.getByText(/Overlapping|Outside room|Blocks door/)).toHaveCount(0);
});

export { notice };
