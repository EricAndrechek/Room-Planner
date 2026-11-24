import { expect, test, type Page } from '@playwright/test';

// Snapping, guides and measurements (#10) on a known layout: a 12' x 12' room with a 2' x 2' Box
// at (3, 4.5) and a 4' x 6' Bed at (7, 3). Mouse on desktop projects, touch on mobile ones.

const ITEMS = [
  {
    id: 1,
    label: 'Box',
    width: 2,
    height: 2,
    x: 3,
    y: 4.5,
    rotation: 0,
    color: '#93c5fd',
    visible: true,
  },
  {
    id: 2,
    label: 'Bed',
    width: 4,
    height: 6,
    x: 7,
    y: 3,
    rotation: 0,
    color: '#fcd34d',
    visible: true,
  },
];

async function seed(page: Page, extra: Record<string, string> = {}) {
  await page.addInitScript(
    ({ items, extra }) => {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.clear();
      localStorage.setItem('room-sim-v3-dims', JSON.stringify({ width: 12, height: 12 }));
      localStorage.setItem('room-sim-v3-doors', '[]');
      localStorage.setItem('room-sim-v3-windows', '[]');
      localStorage.setItem('room-sim-v3-items', JSON.stringify(items));
      localStorage.setItem('room-sim-v3-mode', 'furniture');
      for (const [k, v] of Object.entries(extra)) localStorage.setItem(k, v);
      // Phones: start with the editor sheet collapsed, so the plan (and its zoom, which sets the
      // snap distance in feet) is as big as it gets.
      sessionStorage.setItem('room-planner-sheet', 'peek');
      sessionStorage.setItem('seeded', '1');
    },
    { items: ITEMS, extra },
  );
  await page.goto('/');
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700); // initial auto-fit zoom
}

const stored = async (page: Page, label: string) =>
  (
    (await page.evaluate(() =>
      JSON.parse(localStorage.getItem('room-sim-v3-items') ?? '[]'),
    )) as typeof ITEMS
  ).find((i) => i.label === label)!;

/** Screen pixels per foot, from the room's on-screen size (12 ft + two 4px borders, scaled). */
async function pxPerFoot(page: Page) {
  const room = (await page.getByTestId('room').boundingBox())!;
  return (room.width / (12 * 40 + 8)) * 40;
}

