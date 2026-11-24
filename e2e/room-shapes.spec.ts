import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { workingPlan } from './storage';
import { animationsSettled, announcements, openStep, recordAnnouncements, viewPlan } from './ui';

// Room shapes (PR 7b, issue #11): the Shape control (Rectangle, L-shape, Custom), corner editing
// on the plan with the pointer, touch and keyboard, the wall list, doors on any wall, furniture in
// an L, and the outline in the export, the JSON and share links.

async function ready(page: Page) {
  await page.goto('/');
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

const outline = async (page: Page) => (await workingPlan(page)).rooms[0]!.outline;

/** The Shape control's options. */
const shape = (page: Page, name: 'Rectangle' | 'L-shape' | 'Custom') =>
  page.getByRole('radiogroup', { name: 'Room shape' }).getByRole('radio', { name });

const corner = (page: Page, i: number) => page.locator(`[data-corner="${i}"]`);

async function centre(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Pixels per foot on screen (the room box is the room plus its 4px walls on both sides). */
async function pxPerFoot(page: Page, widthFeet: number) {
  const room = (await page.getByTestId('room').boundingBox())!;
  return (room.width / (widthFeet * 40 + 8)) * 40;
}

/** Drag `el` by (dx, dy) px with touch pointer events (a finger on a phone). */
async function touchDrag(el: Locator, dx: number, dy: number) {
  const c = await centre(el);
  await el.evaluate(
    async (node, { x, y, dx, dy }) => {
      const o = (cx: number, cy: number, buttons: number) => ({
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'touch',
        isPrimary: true,
        clientX: cx,
        clientY: cy,
        button: 0,
        buttons,
      });
      node.dispatchEvent(new PointerEvent('pointerdown', o(x, y, 1)));
      for (let i = 1; i <= 8; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        window.dispatchEvent(
          new PointerEvent('pointermove', o(x + (dx * i) / 8, y + (dy * i) / 8, 1)),
        );
      }
      window.dispatchEvent(new PointerEvent('pointerup', o(x + dx, y + dy, 0)));
    },
    { ...c, dx, dy },
  );
}

test('rectangle, then L-shape, then Custom: fields, area and the outline', async ({ page }) => {
  await ready(page);
  await openStep(page, 'room');
  await expect(shape(page, 'Rectangle')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('room-area')).toHaveText('144 sq ft');

  await shape(page, 'L-shape').click();
  await expect(page.getByTestId('l-shape-fields')).toBeVisible();
  await expect(page.getByTestId('room-area')).toHaveText('108 sq ft');
  await expect.poll(() => outline(page)).toHaveLength(6);
  await expect(page.getByTestId('room')).toHaveAttribute('data-room-shape', 'outline');

  // The cut: top-left corner, 4' x 3'.
  await page.getByRole('radio', { name: 'Top left' }).click();
  await page.getByLabel('Cut-out width').fill('4');
  await page.getByLabel('Cut-out width').press('Enter');
  await page.getByLabel('Cut-out length').fill('3');
  await page.getByLabel('Cut-out length').press('Enter');
  await expect(page.getByTestId('room-area')).toHaveText('132 sq ft');
  await expect
    .poll(() => outline(page))
    .toEqual([
      { x: 4, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 12 },
      { x: 0, y: 12 },
      { x: 0, y: 3 },
      { x: 4, y: 3 },
    ]);

  // Custom keeps the outline and lists its walls.
  await shape(page, 'Custom').click();
  await expect(page.getByTestId('wall-row')).toHaveCount(6);
  await expect(page.getByLabel('Wall 1 length')).toHaveValue("8'");
  await expect(page.getByTestId('corner-handle')).toHaveCount(6);

  // Typing a wall's length moves its far corner along it.
  await page.getByLabel('Wall 1 length').fill('7');
  await page.getByLabel('Wall 1 length').press('Enter');
  await expect.poll(async () => (await outline(page))[1]).toEqual({ x: 11, y: 0 });

  // Back to a rectangle: the bounding box.
  await shape(page, 'Rectangle').click();
  await expect(page.getByTestId('corner-handle')).toHaveCount(0);
  await expect.poll(() => outline(page)).toHaveLength(4);
  await expect(page.getByTestId('room')).toHaveAttribute('data-room-shape', 'rect');
});

test('drag a corner with the mouse: it snaps square and is announced', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'touch drag is the next test');
  await ready(page);
  await openStep(page, 'room');
  await shape(page, 'Custom').click();
  await recordAnnouncements(page);
  const ppf = await pxPerFoot(page, 12);
  const c = await centre(corner(page, 2));
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  // Up and left by 2 ft and 3 ft, then a little back: lands on the 3-inch grid.
  await page.mouse.move(c.x - 2 * ppf, c.y - 3 * ppf, { steps: 6 });
  await expect(page.getByTestId('wall-length').first()).toBeVisible();
  await page.mouse.move(c.x - 2.05 * ppf, c.y - 3.02 * ppf, { steps: 2 });
  await page.mouse.up();
  await expect.poll(async () => (await outline(page))[2]).toEqual({ x: 10, y: 9 });
  await expect.poll(() => announcements(page)).toMatch(/Corner 3 moved\. Wall 2 is/);
  // One undo step puts it back.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await outline(page))[2]).toEqual({ x: 12, y: 12 });
});

