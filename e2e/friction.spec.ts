import { expect, test, type Page } from '@playwright/test';
import { isNarrow, openStep, viewPlan } from './ui';

// Fixes for friction seen in real sessions (see the PR): each test names the behaviour it guards.

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

test('shrinking the room offers to move stranded pieces inside, as one undoable step', async ({
  page,
}) => {
  type Item = { label: string; x: number; y: number; width: number; height: number };
  const outside = async () =>
    (await stored<Item[]>(page, 'room-sim-v3-items')).filter(
      (i) => i.x < -0.001 || i.y < -0.001 || i.x + i.width > 8.001 || i.y + i.height > 12.001,
    ).length;
  await returningIn(page, 'room-setup');
  await page.goto('/');
  await ready(page);
  await openStep(page, 'room');
  const width = page.getByLabel('Room width');
  await width.fill('8');
  await width.press('Enter');
  await expect.poll(outside).toBeGreaterThan(0);
  const n = await outside();
  await expect(notice(page)).toHaveText(new RegExp(`^${n} pieces are outside the room\\.`));

  await notice(page).getByRole('button', { name: 'Move them inside' }).click();
  await expect(notice(page)).toHaveCount(0);
  await expect.poll(outside).toBe(0);
  // Still 8 wide: only the pieces moved.
  expect(await stored(page, 'room-sim-v3-dims')).toEqual({ width: 8, height: 12 });

  // One undo puts the pieces back where they were (the room stays 8 wide).
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(outside).toBe(n);
  expect(await stored(page, 'room-sim-v3-dims')).toEqual({ width: 8, height: 12 });
});

test('the shrink notice can be dismissed, and growing the room never shows it', async ({
  page,
}) => {
  await returningIn(page, 'room-setup');
  await page.goto('/');
  await ready(page);
  await openStep(page, 'room');
  const width = page.getByLabel('Room width');
  await width.fill('14');
  await width.press('Enter');
  await page.waitForTimeout(300);
  await expect(notice(page)).toHaveCount(0);
  await width.fill('8');
  await width.press('Enter');
  await expect(notice(page)).toBeVisible();
  await notice(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice(page)).toHaveCount(0);
});

