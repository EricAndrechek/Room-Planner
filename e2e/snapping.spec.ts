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

async function seed(page: Page) {
  await page.addInitScript((items) => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem('room-sim-v3-dims', JSON.stringify({ width: 12, height: 12 }));
    localStorage.setItem('room-sim-v3-doors', '[]');
    localStorage.setItem('room-sim-v3-windows', '[]');
    localStorage.setItem('room-sim-v3-items', JSON.stringify(items));
    localStorage.setItem('room-sim-v3-mode', 'furniture');
    sessionStorage.setItem('seeded', '1');
  }, ITEMS);
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

  // Shift+Right twice: 3 -> 4 -> 5, where its right edge is flush with the Bed (announced).
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await stored(page, 'Box')).x).toBe(5);
  await expect(page.locator('[role="status"][aria-atomic="true"]')).toContainText('Against Bed');

  // Stepping away again is never pulled back onto the edge it just left.
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await stored(page, 'Box')).x).toBe(4.75);
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

  /** Median ms per pointer move (handler, React render, layout, next frame) over 60 moves. */
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
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          times.push(performance.now() - t0);
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
  // Relative to the same drag without snapping, so a slow (CI, software-rendered) browser does not
  // fail it: snapping, guides and measurements must not make a move noticeably slower.
  expect(on).toBeLessThan(off * 1.5 + 8);
});
