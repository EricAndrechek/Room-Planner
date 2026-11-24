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

// Set aside (the inventory, PR 8, reworked for the Floor plans release): a toggle at the top of the
// Items step, one action bar for the selected piece (and the same actions in each card's menu),
// Undo instead of a confirmation, and pieces put back exactly where they are dropped or tapped.

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

const piece = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name},`) });
const stored = async (page: Page, label: string) =>
  (await workingPlan(page)).items.find((i) => i.label === label);
const bar = (page: Page) => page.getByTestId('selection-actions');
const tab = (page: Page, name: 'room' | 'aside') =>
  page.getByRole('tab', { name: name === 'room' ? /^In the room/ : /^Set aside/ });
const asideNames = (page: Page) =>
  page
    .getByRole('list', { name: 'Pieces set aside' })
    .getByRole('listitem')
    .evaluateAll((rows) => rows.map((r) => r.querySelector('.truncate')?.textContent ?? ''));
const notice = (page: Page) => page.getByTestId('app-notice');
const saved = (page: Page) => expect(page.getByTestId('save-status')).toContainText('Saved');

/** Select a piece on the plan with the pointer the device has. */
async function pick(page: Page, name: string) {
  if (isNarrow(page)) await piece(page, name).tap();
  else await piece(page, name).click();
  await expect(piece(page, name)).toHaveAttribute('aria-pressed', 'true');
}

/** Where a piece's middle is on screen. */
async function centreOf(page: Page, name: string) {
  const b = (await piece(page, name).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** The screen point of a floor point (feet), from the floor's origin marker and the zoom. */
async function screenAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ([fx, fy]) => {
      const o = document.querySelector('[data-floor-origin]')!.getBoundingClientRect();
      const room = document.querySelector('[data-testid="room"]') as HTMLElement;
      const zoom = room.getBoundingClientRect().width / room.offsetWidth;
      return { x: o.left + fx! * 40 * zoom, y: o.top + fy! * 40 * zoom };
    },
    [x, y],
  );
}

test('the toggle and the selection bar: Set aside with Undo, kept across a reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await recordAnnouncements(page);

  await expect(tab(page, 'room')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('placed-count')).toHaveText('6');
  await expect(page.getByTestId('set-aside-count')).toHaveText('0');

  await pick(page, 'Chair');
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toHaveAttribute('data-variant', isNarrow(page) ? 'sheet' : 'canvas');
  await bar(page).getByRole('button', { name: 'Set Chair aside' }).click();
  await expect(piece(page, 'Chair')).toHaveCount(0);
  await expect(page.getByTestId('set-aside-count')).toHaveText('1');
  await expect(notice(page)).toContainText('Chair set aside.');
  await expect.poll(() => announcements(page)).toContain('Chair set aside');
  expect(await stored(page, 'Chair')).not.toHaveProperty('placement');

  // Undo from the toast puts it back where it was.
  await notice(page).getByRole('button', { name: 'Undo' }).click();
  await expect(piece(page, 'Chair')).toBeVisible();
  await expect(page.getByTestId('set-aside-count')).toHaveText('0');

  await pick(page, 'Chair');
  await bar(page).getByRole('button', { name: 'Set Chair aside' }).click();
  await tab(page, 'aside').click();
  await expect(tab(page, 'aside')).toHaveAttribute('aria-selected', 'true');
  expect(await asideNames(page)).toEqual(['Chair']);

  await saved(page);
  await page.reload();
  await ready(page);
  await openStep(page, 'furniture');
  await tab(page, 'aside').click();
  expect(await asideNames(page)).toEqual(['Chair']);
  await expect(piece(page, 'Chair')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('rotate, duplicate and delete (with Undo) from the bar; the card menu has the same actions', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');

  await pick(page, 'Desk');
  await bar(page).getByRole('button', { name: 'Rotate Desk 90°' }).click();
  await expect.poll(async () => (await stored(page, 'Desk'))?.placement?.rotation).toBe(90);

  await bar(page).getByRole('button', { name: 'Duplicate Desk' }).click();
  await expect(piece(page, 'Desk')).toHaveCount(2);
  await expect.poll(async () => (await workingPlan(page)).items.length).toBe(7);

  // The copy is selected: delete it, and undo.
  await bar(page).getByRole('button', { name: 'Delete Desk' }).click();
  await expect(piece(page, 'Desk')).toHaveCount(1);
  await expect(notice(page)).toContainText('Desk deleted.');
  await notice(page).getByRole('button', { name: 'Undo' }).click();
  await expect(piece(page, 'Desk')).toHaveCount(2);

  // The card's "…" menu: the four actions, keyboard operable.
  if (isNarrow(page)) await setDetent(page, 'full');
  const more = page.getByRole('button', { name: 'More actions for Bed' });
  await more.click();
  const menu = page.getByRole('menu', { name: 'Bed actions' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Rotate 90°',
    'Duplicate',
    'Set aside',
    'Delete',
  ]);
  await expect(menu.getByRole('menuitem', { name: 'Rotate 90°' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Duplicate' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();
  await more.click();
  await menu.getByRole('menuitem', { name: 'Set aside' }).click();
  await expect(page.getByTestId('set-aside-count')).toHaveText('1');
  expect(await stored(page, 'Bed')).not.toHaveProperty('placement');
});

test('drag a set-aside piece onto the plan: it lands where it is dropped', async ({ page }) => {
  test.skip(isNarrow(page), 'mouse drag on the desktop layout (touch: the next test)');
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await recordAnnouncements(page);
  await piece(page, 'Chair').focus();
  await page.keyboard.press('i');
  await tab(page, 'aside').click();

  const row = page.locator('[data-set-aside-id]').filter({ hasText: 'Chair' });
  const from = (await row.boundingBox())!;
  // Free floor in the starter room: about (4.5, 9) ft, between the dresser and the door.
  const to = await screenAt(page, 4.5, 9);
  await page.mouse.move(from.x + 60, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x - 80, to.y, { steps: 6 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await expect(page.getByTestId('placement-ghost')).toBeVisible();
  await page.mouse.up();
  await expect(piece(page, 'Chair')).toBeVisible();
  await expect(page.getByTestId('placement-ghost')).toHaveCount(0);
  const p = (await stored(page, 'Chair'))!.placement!;
  expect(Math.abs(p.x - 4.5)).toBeLessThan(0.6);
  expect(Math.abs(p.y - 9)).toBeLessThan(0.6);
  await expect(piece(page, 'Chair')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => announcements(page)).toContain('Chair placed in the room');
  // One undo step sets it aside again.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(piece(page, 'Chair')).toHaveCount(0);
});

test('touch: drag a set-aside piece by its grip onto the plan', async ({ page, browserName }) => {
  test.skip(!isNarrow(page) || browserName !== 'chromium', 'touch events through CDP (Chromium)');
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await pick(page, 'Chair');
  await bar(page).getByRole('button', { name: 'Set Chair aside' }).click();
  await setDetent(page, 'half');
  await tab(page, 'aside').click();
  const grip = page
    .locator('[data-set-aside-id]')
    .filter({ hasText: 'Chair' })
    .getByTestId('set-aside-grip');
  await grip.scrollIntoViewIfNeeded();
  const g = (await grip.boundingBox())!;
  const to = await screenAt(page, 4.5, 9);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }],
    });
  await touch('touchStart', g.x + g.width / 2, g.y + g.height / 2);
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    await touch('touchMove', g.x + (to.x - g.x) * t, g.y + (to.y - g.y) * t);
  }
  await touch('touchEnd', to.x, to.y);
  await expect(piece(page, 'Chair')).toBeVisible();
  const p = (await stored(page, 'Chair'))!.placement!;
  expect(Math.abs(p.x - 4.5)).toBeLessThan(0.75);
  expect(Math.abs(p.y - 9)).toBeLessThan(0.75);
});

test('tap to place: an outline follows, Cancel and Escape stop, a tap puts it there', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await pick(page, 'Chair');
  await bar(page).getByRole('button', { name: 'Set Chair aside' }).click();
  await tab(page, 'aside').click();

  const place = page.getByRole('button', { name: 'Place Chair' });
  const banner = page.getByTestId('placement-banner');
  await place.click();
  await expect(banner).toContainText(`${isNarrow(page) ? 'Tap' : 'Click'} where Chair goes`);
  if (!isNarrow(page)) {
    const at = await screenAt(page, 4.5, 9);
    await page.mouse.move(at.x, at.y);
    await expect(page.getByTestId('placement-ghost')).toBeVisible();
    await expect(page.getByTestId('placement-ghost')).toHaveAttribute('data-ok', 'true');
  }
  await banner.getByRole('button', { name: 'Cancel' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId('placement-ghost')).toHaveCount(0);

  if (!isNarrow(page)) {
    await place.click();
    await expect(banner).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(banner).toHaveCount(0);
  }

  if (isNarrow(page)) await setDetent(page, 'half');
  await place.click();
  await expect(banner).toBeVisible();
  await animationsSettled(page);
  const at = await screenAt(page, 4.5, 9);
  if (isNarrow(page)) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await expect(banner).toHaveCount(0);
  await expect(piece(page, 'Chair')).toBeVisible();
  await expect(piece(page, 'Chair')).toHaveAttribute('aria-pressed', 'true');
  const p = (await stored(page, 'Chair'))!.placement!;
  expect(Math.abs(p.x - 4.5)).toBeLessThan(0.6);
  expect(Math.abs(p.y - 9)).toBeLessThan(0.6);
});

test('keyboard: I sets a piece aside, Place with Enter finds a free spot; the shortcut is listed', async ({
  page,
}) => {
  test.skip(isNarrow(page), 'a hardware keyboard on the desktop layout');
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await recordAnnouncements(page);
  await piece(page, 'Dresser').focus();
  await page.keyboard.press('i');
  await expect(piece(page, 'Dresser')).toHaveCount(0);
  await expect.poll(() => announcements(page)).toContain('Dresser set aside');
  // The focus stays on the plan, where Tab reaches the next piece.
  await expect(page.locator('#floor-plan')).toBeFocused();

  await tab(page, 'aside').click();
  await page.getByRole('button', { name: 'Place Dresser' }).focus();
  await page.keyboard.press('Enter');
  const dresser = piece(page, 'Dresser');
  await expect(dresser).toBeVisible();
  await expect(dresser).not.toHaveAccessibleDescription(/Outside|Overlapping|door|doorway/);
  await expect(page.getByTestId('placement-banner')).toHaveCount(0);
  await expect.poll(() => announcements(page)).toContain('Dresser placed in the room');
  // The list emptied: the focus went to its tab, not to the page.
  await expect(tab(page, 'aside')).toBeFocused();
  // Arrow keys move between the two tabs.
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, 'room')).toBeFocused();
  await expect(tab(page, 'room')).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toContainText('Set the selected piece aside');
});

test('a share link carries the pieces set aside', async ({ page, browser }) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await pick(page, 'Bed');
  await bar(page).getByRole('button', { name: 'Set Bed aside' }).click();
  await saved(page);
  await page.getByRole('button', { name: 'Share / Save' }).click();
  const shareInput = page.locator('#share-url');
  await expect(shareInput).toHaveValue(/#s=[A-Za-z0-9_-]+$/);
  const url = await shareInput.inputValue();

  const fresh = await browser.newContext(test.info().project.use);
  const other = await fresh.newPage();
  await other.goto(url);
  await ready(other);
  await expect(piece(other, 'Bed')).toHaveCount(0);
  await openStep(other, 'furniture');
  await expect(other.getByTestId('set-aside-count')).toHaveText('1');
  await tab(other, 'aside').click();
  expect(await asideNames(other)).toEqual(['Bed']);
  await fresh.close();
});

test.describe('accessibility', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the toggle, the lists, the selection bar and the placement banner have no serious axe violations', async ({
    page,
  }) => {
    await page.goto('/');
    await ready(page);
    await openStep(page, 'furniture');
    const scan = async (include: string) => {
      await animationsSettled(page);
      const results = await new AxeBuilder({ page })
        .include(include)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    };
    await pick(page, 'Desk');
    await scan('[data-testid="selection-actions"]');
    await bar(page).getByRole('button', { name: 'Set Desk aside' }).click();
    await pick(page, 'Chair');
    await bar(page).getByRole('button', { name: 'Set Chair aside' }).click();
    if (isNarrow(page)) await setDetent(page, 'full');
    await scan('[data-testid="sidebar"]');
    await tab(page, 'aside').click();
    await expect(page.locator('[data-set-aside-id]')).toHaveCount(2);
    await scan('[data-testid="sidebar"]');
    if (isNarrow(page)) await setDetent(page, 'half');
    await page.getByRole('button', { name: 'Place Desk' }).click();
    await scan('[data-testid="placement-banner"]');
  });
});
