/**
 * Furniture shapes (PR 7a, issue #31): the Shape control on a furniture card, L-shaped and round
 * pieces on the plan and in the export, the two starters in Add Item, and links that keep them.
 * Every project runs these (the phone projects through the bottom sheet).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { animationsSettled, announcements, openStep, recordAnnouncements, viewPlan } from './ui';
import { workingPlan } from './storage';

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

const square = (n: number) => [
  { x: 0, y: 0 },
  { x: n, y: 0 },
  { x: n, y: n },
  { x: 0, y: n },
];

/** A 9' x 7' sectional (6' x 4' cut at the top right) in the bottom-left corner of a 12' room. */
const SOFA = {
  id: 'item-1',
  label: 'Sectional',
  color: '#a5b4fc',
  shape: 'l',
  width: 9,
  depth: 7,
  cut: { corner: 'tr', width: 6, depth: 4 },
  placement: { x: 4.5, y: 8.5, rotation: 0 },
};

/** A link holding `plan` (plain JSON form, `#j=`): the app opens it as a saved plan. */
const planLink = (items: object[], openings: object[] = [], name = 'Shapes') =>
  '/#j=' +
  Buffer.from(
    JSON.stringify({
      version: 4,
      name,
      unit: 'ft',
      rooms: [{ id: 'room-1', outline: square(12), openings }],
      items,
    }),
  ).toString('base64url');

const piece = (page: Page, label: string) =>
  page.getByRole('button', { name: new RegExp(`^${label},`) });
const storedItem = async (page: Page, label: string) =>
  (await workingPlan(page)).items.find((i) => i.label === label) as unknown as Record<
    string,
    unknown
  > & {
    width: number;
    depth: number;
    placement: { x: number; y: number; rotation: number };
  };

test('change a piece shape in its card: L with its cut corner and size, round, and back', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  await recordAnnouncements(page);
  await openStep(page, 'furniture');
  const before = await storedItem(page, 'Desk');

  const shapes = page.getByRole('radiogroup', { name: 'Shape of Desk' });
  await shapes.getByRole('radio', { name: 'L-shape' }).click();
  await expect(shapes.getByRole('radio', { name: 'L-shape' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('[data-item-id="item-5"]')).toHaveAttribute('data-shape', 'l');
  // The same box at the same place; a 2' x 4' desk gets 1' arms.
  await expect
    .poll(() => storedItem(page, 'Desk'))
    .toMatchObject({
      shape: 'l',
      width: before.width,
      depth: before.depth,
      placement: before.placement,
      cut: { corner: 'tr', width: 1, depth: 3 },
    });
  await expect.poll(() => announcements(page)).toContain('Desk is now L-shaped');

  // The cut corner and the cut size.
  const corners = page.getByRole('radiogroup', { name: 'Cut corner of Desk' });
  await corners.getByRole('radio', { name: 'Bottom left' }).click();
  await expect
    .poll(async () => (await storedItem(page, 'Desk')).cut)
    .toEqual({ corner: 'bl', width: 1, depth: 3 });
  const cutDepth = page.getByLabel('Cut depth of Desk');
  await cutDepth.fill(`2'6"`);
  await cutDepth.press('Enter');
  await expect
    .poll(async () => (await storedItem(page, 'Desk')).cut)
    .toEqual({ corner: 'bl', width: 1, depth: 2.5 });

  // Keyboard: the arrow keys move along the radio group and pick.
  await shapes.getByRole('radio', { name: 'L-shape' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(shapes.getByRole('radio', { name: 'Round' })).toBeFocused();
  await expect(page.locator('[data-item-id="item-5"]')).toHaveAttribute('data-shape', 'ellipse');
  await expect(page.getByRole('radiogroup', { name: 'Cut corner of Desk' })).toHaveCount(0);
  await expect.poll(() => announcements(page)).toContain('Desk is now oval');
  const round = await storedItem(page, 'Desk');
  expect(round.shape).toBe('ellipse');
  expect('cut' in round).toBe(false);
  expect(round.placement).toEqual(before.placement);

  await shapes.getByRole('radio', { name: 'Rectangle' }).click();
  await expect(page.locator('[data-item-id="item-5"]')).toHaveAttribute('data-shape', 'rect');
  // Undo goes back through the shapes.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('[data-item-id="item-5"]')).toHaveAttribute('data-shape', 'ellipse');
});

test('Add Item offers an L-shaped sofa and a round table', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'More items to add' }).click();
  const menu = page.getByTestId('add-item-menu');
  await expect(menu.getByRole('button')).toHaveText([
    /New item\s*3' × 2'/,
    /L-shaped sofa\s*9' × 7'/,
    /Round table\s*4' across/,
  ]);
  await menu.getByRole('button', { name: /Round table/ }).click();
  await expect(menu).toHaveCount(0);
  await expect(piece(page, 'Round table')).toHaveAttribute('data-shape', 'ellipse');
  await expect(piece(page, 'Round table')).toHaveAccessibleName(/^Round table, round, 4' by 4'/);
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'More items to add' }).click();
  await page.getByRole('button', { name: /L-shaped sofa/ }).click();
  await expect(piece(page, 'L-shaped sofa')).toHaveAttribute('data-shape', 'l');
  expect(await storedItem(page, 'L-shaped sofa')).toMatchObject({
    shape: 'l',
    width: 9,
    depth: 7,
    cut: { corner: 'tr', width: 6, depth: 4 },
  });
  // Escape closes the menu and gives focus back to its button.
  await openStep(page, 'furniture');
  const more = page.getByRole('button', { name: 'More items to add' });
  await more.click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('add-item-menu')).toHaveCount(0);
  await expect(more).toBeFocused();
});

