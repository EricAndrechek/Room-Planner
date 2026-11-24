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
  viewPlan,
} from './ui';

// Floors of several rooms (PR 9, docs/design/plan-format.md, sections 3 and 9): rooms added beside
// each other, moved with their walls snapping together, doors on the walls they share, furniture
// moved from room to room, and the whole floor exported and shared.

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

const rect = (w: number, h: number, x = 0, y = 0) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

interface Doc {
  rooms: unknown[];
  items?: unknown[];
}
const planLink = (doc: Doc) =>
  `/#j=${Buffer.from(JSON.stringify({ version: 4, name: 'Flat', unit: 'ft', items: [], ...doc })).toString('base64url')}`;

/** Kitchen 12 x 12 at the origin and Den 8 x 8, `gap` feet to its right (0: sharing its wall). */
const twoRooms = (gap = 0, extra: Partial<Doc> = {}): Doc => ({
  rooms: [
    { id: 'room-1', name: 'Kitchen', outline: rect(12, 12), openings: [] },
    { id: 'room-2', name: 'Den', outline: rect(8, 8, 12 + gap, 0), openings: [] },
  ],
  items: [
    {
      id: 'item-1',
      label: 'Chair',
      color: '#fdba74',
      width: 1.5,
      depth: 1.5,
      placement: { x: 6, y: 6 },
    },
  ],
  ...extra,
});

async function open(page: Page, doc: Doc) {
  await page.goto(planLink(doc));
  await ready(page);
}

const roomsOf = async (page: Page) => (await workingPlan(page)).rooms;
const handle = (page: Page, name: string) =>
  page.getByTestId('room-handle').filter({ hasText: name });
