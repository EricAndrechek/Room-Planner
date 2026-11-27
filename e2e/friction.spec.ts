import { expect, test, type Locator, type Page } from '@playwright/test';
import { storedDims, storedOpenings, storedPieces, storedUi } from './storage';
import { isNarrow, openStep, showEditor, viewPlan } from './ui';

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
    localStorage.setItem('dims', JSON.stringify({ width: 12, height: 12 }));
  }, mode);

/** What the planner stored, in its fields' terms (e2e/storage.ts). */
const stored = async <T>(page: Page, what: 'items' | 'dims' | 'doors' | 'windows'): Promise<T> =>
  (what === 'items'
    ? await storedPieces(page)
    : what === 'dims'
      ? await storedDims(page)
      : await storedOpenings(page, what === 'doors' ? 'door' : 'window')) as T;

const badge = (page: Page) => page.getByTestId('mode-badge');
const notice = (page: Page) => page.getByTestId('app-notice');

/** Drag from the middle of `el` by (dx, dy) screen px: a mouse, or touch pointers on phones. */
async function dragBy(page: Page, el: Locator, dx: number, dy: number) {
  const b = (await el.boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  if (!isNarrow(page)) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
    return;
  }
  // Touch: what is under the finger gets the pointerdown, the window the rest (as on a phone).
  await page.evaluate(
    async ({ x, y, dx, dy }) => {
      const target = document.elementFromPoint(x, y)!;
      const at = (cx: number, cy: number, buttons: number) => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 9,
        pointerType: 'touch',
        isPrimary: true,
        clientX: cx,
        clientY: cy,
        button: 0,
        buttons,
      });
      target.dispatchEvent(new PointerEvent('pointerdown', at(x, y, 1)));
      for (let i = 1; i <= 10; i++) {
        window.dispatchEvent(
          new PointerEvent('pointermove', at(x + (dx * i) / 10, y + (dy * i) / 10, 1)),
        );
        await new Promise((r) => setTimeout(r, 16));
      }
      window.dispatchEvent(new PointerEvent('pointerup', at(x + dx, y + dy, 0)));
    },
    { x, y, dx, dy },
  );
}

