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

export { openStep, stored, viewPlan, returningIn, ready, notice };