/** Press on the Box's center and move it by (dx, dy) screen px; `release` false keeps it held. */
async function dragBox(
  page: Page,
  dx: number,
  dy: number,
  {
    isMobile,
    release = true,
    alt = false,
  }: { isMobile: boolean; release?: boolean; alt?: boolean },
) {
  const box = (await page.getByRole('button', { name: /^Box,/ }).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (!isMobile) {
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 12 });
    if (release) {
      await page.mouse.up();
      if (alt) await page.keyboard.up('Alt');
    }
    return;
  }
  // Touch: real-looking pointer events (the planner listens on window).
  await page.evaluate(
    async ({ x, y, dx, dy, release }) => {
      const target = document.querySelector('[aria-label^="Box,"]')!;
      const opts = (cx: number, cy: number, buttons: number) => ({
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
      target.dispatchEvent(new PointerEvent('pointerdown', opts(x, y, 1)));
      for (let i = 1; i <= 12; i++) {
        window.dispatchEvent(
          new PointerEvent('pointermove', opts(x + (dx * i) / 12, y + (dy * i) / 12, 1)),
        );
        await new Promise((r) => setTimeout(r, 16));
      }
      const up = () => window.dispatchEvent(new PointerEvent('pointerup', opts(x + dx, y + dy, 0)));
      if (release) up();
      else (window as unknown as { __release: () => void }).__release = up;
    },
    { x, y, dx, dy, release },
  );
}

async function releaseDrag(page: Page, isMobile: boolean) {
  if (isMobile)
    await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
  else await page.mouse.up();
}

const snapToggle = (page: Page) => page.getByRole('button', { name: 'Snap', exact: true });

test('dragging near a wall snaps flush, with a guide while dragging only', async ({
  page,
  isMobile,
}) => {
  await seed(page);
  const ppf = await pxPerFoot(page);
  // Box left edge at 3 ft; leave it 3 screen px short of the wall.
  await dragBox(page, -3 * ppf + 3, 0, { isMobile, release: false });
  const guide = page.getByTestId('snap-guide').first();
  await expect(guide).toBeVisible();
  await expect(guide).toHaveAttribute('data-kind', 'wall');
  // Live measurements, in the unit system: flush on the left, so no left label.
  const labels = page.getByTestId('measurement');
  await expect(labels.and(page.locator('[data-side="right"]'))).toHaveText(`5'`); // to the Bed
  await expect(labels.and(page.locator('[data-side="top"]'))).toHaveText(`4'6"`);
  await expect(labels.and(page.locator('[data-side="bottom"]'))).toHaveText(`5'6"`);
  await expect(labels.and(page.locator('[data-side="left"]'))).toHaveCount(0);
  await releaseDrag(page, isMobile);

  await expect(page.getByTestId('snap-guide')).toHaveCount(0);
  const box = await stored(page, 'Box');
  expect(box.x).toBe(0); // exactly on the wall's inner face
  expect(box.y).toBe(4.5);
});

test('dragging near another piece snaps edge to edge and aligns tops', async ({
  page,
  isMobile,
}) => {
  await seed(page);
  const ppf = await pxPerFoot(page);
  // Right edge (5 ft) to 3px short of the Bed's left edge (7 ft); top (4.5) to 3px below the Bed's top (3).
  await dragBox(page, 2 * ppf - 3, -1.5 * ppf + 3, { isMobile, release: false });
  await expect(page.getByTestId('snap-guide').first()).toBeVisible();
  expect(await page.getByTestId('snap-guide').count()).toBeGreaterThanOrEqual(2);
  await releaseDrag(page, isMobile);
  await expect(page.getByTestId('snap-guide')).toHaveCount(0);
  const box = await stored(page, 'Box');
  expect(box.x + box.width).toBe(7);
  expect(box.y).toBe(3);
});

test('holding Alt/Option while dragging bypasses snapping', async ({ page, isMobile }) => {
  test.skip(isMobile, 'no Alt key on touch screens (the Snap toggle covers them)');
  await seed(page);
  const ppf = await pxPerFoot(page);
  await dragBox(page, -3 * ppf + 3, 0, { isMobile, alt: true });
  const box = await stored(page, 'Box');
  expect(box.x).toBeGreaterThan(0.01);
  expect(box.x).toBeLessThan(0.25); // where the pointer left it, a few px from the wall
});

test('the Snap toggle turns snapping off and is remembered across reloads', async ({
  page,
  isMobile,
}) => {
  await seed(page);
  const toggle = snapToggle(page);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  const ppf = await pxPerFoot(page);
  await dragBox(page, -3 * ppf + 3, 0, { isMobile });
  expect((await stored(page, 'Box')).x).toBeGreaterThan(0.01);

  await page.reload();
  await page.waitForSelector('html[data-planner-ready]');
  await expect(snapToggle(page)).toHaveAttribute('aria-pressed', 'false');
  // A device preference, not part of the plan.
  expect(await page.evaluate(() => localStorage.getItem('room-planner-pref-snap'))).toBe('0');
  await snapToggle(page).click();
  await expect(snapToggle(page)).toHaveAttribute('aria-pressed', 'true');
});

test('a selected piece shows its clearances; arrow keys snap and announce', async ({ page }) => {
  await seed(page);
  const piece = page.getByRole('button', { name: /^Box,/ });
  await piece.focus();
  const labels = page.getByTestId('measurement');
  await expect(labels.and(page.locator('[data-side="left"]'))).toHaveText(`3'`);
  await expect(labels.and(page.locator('[data-side="right"]'))).toHaveText(`2'`);

  // Record every text the live region shows: a later one ("Project saved") can replace it quickly.
  await page.evaluate(() => {
    const region = document.querySelector('[role="status"][aria-atomic="true"]')!;
    const said: string[] = ((window as unknown as { __said: string[] }).__said = []);
    new MutationObserver(() => said.push(region.textContent ?? '')).observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  // Shift+Right twice: 3 -> 4 -> 5, where its right edge is flush with the Bed (announced).
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await stored(page, 'Box')).x).toBe(5);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __said: string[] }).__said.join(' | ')))
    .toContain('Against Bed');

  // Stepping away again is never pulled back onto the edge it just left.
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await stored(page, 'Box')).x).toBe(4.75);

  // Fine steps: Alt/Option or Ctrl/Cmd + arrow = 1 inch, never snapped (4.75 + 1/12 lands 2 in from
  // the Bed's edge, inside the snap threshold, and stays there).
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(async () => (await stored(page, 'Box')).x).toBeCloseTo(4.75 + 1 / 12, 9);
  await page.keyboard.press('Control+ArrowLeft');
  await expect.poll(async () => (await stored(page, 'Box')).x).toBeCloseTo(4.75, 9);
});