test.describe('furniture moves in room setup too', () => {
  test('a fresh visitor starts in Furniture mode and can drag a sample piece', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await expect(badge(page)).toContainText(/Furniture Mode|Drag to move/);
    expect((await storedUi(page)).designMode).toBe('furniture');
  });

  test('a returning visitor keeps the mode they were in (room setup)', async ({ page }) => {
    await returningIn(page, 'room-setup');
    await page.goto('/');
    await ready(page);
    await expect(badge(page)).toContainText(/Room Setup Mode|Room setup/);
    await expect(badge(page)).not.toContainText(/locked/i);
  });

  test('pressing a piece in Room Setup selects it, and dragging it moves it (no lock notice)', async ({
    page,
  }) => {
    await returningIn(page, 'room-setup');
    await page.goto('/');
    await ready(page);
    await viewPlan(page);
    const desk = page.getByRole('button', { name: /^Desk,/ });
    await expect(desk).not.toHaveAccessibleDescription(/Locked/);
    const before = (await stored<{ label: string; x: number; y: number }[]>(page, 'items')).find(
      (i) => i.label === 'Desk',
    )!;
    await dragBy(page, desk, -50, -40);
    await expect(desk).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(
        async () =>
          (await stored<{ label: string; x: number }[]>(page, 'items')).find(
            (i) => i.label === 'Desk',
          )!.x,
      )
      .toBeLessThan(before.x - 0.5);
    await expect(notice(page)).toHaveCount(0);
    // Still in Room Setup: the step did not change.
    await expect(badge(page)).toContainText(/Room Setup Mode|Room setup/);
    // One undo puts it back.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect
      .poll(
        async () =>
          (await stored<{ label: string; x: number }[]>(page, 'items')).find(
            (i) => i.label === 'Desk',
          )!.x,
      )
      .toBeCloseTo(before.x, 4);
  });

  test('keyboard: arrows move the focused piece in Room Setup', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard');
    await returningIn(page, 'room-setup');
    await page.goto('/');
    await ready(page);
    const bed = page.getByRole('button', { name: /^Bed,/ });
    await bed.focus();
    const x0 = (await stored<{ label: string; x: number }[]>(page, 'items')).find(
      (i) => i.label === 'Bed',
    )!.x;
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(
        async () =>
          (await stored<{ label: string; x: number }[]>(page, 'items')).find(
            (i) => i.label === 'Bed',
          )!.x,
      )
      .toBeCloseTo(x0 + 0.25, 4);
    await expect(notice(page)).toHaveCount(0);
  });

  test('a door handle under a piece still wins in Room Setup, and empty floor still pans', async ({
    page,
    browserName,
  }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.clear();
      localStorage.setItem('room-sim-v3-dims', JSON.stringify({ width: 12, height: 12 }));
      localStorage.setItem(
        'room-sim-v3-doors',
        JSON.stringify([
          { id: 1, width: 3, position: 4, wall: 'top', hinge: 'left', type: 'swing-in' },
        ]),
      );
      localStorage.setItem('room-sim-v3-windows', '[]');
      // A rug right over the door's handle (the middle of the door, on the top wall; the bottom
      // of the plan can be under a toast).
      localStorage.setItem(
        'room-sim-v3-items',
        JSON.stringify([
          {
            id: 2,
            label: 'Rug',
            width: 3,
            height: 2,
            x: 4,
            y: 0,
            rotation: 0,
            color: '#a5b4fc',
            visible: true,
          },
        ]),
      );
      localStorage.setItem('room-sim-v3-mode', 'room-setup');
      sessionStorage.setItem('seeded', '1');
    });
    await page.goto('/');
    await ready(page);
    await viewPlan(page);
    const handle = page.getByRole('button', { name: /^Door handle/ });
    const hb = (await handle.boundingBox())!;
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('aria-label') ?? '',
      { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 },
    );
    expect(hit).toMatch(/^Door handle/);
    const rugBefore = await stored<{ x: number; y: number }[]>(page, 'items');
    const doorBefore = (await stored<{ position: number }[]>(page, 'doors'))[0]!.position;
    await dragBy(page, handle, 60, 0);
    await expect
      .poll(async () => (await stored<{ position: number }[]>(page, 'doors'))[0]!.position)
      .toBeGreaterThan(doorBefore + 0.5);
    expect(await stored(page, 'items')).toEqual(rugBefore);

    // On a phone, a finger on empty floor (the bottom left of the room) pans the plan; nothing on
    // it moves. (With a mouse the plan pans with the wheel or trackpad.)
    // (Synthetic touches need the Touch constructor, which WebKit does not expose.)
    if (isNarrow(page) && browserName !== 'webkit') {
      const room = page.getByTestId('room');
      const r0 = (await room.boundingBox())!;
      await page.evaluate(
        async ({ x, y }) => {
          const target = document.elementFromPoint(x, y)!;
          const touch = (cx: number, cy: number) =>
            new Touch({ identifier: 3, target, clientX: cx, clientY: cy });
          const fire = (type: string, cx: number, cy: number, end = false) =>
            target.dispatchEvent(
              new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches: end ? [] : [touch(cx, cy)],
                changedTouches: [touch(cx, cy)],
              }),
            );
          fire('touchstart', x, y);
          for (let i = 1; i <= 8; i++) {
            fire('touchmove', x + i * 5, y - i * 4);
            await new Promise((r) => setTimeout(r, 16));
          }
          fire('touchend', x + 40, y - 32, true);
        },
        { x: r0.x + 16, y: r0.y + r0.height - 16 },
      );
      const r1 = (await room.boundingBox())!;
      expect(Math.abs(r1.x - r0.x - 40)).toBeLessThan(6);
      expect(await stored(page, 'items')).toEqual(rugBefore);
    }
  });

  test('the phone badge fits on one line and says nothing about locked furniture', async ({
    page,
  }) => {
    test.skip(!isNarrow(page), 'phone layout');
    await returningIn(page, 'room-setup');
    await page.goto('/');
    await ready(page);
    await expect(badge(page).getByText('Room setup · drag door & window handles')).toBeVisible();
    const truncated = await badge(page).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(truncated).toBe(false);
  });
});