test('drag a corner with a finger on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await openStep(page, 'room');
  await shape(page, 'Custom').click();
  await viewPlan(page);
  await animationsSettled(page);
  const ppf = await pxPerFoot(page, 12);
  await touchDrag(corner(page, 1), -3 * ppf, 0);
  await expect.poll(async () => (await outline(page))[1]).toEqual({ x: 9, y: 0 });
  // The plan did not pan: the corner is under the finger.
  const c = await centre(corner(page, 0));
  const moved = await centre(corner(page, 1));
  expect(Math.abs(moved.x - c.x - 9 * ppf)).toBeLessThan(3);
});

test('keyboard: Tab to a corner, nudge it with the arrow keys, add and remove corners', async ({
  page,
}) => {
  await ready(page);
  await openStep(page, 'room');
  await shape(page, 'Custom').click();
  await viewPlan(page);
  await recordAnnouncements(page);
  await corner(page, 1).focus();
  await expect(corner(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await outline(page))[1]).toEqual({ x: 11.75, y: 1 });
  await expect.poll(() => announcements(page)).toMatch(/Corner 2 moved\. Wall 1 is 11'9"/);

  // "+" in the middle of wall 1 adds corner 2 there and focuses it.
  await page.getByRole('button', { name: 'Add a corner in the middle of wall 1' }).click();
  await expect(page.getByTestId('corner-handle')).toHaveCount(5);
  await expect(corner(page, 1)).toBeFocused();
  await expect.poll(() => announcements(page)).toMatch(/Corner 2 added/);
  // Delete removes the focused corner.
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('corner-handle')).toHaveCount(4);
  await expect.poll(() => announcements(page)).toMatch(/Corner 2 removed/);

  // The selected corner's Remove button does the same; a triangle keeps its 3 corners.
  await corner(page, 3).focus();
  // (The pieces now outside get an offer to move them in; it is in the way of the button.)
  const notice = page.getByTestId('app-notice');
  if (await notice.isVisible()) await notice.getByRole('button', { name: 'Dismiss' }).click();
  await page.getByTestId('remove-corner').click();
  await expect(page.getByTestId('corner-handle')).toHaveCount(3);
  await expect(page.getByTestId('remove-corner')).toHaveCount(0);
  await corner(page, 0).focus();
  await page.keyboard.press('Delete');
  await expect.poll(() => announcements(page)).toMatch(/at least 3 corners/);
  await expect(page.getByTestId('corner-handle')).toHaveCount(3);
});