test('snapping adds no noticeable cost to a drag among 30 pieces', async ({ page, isMobile }) => {
  test.skip(isMobile, 'measured once, on desktop');
  const many = Array.from({ length: 30 }, (_, i) => ({
    id: i + 10,
    label: `P${i}`,
    width: 1,
    height: 0.8,
    x: (i % 6) * 2 + 0.3,
    y: Math.floor(i / 6) * 2.3 + 0.2,
    rotation: (i * 13) % 90,
    color: '#a5b4fc',
    visible: true,
  }));
  await page.addInitScript((items) => {
    localStorage.setItem('room-sim-v3-items', JSON.stringify(items));
    localStorage.setItem('room-sim-v3-mode', 'furniture');
  }, many);

  /**
   * Median main-thread ms per pointer move (handler, React render and commit) over 60 moves. Paint
   * is left out: on CI's software-rendered Linux WebKit it dominates and says nothing about phones.
   */
  const measure = async (snap: boolean) => {
    await page.addInitScript(
      (on) => localStorage.setItem('room-planner-pref-snap', on),
      snap ? '1' : '0',
    );
    await page.goto('/');
    await page.waitForSelector('html[data-planner-ready]');
    await page.waitForTimeout(700);
    const target = (await page.getByRole('button', { name: /^P14,/ }).boundingBox())!;
    const x = target.x + target.width / 2;
    const y = target.y + target.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    const median = await page.evaluate(
      async ({ x, y }) => {
        const times: number[] = [];
        for (let i = 1; i <= 60; i++) {
          const t0 = performance.now();
          window.dispatchEvent(
            new PointerEvent('pointermove', {
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true,
              clientX: x + i * 3,
              clientY: y + i * 2,
              buttons: 1,
            }),
          );
          // React renders on a scheduler task after the event: let it run, then take the time.
          await new Promise((r) => setTimeout(r, 0));
          await new Promise((r) => setTimeout(r, 0));
          times.push(performance.now() - t0);
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
        times.sort((a, b) => a - b);
        return times[30]!;
      },
      { x, y },
    );
    await page.mouse.up();
    return median;
  };
  const off = await measure(false);
  const on = await measure(true);
  test.info().annotations.push({
    type: 'drag ms per move (median)',
    description: `snap off ${off.toFixed(1)}, snap on ${on.toFixed(1)}`,
  });
  // Relative to the same drag without snapping, so a slow CI machine does not fail it: snapping,
  // guides and measurements must not make a move noticeably slower.
  expect(on).toBeLessThan(off * 1.5 + 4);
});

test('metric units nudge in round centimeters', async ({ page }) => {
  await seed(page, { 'room-sim-v3-units': 'cm' });
  const piece = page.getByRole('button', { name: /^Box,/ });
  await piece.focus();
  const cm = 0.0328084; // feet per cm
  const y0 = (await stored(page, 'Box')).y;
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await stored(page, 'Box')).y).toBeCloseTo(y0 + 5 * cm, 9);
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await stored(page, 'Box')).y).toBeCloseTo(y0 + 30 * cm, 9);
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(async () => (await stored(page, 'Box')).y).toBeCloseTo(y0 + 29 * cm, 9);
});