test('wall segmented control moves an opening to a free spot on the new wall', async ({ page }) => {
  type Opening = { wall: string; position: number; width: number };
  await returningIn(page, 'room-setup');
  await page.goto('/');
  await ready(page);
  await openStep(page, 'room');

  const windowWall = page.getByRole('radiogroup', { name: 'Window 1 wall' });
  await expect(windowWall.getByRole('radio', { name: 'Top' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await windowWall.getByRole('radio', { name: 'Left' }).click();
  await expect(windowWall.getByRole('radio', { name: 'Left' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const [win] = await stored<Opening[]>(page, 'room-sim-v3-windows');
  expect(win).toMatchObject({ wall: 'left', position: 4 }); // free there: kept

  // The door (6'..9' on its wall) would land on the window (4'..8'): it goes to a free spot.
  const doorWall = page.getByRole('radiogroup', { name: 'Door 1 wall' });
  await doorWall.getByRole('radio', { name: 'Left' }).click();
  const [door] = await stored<Opening[]>(page, 'room-sim-v3-doors');
  expect(door!.wall).toBe('left');
  const clear = door!.position + door!.width <= win!.position || door!.position >= 8;
  expect(clear, `door at ${door!.position} overlaps the window`).toBe(true);

  // Keyboard: arrows move within the group and pick.
  await doorWall.getByRole('radio', { name: 'Left' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(doorWall.getByRole('radio', { name: 'Bottom' })).toBeFocused();
  await expect(doorWall.getByRole('radio', { name: 'Bottom' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test("an opening that doesn't fit on the chosen wall stays put, and says so", async ({ page }) => {
  await returningIn(page, 'room-setup');
  await page.goto('/');
  await ready(page);
  await openStep(page, 'room');
  // A 4' deep room: the 4' window fills the left wall, leaving no room for the door.
  const length = page.getByLabel('Room length');
  await length.fill('4');
  await length.press('Enter');
  await page
    .getByRole('radiogroup', { name: 'Window 1 wall' })
    .getByRole('radio', { name: 'Left' })
    .click();
  const doorWall = page.getByRole('radiogroup', { name: 'Door 1 wall' });
  await doorWall.getByRole('radio', { name: 'Left' }).click();
  await expect(notice(page)).toContainText(
    "Door 1 doesn't fit on the left wall, so it stays on the bottom wall.",
  );
  await expect(doorWall.getByRole('radio', { name: 'Bottom' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect((await stored<{ wall: string }[]>(page, 'room-sim-v3-doors'))[0]!.wall).toBe('bottom');
});

test('the active step header is a plain label; the inactive one expands its locked section', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  const headers = page.getByTestId('step-header');
  const active = headers.filter({ hasText: 'Editing' });
  await expect(active).toHaveCount(1);
  await expect(active).toContainText('Furniture');
  expect(await active.evaluate((el) => el.tagName)).toBe('DIV');
  await expect(active).not.toHaveAttribute('role');
  await expect(page.getByRole('button', { name: /Editing/ })).toHaveCount(0);

  const inactive = page.getByRole('button', { name: /^Room Setup/ });
  await expect(inactive).toHaveAttribute('aria-expanded', 'false');
  await inactive.click();
  await expect(inactive).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Switch to Room Setup Mode' })).toBeVisible();
});

test('New plan (header and My Floor Plans) keeps the current plan', async ({ page }) => {
  await page.goto('/');
  await ready(page);
  await page.getByTitle('Click to rename').click();
  await page.getByLabel('Floor plan name').fill('Old plan');
  await page.getByLabel('Floor plan name').press('Enter');
  await openStep(page, 'furniture');
  await page.getByRole('button', { name: 'Add Item' }).click();
  await viewPlan(page);

  // Start blank, right away (before autosave has run): from the header's New plan menu, or on
  // phones (no room in the header) from My Floor Plans.
  if (isNarrow(page)) {
    await expect(page.getByRole('button', { name: 'New plan', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'Open file browser' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Start blank' }).click();
  } else {
    await page.getByRole('button', { name: 'New plan', exact: true }).click();
    const menu = page.getByTestId('new-plan-menu');
    await expect(menu).toContainText('Your current plan stays in My Floor Plans.');
    await menu.getByRole('button', { name: /^Start blank/ }).click();
  }
  await expect(notice(page)).toContainText(
    'New plan started. "Old plan" is still in My Floor Plans.',
  );
  await expect(page.getByRole('button', { name: /^(Bed|New Item),/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Door handle/ })).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toContainText('Saved');

  // My Floor Plans lists both; the old one opens with everything (including the last edit).
  await page.getByRole('button', { name: 'Open file browser' }).click();
  await expect(page.getByTestId('project-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Open Old plan' }).click();
  await expect(page.getByRole('button', { name: /^Bed,/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^New Item,/ })).toBeVisible();

  // My Floor Plans: "New plan" starts from the sample, again keeping the others.
  await page.getByRole('button', { name: 'Open file browser' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'New plan', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Bed,/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^New Item,/ })).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  await page.getByRole('button', { name: 'Open file browser' }).click();
  await expect(page.getByTestId('project-row')).toHaveCount(3);
});

test('no "Ready to work offline" toast on a first visit (the app is still cached)', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 })
    .toBe(true);
  // The one-time notice has been used up silently.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('room-planner-offline-notice')))
    .toBe('1');
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('pwa-toast')).toHaveCount(0);
});

test('canvas actions are tracked as counts and enums only (no names)', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'mouse drag/rotate on the desktop layout');
  // A stand-in for the PostHog SDK (which stays off under automation): records every capture.
  await page.addInitScript(() => {
    const events: [string, Record<string, unknown> | undefined][] = [];
    (window as unknown as { __events: typeof events }).__events = events;
    (window as unknown as { posthog: unknown }).posthog = {
      __SV: 1,
      capture: (name: string, props?: Record<string, unknown>) => events.push([name, props]),
    };
  });
  const events = () =>
    page.evaluate(
      () =>
        (window as unknown as { __events: [string, Record<string, unknown> | undefined][] })
          .__events,
    );
  const centre = async (selector: string) => {
    const b = (await page.locator(selector).first().boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  await page.goto('/');
  await ready(page);

  // Drag the desk (furniture mode on a first visit).
  const desk = await centre('role=button[name=/^Desk,/]');
  await page.mouse.move(desk.x, desk.y);
  await page.mouse.down();
  await page.mouse.move(desk.x - 60, desk.y - 40, { steps: 8 });
  await page.mouse.up();
  // Turn it with the handle.
  const handle = await centre('[data-testid="rotate-handle"]');
  const c = await centre('role=button[name=/^Desk,/]');
  const r = Math.hypot(handle.x - c.x, handle.y - c.y);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  for (let a = -90; a <= -30; a += 6) {
    const rad = (a * Math.PI) / 180;
    await page.mouse.move(c.x + r * Math.cos(rad), c.y + r * Math.sin(rad));
  }
  await page.mouse.up();
  // A plain click is a selection, not a move.
  await page.getByRole('button', { name: /^Bed,/ }).click();

  // Room setup: slide the door along its wall.
  await openStep(page, 'room');
  const door = await centre('role=button[name=/^Door handle/]');
  await page.mouse.move(door.x, door.y);
  await page.mouse.down();
  await page.mouse.move(door.x - 50, door.y, { steps: 6 });
  await page.mouse.up();

  const got = await events();
  const named = (n: string) => got.filter(([e]) => e === n).map(([, p]) => p);
  expect(named('item_moved')).toEqual([{ snapped: expect.any(Boolean), input: 'mouse' }]);
  expect(named('item_rotated')).toEqual([{ snapped: expect.any(Boolean), input: 'mouse' }]);
  expect(named('opening_moved')).toEqual([{ kind: 'door', input: 'mouse' }]);
  // Nothing the user typed or named ends up in any event.
  expect(JSON.stringify(got)).not.toMatch(/Desk|Bed|Floor Plan/);
});