test('a door on an angled wall: picked from the wall list, drawn along the wall', async ({
  page,
}) => {
  await ready(page);
  await openStep(page, 'room');
  await shape(page, 'Custom').click();
  // Pull the bottom-right corner in to make wall 2 run at an angle: (12, 0) -> (9, 12).
  await corner(page, 2).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => (await outline(page))[2]).toEqual({ x: 9, y: 12 });
  await openStep(page, 'room');
  await page.getByRole('button', { name: 'Add Door' }).click();
  const card = page.getByTestId('door-card').last();
  const select = card.getByRole('combobox', { name: /^Door \d wall$/ });
  await expect(select.locator('option')).toHaveCount(4);
  await select.selectOption('1'); // Wall 2
  await expect
    .poll(async () =>
      (await workingPlan(page)).rooms[0]!.openings.filter((o) => o.kind === 'door').map(
        (o) => o.wall,
      ),
    )
    .toContain(1);
  const handle = page.getByRole('button', { name: /^Door handle.* on wall 2,/ });
  await expect(handle).toHaveCount(1);
  // Its wall gap is turned with the wall (76 degrees off the vertical, drawn bottom to top).
  const turned = await page
    .locator('[data-testid="room"] div[style*="rotate("]')
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform));
  expect(turned.some((t) => /rotate\(28[34]\./.test(t))).toBe(true);
});

test('furniture in an L: outside pieces are moved inside; a new piece lands inside', async ({
  page,
}) => {
  await ready(page);
  await openStep(page, 'room');
  await shape(page, 'L-shape').click();
  // The starter room's desk and chair are in the bottom-right cut-out.
  const move = page.getByRole('button', { name: /^Move (them|it) inside$/ });
  await expect(move).toBeVisible();
  await move.click();
  const outside = page.locator('[data-item-id] .sr-only', { hasText: 'Outside the room.' });
  await expect(outside).toHaveCount(0);
  await openStep(page, 'furniture');
  const pieces = page.locator('[data-item-id]');
  const before = await pieces.count();
  await page.getByRole('button', { name: 'Add Item' }).first().click();
  await expect(pieces).toHaveCount(before + 1);
  await expect(outside).toHaveCount(0);
});

test('the outline in the export, the JSON and a share link', async ({ page, context }) => {
  await ready(page);
  await openStep(page, 'room');
  await shape(page, 'L-shape').click();
  await expect.poll(() => outline(page)).toHaveLength(6);
  const want = await outline(page);

  // Print (the same drawing as the PNG and PDF): the room is drawn as its outline path.
  await page.getByRole('button', { name: 'Export' }).click();
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole('button', { name: /^Print/ }).click();
  const room = page.locator('#print-plan svg [data-role="room"]');
  await expect(room).toHaveCount(1);
  await expect(room.locator('path')).not.toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  await page.getByRole('button', { name: 'Share / Save' }).click();
  const dialog = page.getByRole('dialog');
  const json = JSON.parse(await dialog.locator('#layout-json').inputValue());
  expect(json.rooms[0].outline).toEqual(want);
  const url = await dialog.locator('#share-url').inputValue();
  expect(url).toMatch(/#s=/);

  // A fresh browser opens the link with the same room.
  const other = await context.browser()!.newContext();
  const fresh = await other.newPage();
  await fresh.goto(url);
  await fresh.waitForSelector('html[data-planner-ready]');
  await expect(fresh.getByTestId('room')).toHaveAttribute('data-room-shape', 'outline');
  await expect.poll(async () => (await workingPlan(fresh)).rooms[0]!.outline).toEqual(want);
  await other.close();
});

test('axe: corner handles, add-corner buttons and the wall list', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  await openStep(page, 'room');
  await shape(page, 'Custom').click();
  await corner(page, 1).focus();
  await expect(page.getByTestId('remove-corner')).toBeVisible();
  await page.getByLabel('Wall 2 length').focus();
  await expect(page.getByTestId('wall-highlight')).toHaveCount(1);
  await animationsSettled(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const serious = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(serious, serious.join('\n')).toEqual([]);
});