/**
 * Turn the Box with its rotate handle by `degrees` (clockwise), with real-looking pointer events
 * (mouse on desktop, touch on phones) and optional modifier keys. `release` false keeps it held.
 */
async function rotateBox(
  page: Page,
  degrees: number,
  {
    isMobile,
    shiftKey = false,
    altKey = false,
    release = true,
  }: { isMobile: boolean; shiftKey?: boolean; altKey?: boolean; release?: boolean },
) {
  await page.getByRole('button', { name: /^Box,/ }).click();
  const box = (await page.getByRole('button', { name: /^Box,/ }).boundingBox())!;
  const handle = (await page.getByTestId('rotate-handle').boundingBox())!;
  await page.evaluate(
    async ({ c, h, degrees, shiftKey, altKey, release, type }) => {
      const r = Math.hypot(h.x - c.x, h.y - c.y);
      const start = Math.atan2(h.y - c.y, h.x - c.x);
      const opts = (x: number, y: number, buttons: number) => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 11,
        pointerType: type,
        isPrimary: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons,
        shiftKey,
        altKey,
      });
      document
        .querySelector('[data-testid="rotate-handle"]')!
        .dispatchEvent(new PointerEvent('pointerdown', opts(h.x, h.y, 1)));
      const steps = 24;
      let x = h.x;
      let y = h.y;
      for (let i = 1; i <= steps; i++) {
        const a = start + ((degrees * Math.PI) / 180) * (i / steps);
        x = c.x + r * Math.cos(a);
        y = c.y + r * Math.sin(a);
        window.dispatchEvent(new PointerEvent('pointermove', opts(x, y, 1)));
        await new Promise((res) => setTimeout(res, 10));
      }
      const up = () => window.dispatchEvent(new PointerEvent('pointerup', opts(x, y, 0)));
      if (release) up();
      else (window as unknown as { __release: () => void }).__release = up;
    },
    {
      c: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      h: { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      degrees,
      shiftKey,
      altKey,
      release,
      type: isMobile ? 'touch' : 'mouse',
    },
  );
}

test('rotating near 90 degrees locks onto exactly 90, with an angle badge', async ({
  page,
  isMobile,
}) => {
  await seed(page);
  await rotateBox(page, 84, { isMobile, release: false });
  const badge = page.getByTestId('angle-badge');
  await expect(badge).toHaveText('90°');
  await expect(badge).toHaveAttribute('data-snapped', 'true');
  await expect(page.getByTestId('rotation-axis')).toHaveCount(1);
  await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
  await expect(badge).toHaveCount(0);
  expect((await stored(page, 'Box')).rotation).toBe(90);
});

test('a free angle shows in the badge without the lock; Alt/Option rotates freely', async ({
  page,
  isMobile,
}) => {
  await seed(page);
  await rotateBox(page, 30, { isMobile, release: false });
  const badge = page.getByTestId('angle-badge');
  await expect(badge).toHaveAttribute('data-snapped', 'false');
  await expect(badge).toHaveText(/^(29|30|31)°$/);
  await page.evaluate(() => (window as unknown as { __release: () => void }).__release());

  await rotateBox(page, 54, { isMobile, altKey: true }); // ~84: would lock onto 90 without Alt
  const r = (await stored(page, 'Box')).rotation;
  expect(r).not.toBe(90);
  expect(Math.abs(r - 84)).toBeLessThanOrEqual(2);
});

test('Shift while rotating steps by 15 degrees', async ({ page, isMobile }) => {
  await seed(page);
  await rotateBox(page, 37, { isMobile, shiftKey: true });
  const r = (await stored(page, 'Box')).rotation;
  expect(r % 15).toBe(0);
  expect([30, 45]).toContain(r);
});

test('with Snap off the rotate handle is free', async ({ page, isMobile }) => {
  await seed(page, { 'room-planner-pref-snap': '0' });
  await rotateBox(page, 86, { isMobile });
  const r = (await stored(page, 'Box')).rotation;
  expect(r).not.toBe(90);
  expect(Math.abs(r - 86)).toBeLessThanOrEqual(2);
});