test.describe('room size input', () => {
  const setup = async (page: Page) => {
    await returningIn(page, 'room-setup');
    await page.goto('/');
    await ready(page);
    await openStep(page, 'room');
    return page.getByLabel('Room width');
  };
  const storedWidth = async (page: Page) => (await stored<{ width: number }>(page, 'dims')).width;

  test('"117" asks "did you mean 11\'7"?", and Use 11\'7" sets it', async ({ page }) => {
    const width = await setup(page);
    await width.fill('117');
    await width.press('Enter');
    const prompt = page.getByTestId('dimension-confirm');
    await expect(prompt).toContainText(`Width: That's a 117 ft room — did you mean 11'7"?`);
    await expect(prompt).toHaveAccessibleName(`Width: That's a 117 ft room — did you mean 11'7"?`);
    await expect(width).toHaveAttribute('aria-describedby', /confirm-text/);
    // A full-width row under the Width/Length pair, with the two choices side by side.
    const row = (await page.getByTestId('room-dims-messages').boundingBox())!;
    const field = (await width.boundingBox())!;
    expect(row.width).toBeGreaterThan(field.width * 1.6);
    const [a, b] = await prompt.getByRole('button').all();
    expect(Math.abs((await a!.boundingBox())!.y - (await b!.boundingBox())!.y)).toBeLessThan(2);
    // Nothing is used until a choice is made; focus is on the first choice.
    expect(await storedWidth(page)).toBe(12);
    const use = prompt.getByRole('button', { name: `Use 11'7"` });
    await expect(use).toBeFocused();
    await expect(prompt.getByRole('button', { name: 'Keep 117 ft' })).toBeVisible();
    await use.click();
    await expect(prompt).toHaveCount(0);
    await expect(width).toHaveValue(`11'7"`);
    await expect.poll(() => storedWidth(page)).toBeCloseTo(11 + 7 / 12, 6);

    // "11 7" is 11'7" too, with no question asked.
    await width.fill('11 7');
    await width.press('Enter');
    await expect(page.getByTestId('dimension-confirm')).toHaveCount(0);
    await expect(width).toHaveValue(`11'7"`);
  });

  test('"120" -> Keep 120 ft: the room is 120 ft and the view re-fits to show all of it', async ({
    page,
  }) => {
    const width = await setup(page);
    await width.fill('120');
    await width.press('Enter');
    const prompt = page.getByTestId('dimension-confirm');
    await expect(prompt).toContainText(`That's a 120 ft room — did you mean 12'?`);
    await prompt.getByRole('button', { name: 'Keep 120 ft' }).click();
    await expect.poll(() => storedWidth(page)).toBe(120);
    await viewPlan(page);
    await page.waitForTimeout(400);
    const plan = (await page.locator('#floor-plan').boundingBox())!;
    const room = (await page.getByTestId('room').boundingBox())!;
    expect(room.x).toBeGreaterThanOrEqual(plan.x - 1);
    expect(room.x + room.width).toBeLessThanOrEqual(plan.x + plan.width + 1);
    expect(room.width).toBeGreaterThan(plan.width * 0.6);
  });

  test('a large size with no other likely reading: keep it? (Escape cancels)', async ({
    page,
    isMobile,
  }) => {
    const width = await setup(page);
    await width.fill('75');
    await width.press('Enter');
    const prompt = page.getByTestId('dimension-confirm');
    await expect(prompt).toContainText(`That's a 75 ft room — keep it?`);
    await expect(prompt.getByRole('button', { name: 'Cancel' })).toBeVisible();
    if (!isMobile) {
      await page.keyboard.press('Escape');
      await expect(prompt).toHaveCount(0);
      await expect(width).toBeFocused();
    } else {
      await prompt.getByRole('button', { name: 'Cancel' }).click();
    }
    await expect(width).toHaveValue(`12'`);
    expect(await storedWidth(page)).toBe(12);
    await width.fill('75');
    await width.press('Enter');
    await page.getByTestId('dimension-confirm').getByRole('button', { name: 'Keep' }).click();
    await expect.poll(() => storedWidth(page)).toBe(75);
  });

  test('over the 500 ft ceiling is rejected with an inline error, not clamped', async ({
    page,
  }) => {
    const width = await setup(page);
    await width.fill('600');
    await width.press('Enter');
    await expect(width).toHaveAttribute('aria-invalid', 'true');
    const describedBy = (await width.getAttribute('aria-describedby'))!;
    // Shown in the full-width row under Width and Length, named after the field.
    const error = page.locator(`[id="${describedBy}"]`);
    await expect(error).toHaveText(`Width: Max 500' (that's 600 ft)`);
    await expect(page.getByTestId('room-dims-messages')).toContainText('Width: Max 500');
    await expect(page.getByTestId('dimension-confirm')).toHaveCount(0);
    await expect(width).toHaveValue(`12'`);
    expect(await storedWidth(page)).toBe(12);
    // Typing again clears the error.
    await width.fill('14');
    await expect(width).not.toHaveAttribute('aria-invalid');
  });
});