const piece = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name},`) });

/** The screen point of a floor point (feet). */
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

/** Drag with the mouse from one screen point to another, in steps. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

test('add a room beside the first, rename it, and see both rooms on the plan', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await ready(page);
  await openStep(page, 'room');
  await recordAnnouncements(page);
  await page.getByTestId('add-room').click();

  await expect.poll(async () => (await roomsOf(page)).length).toBe(2);
  const [first, second] = await roomsOf(page);
  // Against the starter room's right side, flush: they share its right wall.
  expect(second!.outline).toEqual(rect(10, 10, 12, 0));
  expect(first!.outline).toEqual(rect(12, 12));
  expect(second!.name).toBe('Room 2');
  await expect.poll(() => announcements(page)).toContain('Room 2 added beside Room 1');

  if (isNarrow(page)) await setDetent(page, 'full');
  await expect(page.getByTestId('room-row')).toHaveCount(2);
  await expect(page.getByTestId('editing-room')).toHaveText('Room 2');
  const name = page.getByTestId('room-name');
  await name.fill('Hallway');
  await name.press('Enter');
  await expect.poll(async () => (await roomsOf(page))[1]!.name).toBe('Hallway');
  await expect(page.getByTestId('floor-total')).toContainText('2 rooms · 244 sq ft in all');

  // On the plan: both rooms' names (as handles in Room Setup), and the chips.
  if (isNarrow(page)) await setDetent(page, 'half');
  await expect(page.getByTestId('room-handle')).toHaveCount(2);
  await expect(page.getByTestId('room-chips').getByRole('button')).toHaveText([
    'Whole floor',
    'Room 1',
    'Hallway',
  ]);
  await expect(page.getByTestId('shared-wall')).toHaveCount(1);
  if (!isNarrow(page))
    await expect(page.getByTestId('floor-summary')).toHaveText('2 rooms (244 sq ft)');
  expect(errors).toEqual([]);
});

test('move a room by dragging: it snaps flush, and goes back if it would overlap', async ({
  page,
}) => {
  test.skip(isNarrow(page), 'mouse drags on the desktop layout');
  await open(page, twoRooms(2.2));
  await openStep(page, 'room');
  await recordAnnouncements(page);
  const den = handle(page, 'Den');
  const b = (await den.boundingBox())!;
  const from = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  // 2.15 ft to the left: its left wall lands 0.05 ft from the kitchen's right wall, well within
  // the snap distance on any engine.
  const step = (await screenAt(page, 1, 0)).x - (await screenAt(page, 0, 0)).x;
  await drag(page, from, { x: from.x - 2.15 * step, y: from.y + 0.05 * step });
  await expect.poll(async () => (await roomsOf(page))[1]!.outline[0]).toEqual({ x: 12, y: 0 });
  await expect.poll(() => announcements(page)).toContain('Den moved');

  // Onto the kitchen: it goes back to where it last fitted.
  const b2 = (await den.boundingBox())!;
  const from2 = { x: b2.x + b2.width / 2, y: b2.y + b2.height / 2 };
  await drag(page, from2, { x: from2.x - 5 * step, y: from2.y + 2 * step });
  await expect.poll(() => announcements(page)).toMatch(/rooms cannot overlap|can't go there/);
  const outline = (await roomsOf(page))[1]!.outline;
  expect(outline[0]!.x).toBeGreaterThanOrEqual(12);

  // Keyboard: arrows move the focused room; a move onto the kitchen is refused.
  await den.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await roomsOf(page))[1]!.outline[0]!.y).toBe(outline[0]!.y + 1);
  const before = (await roomsOf(page))[1]!.outline;
  if (before[0]!.x === 12) {
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(() => announcements(page))
      .toContain("Den can't go there: it would overlap Kitchen");
    expect((await roomsOf(page))[1]!.outline).toEqual(before);
  }
  // The position fields are the precise way.
  const left = page.getByLabel('Den: distance from the left of the floor');
  await left.fill('15');
  await left.press('Enter');
  await expect.poll(async () => (await roomsOf(page))[1]!.outline[0]!.x).toBe(15);
});

test('a door on the wall two rooms share connects them, and opens into either', async ({
  page,
}) => {
  await open(page, twoRooms(0));
  await openStep(page, 'room');
  if (isNarrow(page)) await setDetent(page, 'full');
  await page.getByTestId('room-row').filter({ hasText: 'Den' }).click();
  await expect(page.getByTestId('editing-room')).toHaveText('Den');
  await page.getByRole('button', { name: 'Add Door' }).click();
  const card = page.getByTestId('door-card');
  await card.getByRole('radio', { name: 'Left' }).click();
  await expect(card.getByTestId('door-connects')).toHaveText('Den ↔ Kitchen');
  await expect(card.getByTestId('door-opens-into')).toHaveText('Opens into Den');
  await card.getByLabel('Door 1 type').selectOption('swing-out');
  await expect(card.getByTestId('door-opens-into')).toHaveText('Opens into Kitchen');
  const den = (await roomsOf(page))[1]!;
  expect(den.openings).toMatchObject([{ kind: 'door', wall: 3, type: 'swing-out' }]);
  // The kitchen lists it as a door from the den.
  await page.getByTestId('room-row').filter({ hasText: 'Kitchen' }).click();
  await expect(page.getByTestId('incoming-door')).toContainText('A door from Den opens here.');
  // A window on the shared wall is flagged.
  await page.getByRole('button', { name: 'Add Window' }).click();
  await page.getByTestId('window-card').getByRole('radio', { name: 'Right' }).click();
  await expect(page.getByTestId('window-shared-wall')).toContainText('shared with Den');
});

test('move a piece to another room: through the doorway by dragging, and by setting it aside', async ({
  page,
}) => {
  test.skip(isNarrow(page), 'mouse drag on the desktop layout');
  const door = { id: 'door-1', kind: 'door', wall: 1, offset: 4, width: 3, type: 'sliding' };
  await open(page, {
    ...twoRooms(0),
    rooms: [
      { id: 'room-1', name: 'Kitchen', outline: rect(12, 12), openings: [door] },
      { id: 'room-2', name: 'Den', outline: rect(8, 8, 12, 0), openings: [] },
    ],
  });
  await openStep(page, 'furniture');
  await recordAnnouncements(page);
  const from = await screenAt(page, 6, 6);
  await drag(page, from, await screenAt(page, 16, 3));
  await expect
    .poll(async () => (await workingPlan(page)).items[0]!.placement!.x)
    .toBeGreaterThan(12);
  await expect(piece(page, 'Chair')).not.toHaveAccessibleDescription(/Outside/);
  await expect(page.getByTestId('room-group')).toHaveText(['Den']);

  // Set aside, then placed with the keyboard in the room picked with the chips.
  await page
    .getByTestId('selection-actions')
    .getByRole('button', { name: 'Set aside Chair' })
    .click();
  await page.getByTestId('room-chips').getByRole('button', { name: 'Kitchen' }).click();
  await page.getByRole('tab', { name: /^Set aside/ }).click();
  await page.getByRole('button', { name: 'Place Chair' }).press('Enter');
  await expect
    .poll(async () => (await workingPlan(page)).items[0]!.placement?.x ?? 99)
    .toBeLessThan(12);
  await expect.poll(() => announcements(page)).toContain('Chair placed in Kitchen');
});

test('delete a room: its furniture is set aside, and Undo brings everything back', async ({
  page,
}) => {
  await open(
    page,
    twoRooms(0, {
      items: [
        { id: 'item-1', label: 'Chair', width: 1.5, depth: 1.5, placement: { x: 6, y: 6 } },
        { id: 'item-2', label: 'Sofa', width: 5, depth: 2, placement: { x: 16, y: 4 } },
      ],
    }),
  );
  await openStep(page, 'room');
  if (isNarrow(page)) await setDetent(page, 'full');
  await page.getByTestId('room-row').filter({ hasText: 'Den' }).click();
  await page.getByRole('button', { name: 'Delete Den' }).click();
  await expect.poll(async () => (await roomsOf(page)).length).toBe(1);
  const notice = page.getByTestId('app-notice');
  await expect(notice).toContainText('Den deleted. 1 piece was set aside.');
  expect((await workingPlan(page)).items[1]).not.toHaveProperty('placement');
  await notice.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await roomsOf(page)).length).toBe(2);
  expect((await workingPlan(page)).items[1]!.placement).toMatchObject({ x: 16, y: 4 });
});

test('export draws the whole floor with room names; a share link carries it', async ({
  page,
  browser,
}) => {
  await open(page, {
    ...twoRooms(0),
    rooms: [
      {
        id: 'room-1',
        name: 'Kitchen',
        outline: rect(12, 12),
        openings: [{ id: 'door-1', kind: 'door', wall: 1, offset: 4, width: 3 }],
      },
      { id: 'room-2', name: 'Den', outline: rect(8, 8, 12, 0), openings: [] },
    ],
  });
  // The export module loads on first use: ask until the print copy of the plan is there.
  const svg = page.locator('#print-plan svg');
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      return svg.count();
    })
    .toBe(1);
  await expect(svg.locator('[data-role="room-label"]')).toHaveCount(2);
  await expect(svg.locator('[data-role="shared-wall"]')).toHaveCount(1);
  await expect(svg.locator('text', { hasText: 'Kitchen' })).toHaveCount(1);
  await expect(svg.locator('text', { hasText: /2 rooms · 208 sq ft/ })).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await page.getByRole('button', { name: 'Share / Save' }).click();
  await expect(page.locator('#share-url')).toHaveValue(/#s=[A-Za-z0-9_-]+$/);
  const url = await page.locator('#share-url').inputValue();
  const fresh = await browser.newContext(test.info().project.use);
  const other = await fresh.newPage();
  await other.goto(url);
  await ready(other);
  await expect(other.getByTestId('link-problem')).toHaveCount(0);
  const rooms = (await workingPlan(other)).rooms;
  expect(rooms.map((r) => r.name)).toEqual(['Kitchen', 'Den']);
  expect(rooms[0]!.openings).toHaveLength(1);
  await expect(other.getByTestId('room-chips').getByRole('button')).toHaveCount(3);
  await fresh.close();
});

test('the room chips zoom to a room, and back to the whole floor', async ({ page }) => {
  await open(page, twoRooms(0));
  await viewPlan(page);
  await animationsSettled(page);
  const zoomOf = () =>
    page.evaluate(() => {
      const room = document.querySelector('[data-testid="room"]') as HTMLElement;
      return room.getBoundingClientRect().width / room.offsetWidth;
    });
  const whole = await zoomOf();
  const chips = page.getByTestId('room-chips');
  await chips.getByRole('button', { name: 'Den' }).click();
  await expect.poll(zoomOf).toBeGreaterThan(whole * 1.2);
  await expect(chips.getByRole('button', { name: 'Den' })).toHaveAttribute('aria-pressed', 'true');
  // The den is in the middle of what shows.
  const centre = await screenAt(page, 16, 4);
  const plan = (await page.locator('#floor-plan').boundingBox())!;
  expect(centre.x).toBeGreaterThan(plan.x + plan.width * 0.3);
  expect(centre.x).toBeLessThan(plan.x + plan.width * 0.7);
  await chips.getByRole('button', { name: 'Whole floor' }).click();
  await expect.poll(zoomOf).toBeCloseTo(whole, 1);
});

test.describe('accessibility', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Room Setup with several rooms has no serious axe violations', async ({ page }) => {
    await open(page, twoRooms(0));
    await openStep(page, 'room');
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
    await scan('#floor-plan');
    if (isNarrow(page)) await setDetent(page, 'full');
    await scan('[data-testid="sidebar"]');
    // The rooms list works from the keyboard: a row is a button.
    const den = page.getByTestId('room-row').filter({ hasText: 'Den' });
    await den.focus();
    await page.keyboard.press('Enter');
    await expect(den).toHaveAttribute('aria-pressed', 'true');
  });
});
