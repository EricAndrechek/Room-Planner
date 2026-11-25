import { expect, test, type Page } from '@playwright/test';
import { workingPlan } from './storage';

// Plan links (`#plan=<JSON>`, src/core/share/planParam.ts): a plan an assistant writes as text,
// opened like a shared link (a new saved plan, the link removed from the address bar).

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

test('a plan written raw, as an assistant writes it, opens as a new plan', async ({ page }) => {
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