test.describe('typed sizes (production rejections: 72 in the first days)', () => {
  const furniture = async (page: Page) => {
    await page.goto('/');
    await ready(page);
    await openStep(page, 'furniture');
    // The sample Desk's card: select it so its fields show.
    await page.getByRole('button', { name: /^Desk,/ }).click();
    await showEditor(page);
  };
  const deskWidth = async (page: Page) =>
    (await stored<{ label: string; width: number }[]>(page, 'items')).find(
      (i) => i.label === 'Desk',
    )!.width;
  const commit = async (field: Locator, text: string) => {
    await field.fill(text);
    await field.press('Enter');
  };

  test('every common way of typing a size is read', async ({ page }) => {
    await furniture(page);
    const width = page.getByLabel('Width of Desk');
    for (const [typed, feet] of [
      [`4'7`, 4 + 7 / 12],
      [`4' 7"`, 4 + 7 / 12],
      [`4'7''`, 4 + 7 / 12],
      ['4ft 7in', 4 + 7 / 12],
      ['4 ft 7 in', 4 + 7 / 12],
      ['4ft7', 4 + 7 / 12],
      ['4-7', 4 + 7 / 12],
      [`4.5'`, 4.5],
      ['4.5 ft', 4.5],
      [`4 1/2'`, 4.5],
      ['55"', 55 / 12],
      ['55in', 55 / 12],
      ['4′7″', 4 + 7 / 12],
      ['4’7”', 4 + 7 / 12],
      ['  4 7  ', 4 + 7 / 12],
      ['140 cm', 140 * 0.0328084],
      ['1,4 m', 1.4 * 3.28084],
    ] as const) {
      await commit(width, typed);
      await expect(width, typed).not.toHaveAttribute('aria-invalid');
      await expect.poll(() => deskWidth(page), { message: typed }).toBeCloseTo(feet, 3);
    }
  });

  test('a size pair in one field is rejected with a hint, the value stays', async ({ page }) => {
    // Record captures (the PostHog SDK stays off under automation).
    await page.addInitScript(() => {
      const events: [string, Record<string, unknown> | undefined][] = [];
      (window as unknown as { __events: typeof events }).__events = events;
      (window as unknown as { posthog: unknown }).posthog = {
        __SV: 1,
        capture: (name: string, props?: Record<string, unknown>) => events.push([name, props]),
      };
    });
    await furniture(page);
    const width = page.getByLabel('Width of Desk');
    const before = await deskWidth(page);
    await commit(width, `5' x 3'`);
    await expect(width).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').filter({ hasText: 'One size per field' })).toHaveText(
      `One size per field: type 5' here and the other size in its own field`,
    );
    expect(await deskWidth(page)).toBe(before);
    // Analytics: the form typed (digits as 9), never the numbers.
    const got = await page.evaluate(
      () => (window as unknown as { __events: [string, Record<string, unknown>][] }).__events,
    );
    expect(got.filter(([e]) => e === 'dimension_rejected').map(([, p]) => p)).toEqual([
      { reason: 'pair', units: 'ft-in', shape: `9' x 9'`, outcome: 'rejected' },
    ]);
  });

  test('unreadable input says how to type it, with the numbers typed', async ({ page }) => {
    await furniture(page);
    const width = page.getByLabel('Width of Desk');
    await commit(width, '4 pies 7');
    await expect(page.getByRole('alert').filter({ hasText: "Couldn't read" })).toHaveText(
      `Couldn't read “4 pies 7”. Type it like 4'7" or 4 7`,
    );
  });

  test('a cleared field goes back to its value without an error', async ({ page }) => {
    await furniture(page);
    const width = page.getByLabel('Width of Desk');
    const before = await width.inputValue();
    await commit(width, '');
    await expect(width).toHaveValue(before);
    await expect(width).not.toHaveAttribute('aria-invalid');
  });

  test(`"60" for a piece: did you mean 60" (5')? Use it, or keep 60 ft`, async ({ page }) => {
    await furniture(page);
    const width = page.getByLabel('Width of Desk');
    await commit(width, '60');
    const prompt = page.getByTestId('dimension-confirm');
    await expect(prompt).toHaveText(/That's 60 ft — did you mean 60" \(5'\)\?/);
    await expect(prompt.getByRole('button', { name: `Use 5'` })).toBeFocused();
    await prompt.getByRole('button', { name: `Use 5'` }).click();
    await expect(prompt).toHaveCount(0);
    await expect.poll(() => deskWidth(page)).toBe(5);
  });

  test('a piece bigger than the room is allowed, with a note (not rejected)', async ({ page }) => {
    await furniture(page);
    const width = page.getByLabel('Width of Desk');
    await commit(width, `14'`);
    await expect(width).not.toHaveAttribute('aria-invalid');
    await expect(page.getByTestId('dimension-note')).toHaveText(
      'Bigger than the room: it shows as outside the room',
    );
    await expect.poll(() => deskWidth(page)).toBe(14);
  });

  test('a door wider than its wall is made as wide as the wall, and says so', async ({ page }) => {
    await returningIn(page, 'room-setup');
    await page.goto('/');
    await ready(page);
    await openStep(page, 'room');
    const width = page.getByLabel('Door width').first();
    await commit(width, `20'`);
    await expect(width).not.toHaveAttribute('aria-invalid');
    await expect(page.getByTestId('dimension-note').first()).toHaveText(
      `Set to 12': the whole wall`,
    );
    await expect
      .poll(async () => (await stored<{ width: number }[]>(page, 'doors'))[0]!.width)
      .toBe(12);
    // "36" there: 36" (3')?
    await commit(width, '36');
    const prompt = page.getByTestId('dimension-confirm');
    await expect(prompt).toContainText(`did you mean 36" (3')?`);
    await prompt.getByRole('button', { name: `Use 3'` }).click();
    await expect
      .poll(async () => (await stored<{ width: number }[]>(page, 'doors'))[0]!.width)
      .toBe(3);
  });
});