test('an L-shaped sofa against two walls with a table in its notch does not overlap it', async ({
  page,
}) => {
  // The notch is x 3..9, y 5..9: the 3' x 2' table touches both of its inner edges.
  const table = {
    id: 'item-2',
    label: 'Table',
    color: '#fcd34d',
    width: 3,
    depth: 2,
    placement: { x: 4.5, y: 8, rotation: 0 },
  };
  await page.goto(planLink([SOFA, table]));
  await ready(page);
  await viewPlan(page);
  await expect(piece(page, 'Sectional')).toHaveAttribute('data-shape', 'l');
  await expect(piece(page, 'Sectional')).toHaveAccessibleName(/^Sectional, L-shaped, 9' by 7'/);
  await expect(page.getByText(/Overlapping|Outside room/)).toHaveCount(0);

  // A press in the notch, away from the table, is not a press on the sofa.
  const box = (await piece(page, 'Sectional').boundingBox())!;
  await page.mouse.click(box.x + (box.width * 7.5) / 9, box.y + (box.height * 1) / 7);
  await expect(piece(page, 'Sectional')).toHaveAttribute('aria-pressed', 'false');

  // Pushed an inch into the sofa's arm, the table overlaps it.
  await piece(page, 'Table').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(async () => (await storedItem(page, 'Table')).placement.x).toBeLessThan(4.5);
  await expect(piece(page, 'Table').locator('span.sr-only')).toContainText(
    'Overlapping other furniture.',
  );
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByText(/Overlapping|Outside room/)).toHaveCount(0);
});

test('a round table clears a door swing that a square table of its size is in', async ({
  page,
}) => {
  const door = { id: 'door-1', kind: 'door', wall: 0, offset: 3, width: 3, hinge: 'start' };
  const table = {
    id: 'item-1',
    label: 'Table',
    color: '#fcd34d',
    shape: 'ellipse',
    width: 2,
    depth: 2,
    placement: { x: 6, y: 3, rotation: 0 },
  };
  await page.goto(planLink([table], [door]));
  await ready(page);
  await viewPlan(page);
  await expect(piece(page, 'Table')).toHaveAttribute('data-shape', 'ellipse');
  await expect(page.getByTestId('door-block-badge')).toHaveCount(0);

  await openStep(page, 'furniture');
  await page
    .getByRole('radiogroup', { name: 'Shape of Table' })
    .getByRole('radio', { name: 'Rectangle' })
    .click();
  await expect(page.getByTestId('card-door-block')).toHaveText('Blocks door');
  await page
    .getByRole('radiogroup', { name: 'Shape of Table' })
    .getByRole('radio', { name: 'Round' })
    .click();
  await expect(page.getByTestId('card-door-block')).toHaveCount(0);
});

test('the export draws an L and a round table as their shapes', async ({ page }) => {
  const table = {
    id: 'item-2',
    label: 'Round table',
    color: '#fcd34d',
    shape: 'ellipse',
    width: 3.5,
    depth: 3.5,
    placement: { x: 9.5, y: 3, rotation: 0 },
  };
  await page.goto(planLink([SOFA, table]));
  await ready(page);
  await page.getByRole('button', { name: 'Export as image or PDF' }).click();
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole('button', { name: /^Print/ }).click();
  const svg = page.locator('#print-plan svg');
  await expect(svg.locator('[data-role="item"]')).toHaveCount(2);
  const paths = await svg
    .locator('[data-role="item"] > path')
    .evaluateAll((els) => els.map((e) => e.getAttribute('d') ?? ''));
  expect(paths).toHaveLength(2);
  // The L: a move, five lines and a close; the circle: four curves.
  expect(paths[0]!.match(/[ML]/g)).toHaveLength(6);
  expect(paths[1]!.match(/C/g)).toHaveLength(4);
  await expect(svg.locator('text', { hasText: 'Sectional' })).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
});

test('a share link keeps L and round pieces', async ({ page, browser }) => {
  const table = {
    id: 'item-2',
    label: 'Oval table',
    color: '#fcd34d',
    shape: 'ellipse',
    width: 4,
    depth: 2.5,
    placement: { x: 9, y: 3, rotation: 30 },
  };
  await page.goto(planLink([{ ...SOFA, cut: { ...SOFA.cut, corner: 'br' } }, table], [], 'Den'));
  await ready(page);
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await page.getByRole('button', { name: 'Share / Save' }).click();
  const shareInput = page.locator('#share-url');
  await expect(shareInput).toHaveValue(/#s=[A-Za-z0-9_-]+$/);
  const url = await shareInput.inputValue();

  const other = await browser.newContext(test.info().project.use);
  const there = await other.newPage();
  await there.goto(url);
  await ready(there);
  await expect(there.getByRole('heading', { name: 'Den' })).toBeVisible();
  await expect(piece(there, 'Sectional')).toHaveAttribute('data-shape', 'l');
  await expect(piece(there, 'Oval table')).toHaveAttribute('data-shape', 'ellipse');
  const items = (await workingPlan(there)).items as unknown as Record<string, unknown>[];
  expect(items.map((i) => [i.shape, i.cut ?? null, i.placement])).toEqual([
    ['l', { corner: 'br', width: 6, depth: 4 }, SOFA.placement],
    ['ellipse', null, table.placement],
  ]);
  await other.close();
});

test('the Shape control has no serious accessibility violations', async ({ browser }) => {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(planLink([SOFA]));
    await ready(page);
    await openStep(page, 'furniture');
    await expect(page.getByRole('radiogroup', { name: 'Cut corner of Sectional' })).toBeVisible();
    await page
      .getByRole('radiogroup', { name: 'Cut corner of Sectional' })
      .scrollIntoViewIfNeeded();
    await animationsSettled(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    const serious = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(serious, `${viewport.width}px`).toEqual([]);
    await context.close();
  }
});
