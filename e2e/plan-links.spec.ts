import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { READABLE_EXAMPLES } from '../src/lib/site';
import { workingPlan } from './storage';

// Links assistants write themselves, opened like a shared link (a new saved plan, the link removed
// from the address bar): readable `#p=` text (src/core/share/readable.ts), a `#s=` link an
// assistant compressed with code (src/lib/agentExample.json), and the raw-JSON `#plan=` fallback
// (src/core/share/planParam.ts).

const AGENT_EXAMPLE = JSON.parse(
  readFileSync(new URL('../src/lib/agentExample.json', import.meta.url), 'utf8'),
) as { link: string };

const roomsAndItems = async (page: Page) => {
  const plan = await workingPlan(page);
  return {
    rooms: plan.rooms.map((r) => r.name),
    items: plan.items.map((i) => [i.label, i.shape ?? 'rect', Boolean(i.placement)]),
  };
};

const opensClean = async (page: Page) => {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe('');
};

test('the documented readable bedroom opens', async ({ page }) => {
  await open(page, `/#p=${READABLE_EXAMPLES.bedroom}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Bedroom' })).toBeVisible();
  await opensClean(page);
  expect(await roomsAndItems(page)).toEqual({
    rooms: ['Bedroom'],
    items: [
      ['Queen bed', 'rect', true],
      ['Nightstand', 'rect', true],
      ['Dresser', 'rect', true],
    ],
  });
});

test('the documented readable flat opens with both rooms, and a sloppy copy of it too', async ({
  page,
}) => {
  const expected = {
    rooms: ['Living room', 'Bedroom'],
    items: [
      ['Sofa', 'rect', true],
      ['Coffee table', 'rect', true],
      ['Dining table', 'ellipse', true],
      ['Queen bed', 'rect', true],
      ['Wardrobe', 'rect', true],
      ['Armchair', 'rect', false],
    ],
  };
  await open(page, `/#p=${READABLE_EXAMPLES.flat}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Flat' })).toBeVisible();
  await opensClean(page);
  expect(await roomsAndItems(page)).toEqual(expected);

  const sloppy = READABLE_EXAMPLES.flat
    .replace(/(^|;)room:/g, '$1Room: ')
    .replace(/;item:/g, ';;ITEM:')
    .replace(':round', ': Round ');
  await page.goto('about:blank'); // a new load, not a change of the fragment
  await open(page, `/#P=${sloppy};`);
  await opensClean(page);
  expect(await roomsAndItems(page)).toEqual(expected);
});

test('a readable door measured from the far end of its wall opens where it was meant', async ({
  page,
}) => {
  // 2 ft from the bottom of the right wall of a 20 x 12 room: the format measures clockwise, from
  // the top, so 12 - 2 - 3 = 7 ft.
  await open(page, '/#p=ft;room:Dining:20x12;door:right:end-2:3;window:bottom:right-1:4');
  await opensClean(page);
  const room = (await workingPlan(page)).rooms[0]!;
  expect(room.openings.map((o) => [o.kind, o.wall, o.offset, o.width])).toEqual([
    ['door', 1, 7, 3],
    // The bottom wall runs right to left: 1 ft from the right is offset 1.
    ['window', 2, 1, 4],
  ]);
});

test('a readable link with no room says it is damaged', async ({ page }) => {
  await open(page, '/#p=ft;item:Bed:5x6.7@3,3');
  await expect(page.getByRole('dialog', { name: 'This link is damaged' })).toBeVisible();
});

test('a link an assistant compressed with code opens the whole three-room flat', async ({
  page,
}) => {
  await open(page, new URL(AGENT_EXAMPLE.link).hash.replace(/^/, '/'));
  await expect(page.getByRole('heading', { level: 1, name: 'Three-room flat' })).toBeVisible();
  await opensClean(page);
  expect(await roomsAndItems(page)).toEqual({
    rooms: ['Living room', 'Bedroom', 'Bathroom'],
    items: [
      ['L sectional', 'l', true],
      ['Round table', 'ellipse', true],
      ['Full bed', 'rect', true],
      ['Vanity', 'rect', true],
      ['Spare chair', 'rect', false],
    ],
  });
});

/** As a model writes it: spaces, no version, no ids, no unit. */
const BEDROOM = `{"name": "Guest room", "rooms": [{"name": "Guest room", "outline": [{"x": 0, "y": 0}, {"x": 12, "y": 0}, {"x": 12, "y": 11}, {"x": 0, "y": 11}], "openings": [{"kind": "door", "wall": 2, "offset": 1, "width": 3}]}], "items": [{"label": "Queen bed", "width": 5, "depth": 6.7, "placement": {"x": 6, "y": 3.35}}, {"label": "Round table", "shape": "ellipse", "width": 2, "depth": 2, "placement": {"x": 10, "y": 2}}, {"label": "Spare chair", "width": 2, "depth": 2}]}`;

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForSelector('html[data-planner-ready]');
}

async function expectBedroom(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Guest room' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(new URL(page.url()).hash).toBe('');
  expect(new URL(page.url()).search).toBe('');
  const plan = await workingPlan(page);
  expect(plan.rooms.map((r) => [r.name, r.outline.length, r.openings.length])).toEqual([
    ['Guest room', 4, 1],
  ]);
  expect(plan.items.map((i) => [i.label, i.shape ?? 'rect', Boolean(i.placement)])).toEqual([
    ['Queen bed', 'rect', true],
    ['Round table', 'ellipse', true],
    ['Spare chair', 'rect', false],
  ]);
}

test('raw JSON after #plan=, as an assistant might write it, opens as a new plan', async ({
  page,
}) => {
  await open(page, `/#plan=${BEDROOM}`);
  await expectBedroom(page);
});

test('the same plan percent-encoded, or after ?plan=, opens too', async ({ page }) => {
  await open(page, `/#plan=${encodeURIComponent(BEDROOM)}`);
  await expectBedroom(page);
  await open(page, `/?plan=${encodeURIComponent(BEDROOM)}`);
  await expectBedroom(page);
});

test('a plan link cut short says it is damaged and changes nothing', async ({ page }) => {
  const cut = `/#plan=${BEDROOM.slice(0, 120)}`;
  await open(page, cut);
  await expect(page.getByRole('dialog', { name: 'This link is damaged' })).toBeVisible();
  const plan = await workingPlan(page);
  expect(plan?.name ?? '').not.toBe('Guest room');
});