test('phone: the door type picker is a full-size target, nothing covers it, and the change shows on the plan', async ({
  page,
}) => {
  test.skip(!isNarrow(page), 'phone layout');
  await returningIn(page, 'room-setup');
  await page.goto('/');
  await ready(page);
  await openStep(page, 'room');
  const select = page.getByTestId('door-type').first();
  await select.scrollIntoViewIfNeeded();
  const b = (await select.boundingBox())!;
  // A 44px target with 16px text (smaller text makes iOS zoom in on focus).
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(await select.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  // Nothing (the sheet's drag area, a toast) sits on top of it.
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-testid'),
    { x: b.x + b.width / 2, y: b.y + b.height / 2 },
  );
  expect(hit).toBe('door-type');
  await select.tap();
  await expect(select).toBeFocused();
  await select.selectOption('sliding');
  await expect
    .poll(async () => (await stored<{ type: string }[]>(page, 'doors'))[0]!.type)
    .toBe('sliding');
  // The door shows above the sheet, lit up for a moment, so the change is seen.
  await expect(page.locator('[data-door-swing][data-door-type="sliding"]')).toHaveAttribute(
    'data-blocked',
    'true',
  );
  await page.waitForTimeout(400);
  const handle = (await page.getByRole('button', { name: /^Door handle/ }).boundingBox())!;
  const sheet = (await page.getByTestId('sidebar').boundingBox())!;
  expect(handle.y + handle.height).toBeLessThanOrEqual(sheet.y + 1);
  expect(handle.y).toBeGreaterThanOrEqual(0);
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
  const items = await stored<{ label: string; x: number; y: number }[]>(page, 'items');
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
    (await stored<Item[]>(page, 'items')).filter(
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
  expect(await stored(page, 'dims')).toEqual({ width: 8, height: 12 });

  // One undo puts the pieces back where they were (the room stays 8 wide).
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(outside).toBe(n);
  expect(await stored(page, 'dims')).toEqual({ width: 8, height: 12 });
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
  const [win] = await stored<Opening[]>(page, 'windows');
  expect(win).toMatchObject({ wall: 'left', position: 4 }); // free there: kept

  // The door (6'..9' on its wall) would land on the window (4'..8'): it goes to a free spot.
  const doorWall = page.getByRole('radiogroup', { name: 'Door 1 wall' });
  await doorWall.getByRole('radio', { name: 'Left' }).click();
  const [door] = await stored<Opening[]>(page, 'doors');
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
  expect((await stored<{ wall: string }[]>(page, 'doors'))[0]!.wall).toBe('bottom');
});

test('the active step header is a plain heading with no status label; the inactive one expands', async ({
  page,
}) => {
  await page.goto('/');
  await ready(page);
  await openStep(page, 'furniture');
  const headers = page.getByTestId('step-header');
  const active = headers.filter({ hasNot: page.locator('[aria-expanded]') }).filter({
    hasText: 'Furniture',
  });
  await expect(active).toHaveCount(1);
  expect(await active.evaluate((el) => el.tagName)).toBe('DIV');
  await expect(active).not.toHaveAttribute('role');
  // Nothing on it looks pressable: no "Editing" pill (it drew dead clicks), no hover or pointer.
  await expect(page.getByText('Editing', { exact: true })).toHaveCount(0);
  const cls = (await active.getAttribute('class')) ?? '';
  expect(cls).not.toMatch(/hover:|cursor-pointer/);
  expect(await active.evaluate((el) => getComputedStyle(el).cursor)).toBe('auto');

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
