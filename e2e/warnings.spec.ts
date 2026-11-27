import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { storedPieces } from './storage';
import { isNarrow, openStep, showEditor, viewPlan } from './ui';

// "Blocks door" and "Outside room" confused people after a resize or a turn (replays 01a218a4,
// 01a2147c): each badge now explains itself in one sentence and offers the fix in place, as one
// undo step.

const DOOR = { id: 1, width: 3, position: 4, wall: 'bottom', hinge: 'left', type: 'swing-in' };
/** In the 3 ft swing of the door (up to 2.4 ft from the wall). */
const CHAIR = {
  id: 2,
  label: 'Chair',
  width: 1,
  height: 1,
  x: 5,
  y: 9.6,
  rotation: 0,
  color: '#fdba74',
  visible: true,
};
/** Half out of the right wall. */
const SHELF = { ...CHAIR, id: 3, label: 'Shelf', x: 11.5, y: 3, width: 1, height: 2 };

async function seed(page: Page, items: object[]) {
  await page.addInitScript(
    ({ doors, items }) => {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.clear();
      localStorage.setItem('room-sim-v3-dims', JSON.stringify({ width: 12, height: 12 }));
      localStorage.setItem('room-sim-v3-doors', JSON.stringify(doors));
      localStorage.setItem('room-sim-v3-windows', '[]');
      localStorage.setItem('room-sim-v3-items', JSON.stringify(items));
      localStorage.setItem('room-sim-v3-mode', 'furniture');
      sessionStorage.setItem('seeded', '1');
    },
    { doors: [DOOR], items },
  );
  await page.goto('/');
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
  await viewPlan(page);
}

const popover = (page: Page) => page.getByTestId('warning-popover');
const notice = (page: Page) => page.getByTestId('app-notice');
const piece = async (page: Page, label: string) =>
  (await storedPieces(page)).find((p) => p.label === label)!;

test('"Blocks door": the badge explains it, and "Move it out of the way" fixes it (undoable)', async ({
  page,
}) => {
  await seed(page, [CHAIR]);
  const badge = page.getByTestId('door-block-badge');
  await expect(badge).toHaveText('Blocks door');
  await expect(badge).toHaveAttribute('aria-expanded', 'false');
  const before = await piece(page, 'Chair');
  await badge.click();
  await expect(popover(page)).toBeVisible();
  await expect(popover(page)).toContainText("This piece is in the door's swing path.");
  await expect(badge).toHaveAttribute('aria-expanded', 'true');
  const fix = popover(page).getByRole('button', { name: 'Move it out of the way' });
  await expect(fix).toBeFocused();
  // The popover is on screen, whole.
  const vp = page.viewportSize()!;
  const pb = (await popover(page).boundingBox())!;
  expect(pb.x).toBeGreaterThanOrEqual(0);
  expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width);
  const axe = await new AxeBuilder({ page })
    .include('[data-testid="warning-popover"]')
    .include('[data-testid="piece-badges"]')
    .analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
    [],
  );

  await fix.click();
  await expect(popover(page)).toHaveCount(0);
  await expect(page.getByTestId('door-block-badge')).toHaveCount(0);
  await expect(notice(page)).toContainText('Chair moved out of the way.');
  const after = await piece(page, 'Chair');
  expect(after.rotation).toBe(before.rotation);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(4);

  // One undo puts it back (in the door's way again).
  await notice(page).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('door-block-badge')).toHaveText('Blocks door');
  expect(await piece(page, 'Chair')).toEqual(before);
});

test('"Outside room": the badge says so, and "Move inside" brings it in', async ({ page }) => {
  await seed(page, [SHELF]);
  const badge = page.getByTestId('warning-badge');
  await badge.click();
  await expect(popover(page)).toContainText('This piece is partly outside the room.');
  await popover(page).getByRole('button', { name: 'Move inside' }).click();
  await expect(page.getByTestId('warning-badge')).toHaveCount(0);
  const shelf = await piece(page, 'Shelf');
  expect(shelf.x + shelf.width).toBeLessThanOrEqual(12 + 1e-6);
  await expect(notice(page)).toContainText('Shelf moved inside the room.');
});

test('keyboard: the badge is a button; Escape closes and focus goes back to it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'keyboard');
  await seed(page, [CHAIR]);
  const badge = page.getByTestId('door-block-badge');
  await expect(badge).toHaveAccessibleName(/^Chair: Blocks door\. What does this mean\?$/);
  await badge.focus();
  await page.keyboard.press('Enter');
  await expect(popover(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover(page)).toHaveCount(0);
  await expect(badge).toBeFocused();
  // Nothing moved.
  expect((await piece(page, 'Chair')).y).toBeCloseTo(9.6, 4);
});

test('the furniture card offers the same fix on its warning row', async ({ page }) => {
  await seed(page, [SHELF]);
  await openStep(page, 'furniture');
  await showEditor(page);
  await page.getByRole('button', { name: 'Move inside: Shelf' }).click();
  await expect.poll(async () => (await piece(page, 'Shelf')).x).toBeCloseTo(11, 4);
});

test('phone: tapping a badge shows the explanation above the sheet, and the fix works', async ({
  page,
}) => {
  test.skip(!isNarrow(page), 'phone layout');
  await seed(page, [CHAIR]);
  await page.getByTestId('door-block-badge').tap();
  await expect(popover(page)).toBeVisible();
  await page.waitForTimeout(300);
  const pb = (await popover(page).boundingBox())!;
  const sheet = (await page.getByTestId('sidebar').boundingBox())!;
  const vp = page.viewportSize()!;
  expect(pb.y + pb.height).toBeLessThanOrEqual(sheet.y + 1);
  expect(pb.x).toBeGreaterThanOrEqual(0);
  expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width);
  await popover(page).getByRole('button', { name: 'Move it out of the way' }).tap();
  await expect(page.getByTestId('door-block-badge')).toHaveCount(0);
});
