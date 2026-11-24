import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { workingPlan } from './storage';
import {
  animationsSettled,
  announcements,
  isNarrow,
  openStep,
  recordAnnouncements,
  setDetent,
} from './ui';

// The inventory (PR 8, docs/design/plan-format.md, sections 3 and 9): pieces taken out of the room
// wait in a tray in the Furniture step and go back to a free spot with "Place".

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

const tray = (page: Page) => page.getByTestId('inventory');
const trayNames = (page: Page) =>
  tray(page)
    .getByRole('listitem')
    .evaluateAll((rows) => rows.map((r) => r.querySelector('.truncate')?.textContent ?? ''));
const piece = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name},`) });
const stored = async (page: Page, label: string) =>
  (await workingPlan(page)).items.find((i) => i.label === label);

/** Wait for the debounced save, so a reload reads what the screen shows. */
const saved = (page: Page) => expect(page.getByTestId('save-status')).toContainText('Saved');

test('from the card: out, undo, redo, kept across a reload, placed back free and selected', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await recordAnnouncements(page);

  // Empty to start with: one line says what it is for.
  await expect(tray(page)).toContainText('Inventory');
  await expect(tray(page)).toContainText('Pieces you take out of the room wait here');

  await page.getByRole('button', { name: 'Move Chair to inventory' }).click();
  await expect(piece(page, 'Chair')).toHaveCount(0);
  await expect(page.getByTestId('furniture-card')).toHaveCount(5);
  expect(await trayNames(page)).toEqual(['Chair']);
  await expect(page.getByTestId('inventory-count')).toHaveText('1');
  await expect(tray(page).getByRole('list', { name: 'Pieces not in the room' })).toBeVisible();
  // The focus followed the piece: Enter puts it straight back.
  await expect(page.getByRole('button', { name: 'Place Chair in the room' })).toBeFocused();
  await expect.poll(() => announcements(page)).toContain('Chair moved to inventory');
  const out = await stored(page, 'Chair');
  expect(out).toMatchObject({ width: 1.5, depth: 1.5, color: '#fdba74' });
  expect(out).not.toHaveProperty('placement');
  await expect(page.getByTestId('step-header').nth(1)).toContainText('5 items');

  // One undo step each way.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(piece(page, 'Chair')).toBeVisible();
  await expect(tray(page).getByRole('listitem')).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(piece(page, 'Chair')).toHaveCount(0);
  expect(await trayNames(page)).toEqual(['Chair']);

  // Kept across a reload.
  await saved(page);
  await page.reload();
  await ready(page);
  await openStep(page, 'furniture');
  expect(await trayNames(page)).toEqual(['Chair']);
  await expect(piece(page, 'Chair')).toHaveCount(0);

  // Placed back: in free floor, selected, its card highlighted, announced.
  await recordAnnouncements(page);
  await page.getByRole('button', { name: 'Place Chair in the room' }).click();
  const chair = piece(page, 'Chair');
  await expect(chair).toBeVisible();
  await expect(chair).toHaveAttribute('aria-pressed', 'true');
  await expect(chair).not.toHaveAccessibleDescription(/Outside|Overlapping|door|doorway/);
  await expect(page.locator('[data-highlighted]').getByTestId('furniture-card')).toHaveCount(1);
  await expect(tray(page).getByRole('listitem')).toHaveCount(0);
  await expect.poll(() => announcements(page)).toContain('Chair placed in the room');
  const back = await stored(page, 'Chair');
  expect(back?.placement?.rotation).toBe(0);
  // The focus stays in the tray (on its button, the list being empty), not lost to the page.
  await expect(tray(page).getByRole('button', { name: /^Inventory/ })).toBeFocused();
  expect(errors).toEqual([]);
});

test('from the plan: the selected piece goes to the inventory', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await piece(page, 'Desk').click();
  const action = page
    .getByRole('button', { name: 'Move Desk to inventory' })
    .and(page.getByTestId('selection-to-inventory'));
  await expect(action).toBeVisible();
  await action.click();
  await expect(piece(page, 'Desk')).toHaveCount(0);
  await expect(page.getByTestId('selection-to-inventory')).toHaveCount(0);
  await openStep(page, 'furniture');
  expect(await trayNames(page)).toEqual(['Desk']);
  expect(await stored(page, 'Desk')).not.toHaveProperty('placement');
  // Nothing is offered while the room is being edited (furniture is locked then).
  await openStep(page, 'room');
  await piece(page, 'Bed').click();
  await expect(page.getByTestId('selection-to-inventory')).toHaveCount(0);
});

test('with the keyboard: I moves the focused piece to the inventory', async ({ page }) => {
  test.skip(isNarrow(page), 'a hardware keyboard on the desktop layout');
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await recordAnnouncements(page);
  await piece(page, 'Dresser').focus();
  await page.keyboard.press('i');
  await expect(piece(page, 'Dresser')).toHaveCount(0);
  expect(await trayNames(page)).toEqual(['Dresser']);
  await expect.poll(() => announcements(page)).toContain('Dresser moved to inventory');
  // The focus goes back to the plan, where Tab reaches the next piece.
  await expect(page.locator('#floor-plan')).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(piece(page, 'Dresser')).toBeVisible();
  // The shortcut is listed.
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toContainText('Move the selected piece to the inventory');
});

test('a piece dragged off the plan onto the tray goes to the inventory', async ({ page }) => {
  test.skip(isNarrow(page), 'mouse drag onto the desktop sidebar');
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  const before = await stored(page, 'Nightstand');
  const from = (await piece(page, 'Nightstand').first().boundingBox())!;
  await tray(page).scrollIntoViewIfNeeded();
  const to = (await tray(page).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await expect(tray(page)).toHaveAttribute('data-drop-active', '');
  await expect(tray(page)).toContainText('Drop to move it to the inventory');
  await page.mouse.up();
  await expect(tray(page)).not.toHaveAttribute('data-drop-active');
  expect(await trayNames(page)).toEqual(['Nightstand']);
  // One undo step puts it back where it was before the drag.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(tray(page).getByRole('listitem')).toHaveCount(0);
  expect(await stored(page, 'Nightstand')).toEqual(before);
});

test('a share link carries the inventory', async ({ page, browser }) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Move Bed to inventory' }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Share / Save' }).click();
  const shareInput = page.locator('#share-url');
  await expect(shareInput).toHaveValue(/#s=[A-Za-z0-9_-]+$/);
  const url = await shareInput.inputValue();

  const fresh = await browser.newContext(test.info().project.use);
  const other = await fresh.newPage();
  await other.goto(url);
  await ready(other);
  await expect(other.getByRole('dialog')).toHaveCount(0);
  await expect(piece(other, 'Bed')).toHaveCount(0);
  await openStep(other, 'furniture');
  expect(await trayNames(other)).toEqual(['Bed']);
  await other.getByRole('button', { name: 'Place Bed in the room' }).click();
  await expect(piece(other, 'Bed')).toBeVisible();
  await fresh.close();
});

test.describe('accessibility', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the tray, empty and with pieces, has no serious axe violations', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await openStep(page, 'furniture');
    if (isNarrow(page)) await setDetent(page, 'full');
    const scan = async () => {
      await animationsSettled(page);
      const results = await new AxeBuilder({ page })
        .include('[data-testid="inventory"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    };
    await scan();
    await page.getByRole('button', { name: 'Move Chair to inventory' }).click();
    await page.getByRole('button', { name: 'Move Desk to inventory' }).click();
    await expect(tray(page).getByRole('listitem')).toHaveCount(2);
    await scan();
    // Collapsible, with its state on the button.
    const toggle = tray(page).getByRole('button', { name: 'Inventory (2 pieces)' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(tray(page).getByRole('listitem')).toHaveCount(0);
    await scan();
  });
});
