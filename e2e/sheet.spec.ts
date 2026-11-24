import { expect, test, type Locator, type Page } from '@playwright/test';
import { animationsSettled, openStep, setDetent, sheetDetent, viewPlan } from './ui';

// The phone editor: a bottom sheet at peek / half / full height over the plan. Runs in every
// project at a phone-sized viewport (so the required chromium job covers it too); the last test
// checks that wide screens keep the sidebar.

const PHONE = { width: 390, height: 844 };

/** Wait for the island to mount and for the initial auto-fit zoom (500ms) to settle. */
async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
  await animationsSettled(page);
}

/** A stand-in for the PostHog SDK (off under automation) that records every capture. */
const recordEvents = (page: Page) =>
  page.addInitScript(() => {
    const events: [string, Record<string, unknown> | undefined][] = [];
    (window as unknown as { __events: typeof events }).__events = events;
    (window as unknown as { posthog: unknown }).posthog = {
      __SV: 1,
      capture: (name: string, props?: Record<string, unknown>) => events.push([name, props]),
    };
  });
const sheetEvents = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __events: [string, Record<string, unknown>][] }).__events
      .filter(([e]) => e === 'sheet_resized')
      .map(([, p]) => p),
  );

const sheet = (page: Page) => page.getByTestId('sidebar');
const handle = (page: Page) => page.getByRole('button', { name: 'Resize editor' });
const box = async (l: Locator) => (await l.boundingBox())!;

/** The furniture card whose label is `label` (the highlight that marks a card fades after 1.5s). */
async function cardOf(page: Page, label: string): Promise<Locator> {
  const cards = page.getByTestId('furniture-card');
  const labels = await cards
    .getByLabel('Item label')
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(labels).toContain(label);
  return cards.nth(labels.indexOf(label));
}

/** The part of the plan that shows: below the mode badge, above the zoom row riding on the sheet. */
async function visibleArea(page: Page) {
  const plan = await box(page.locator('#floor-plan'));
  const pill = await box(page.getByTestId('zoom-pill'));
  const badge = await box(page.getByTestId('mode-badge'));
  return { top: badge.y + badge.height, bottom: pill.y, left: plan.x, right: plan.x + plan.width };
}

async function expectInside(page: Page, el: Locator) {
  const area = await visibleArea(page);
  const b = await box(el);
  expect(b.y, 'above the visible area').toBeGreaterThanOrEqual(area.top - 1);
  expect(b.y + b.height, 'under the sheet').toBeLessThanOrEqual(area.bottom + 1);
  expect(b.x).toBeGreaterThanOrEqual(area.left - 1);
  expect(b.x + b.width).toBeLessThanOrEqual(area.right + 1);
}

/** Drag the sheet by its handle with (touch) pointer events: `dy` px over `ms` milliseconds. */
async function dragHandle(page: Page, dy: number, ms: number) {
  const b = await box(handle(page));
  await page.evaluate(
    async ({ x, y, dy, ms }) => {
      const o = (cy: number, buttons: number) => ({
        bubbles: true,
        cancelable: true,
        pointerId: 9,
        pointerType: 'touch',
        isPrimary: true,
        clientX: x,
        clientY: cy,
        button: 0,
        buttons,
      });
      document
        .querySelector('[data-testid="sheet-handle"]')!
        .dispatchEvent(new PointerEvent('pointerdown', o(y, 1)));
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        await new Promise((r) => setTimeout(r, ms / steps));
        window.dispatchEvent(new PointerEvent('pointermove', o(y + (dy * i) / steps, 1)));
      }
      window.dispatchEvent(new PointerEvent('pointerup', o(y + dy, 0)));
    },
    { x: b.x + b.width / 2, y: b.y + 30, dy, ms },
  );
  await animationsSettled(page);
}

test.describe('phone bottom sheet', () => {
  test.use({ viewport: PHONE });

  test('a first visit opens it at half: the whole plan fits above it', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    await expect(sheet(page)).toHaveAttribute('data-detent', 'half');
    await expect(sheet(page)).toHaveAttribute('role', 'region');
    await expect(sheet(page)).toHaveAttribute('aria-label', 'Editor');
    await expect(handle(page)).toHaveAttribute('aria-expanded', 'true');
    const s = await box(sheet(page));
    expect(s.height).toBeGreaterThan(PHONE.height * 0.4);
    expect(s.height).toBeLessThan(PHONE.height * 0.5);
    expect(s.y + s.height).toBeCloseTo(PHONE.height, 0);
    await expectInside(page, page.getByTestId('room'));
    // The step and its controls are in view in the sheet.
    await expect(page.getByTestId('sheet-summary')).toHaveText('2. Items · 6 pieces');
    await expect(page.getByRole('button', { name: /^2\. Items/ })).toBeInViewport();
  });

  test('tapping the handle cycles peek, half and full; the height is kept for the session', async ({
    page,
    browser,
  }) => {
    await recordEvents(page);
    await page.goto('/');
    await ready(page);
    await handle(page).click();
    await expect(sheet(page)).toHaveAttribute('data-detent', 'full');
    await expect(handle(page)).toHaveAttribute('aria-expanded', 'true');
    // Full covers the plan: it is out of reach, and so are the controls riding on the sheet.
    await expect(page.locator('#floor-plan')).toHaveAttribute('inert', '');
    await expect(page.getByTestId('sheet-floating')).toHaveCount(0);
    await expect(page.getByTestId('mode-badge')).toHaveCount(0);
    await handle(page).click();
    await expect(sheet(page)).toHaveAttribute('data-detent', 'peek');
    await expect(handle(page)).toHaveAttribute('aria-expanded', 'false');
    // Peek: a one-line summary and the key action; the rest is inert.
    await expect(page.getByTestId('sheet-content')).toHaveAttribute('inert', '');
    await expect(page.getByTestId('sheet-action')).toHaveText('Add item');
    await animationsSettled(page);
    expect((await box(sheet(page))).height).toBeLessThan(110);
    await expectInside(page, page.getByTestId('room'));
    await handle(page).click();
    await expect(sheet(page)).toHaveAttribute('data-detent', 'half');
    expect(await sheetEvents(page)).toEqual([
      { to: 'full', input: 'tap' },
      { to: 'peek', input: 'tap' },
      { to: 'half', input: 'tap' },
    ]);

    // Remembered on reload (same session)...
    await setDetent(page, 'peek');
    await page.reload();
    await ready(page);
    await expect(sheet(page)).toHaveAttribute('data-detent', 'peek');
    // ...but a new session starts at half again.
    const fresh = await browser.newContext({ ...test.info().project.use, viewport: PHONE });
    const other = await fresh.newPage();
    await other.goto('/');
    await ready(other);
    await expect(sheet(other)).toHaveAttribute('data-detent', 'half');
    await fresh.close();
  });

  test('keyboard: Arrow Up/Down step the height, Enter cycles it; focus stays on the handle', async ({
    page,
  }) => {
    await recordEvents(page);
    await page.goto('/');
    await ready(page);
    await handle(page).focus();
    await page.keyboard.press('ArrowDown');
    await expect(sheet(page)).toHaveAttribute('data-detent', 'peek');
    await page.keyboard.press('ArrowDown'); // already at the bottom
    await expect(sheet(page)).toHaveAttribute('data-detent', 'peek');
    await page.keyboard.press('ArrowUp');
    await expect(sheet(page)).toHaveAttribute('data-detent', 'half');
    await page.keyboard.press('ArrowUp');
    await expect(sheet(page)).toHaveAttribute('data-detent', 'full');
    await page.keyboard.press('Enter');
    await expect(sheet(page)).toHaveAttribute('data-detent', 'peek');
    await expect(handle(page)).toBeFocused();
    await expect(handle(page)).toHaveAccessibleDescription(/collapsed/);
    expect(await sheetEvents(page)).toEqual([
      { to: 'peek', input: 'keyboard' },
      { to: 'half', input: 'keyboard' },
      { to: 'full', input: 'keyboard' },
      { to: 'peek', input: 'keyboard' },
    ]);

    // "Skip to floor plan" under a full sheet uncovers the plan and focuses it.
    await setDetent(page, 'full');
    await page.getByRole('link', { name: 'Skip to floor plan' }).focus();
    await page.keyboard.press('Enter');
    await expect(sheet(page)).toHaveAttribute('data-detent', 'half');
    await expect(page.locator('#floor-plan')).toBeFocused();
  });

  test('dragging the handle snaps to the nearest height; a flick goes on to the next', async ({
    page,
  }) => {
    await recordEvents(page);
    await page.goto('/');
    await ready(page);
    await dragHandle(page, -60, 600); // a little, slowly: back to half
    expect(await sheetDetent(page)).toBe('half');
    await dragHandle(page, -320, 600); // most of the way up, slowly: full
    expect(await sheetDetent(page)).toBe('full');
    await dragHandle(page, 80, 40); // a short flick down: one step, to half
    expect(await sheetDetent(page)).toBe('half');
    await dragHandle(page, 250, 600); // down, slowly: peek
    expect(await sheetDetent(page)).toBe('peek');
    await dragHandle(page, -60, 40); // a short flick up: half
    expect(await sheetDetent(page)).toBe('half');
    const s = await box(sheet(page));
    expect(s.y + s.height).toBeCloseTo(PHONE.height, 0);
    expect(await sheetEvents(page)).toEqual([
      { to: 'full', input: 'drag' },
      { to: 'half', input: 'drag' },
      { to: 'peek', input: 'drag' },
      { to: 'half', input: 'drag' },
    ]);
  });

  test('pulling the content down from its top collapses the sheet; scrolled content just scrolls', async ({
    page,
  }) => {
    await page.goto('/');
    await ready(page);
    const canTouch = await page.evaluate(() => {
      try {
        new TouchEvent('touchstart', {
          touches: [new Touch({ identifier: 1, target: document.body, clientX: 0, clientY: 0 })],
        });
        return true;
      } catch {
        return false;
      }
    });
    test.skip(!canTouch, 'this engine cannot construct touch events');
    const pull = (dy: number) =>
      page.evaluate(async (dy) => {
        const el = document.querySelector('[data-testid="sheet-content"]')!;
        const r = el.getBoundingClientRect();
        const at = (y: number) =>
          new Touch({ identifier: 3, target: el, clientX: r.left + 100, clientY: y });
        const fire = (type: string, y: number) =>
          el.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              cancelable: true,
              touches: type === 'touchend' ? [] : [at(y)],
              changedTouches: [at(y)],
            }),
          );
        const y0 = r.top + 40;
        fire('touchstart', y0);
        for (let i = 1; i <= 10; i++) {
          await new Promise((res) => setTimeout(res, 40));
          fire('touchmove', y0 + (dy * i) / 10);
        }
        fire('touchend', y0 + dy);
      }, dy);

    // Scrolled down a bit: pulling down scrolls the content, the sheet stays.
    await page.getByTestId('sheet-content').evaluate((el) => (el.scrollTop = 120));
    await pull(250);
    await animationsSettled(page);
    expect(await sheetDetent(page)).toBe('half');

    await page.getByTestId('sheet-content').evaluate((el) => (el.scrollTop = 0));
    await pull(280);
    await animationsSettled(page);
    expect(await sheetDetent(page)).toBe('peek');
  });

  test('Fit to view and a room size change fit the plan above the sheet', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Fit to view' }).click();
    await expectInside(page, page.getByTestId('room'));

    // A much wider room re-fits, still above the sheet.
    await openStep(page, 'room');
    const width = page.getByLabel('Room width');
    await width.fill('30');
    await width.press('Enter');
    await expect(page.getByTestId('sheet-summary')).toContainText(`1. Room · 30' × 12'`);
    await width.blur();
    await animationsSettled(page);
    await expectInside(page, page.getByTestId('room'));
    const room = await box(page.getByTestId('room'));
    expect(room.width).toBeGreaterThan(PHONE.width * 0.7);
  });

  test('tapping a piece on the plan opens a collapsed sheet and brings its card up', async ({
    page,
  }) => {
    await page.goto('/');
    await ready(page);
    await viewPlan(page);
    await animationsSettled(page);
    const chair = page.getByRole('button', { name: /^Chair,/ });
    await chair.click();
    await expect(sheet(page)).toHaveAttribute('data-detent', 'half');
    await expect(page.getByTestId('sheet-summary')).toHaveText(`Chair · 1'6" × 1'6"`);
    const card = page
      .locator('[data-highlighted]')
      .filter({ has: page.getByTestId('furniture-card') });
    await expect(card.getByLabel('Item label')).toHaveValue('Chair');
    await animationsSettled(page);
    await page.waitForTimeout(400);
    // The card is in the visible part of the sheet, and the chair is still in sight above it.
    const header = await box(page.getByTestId('sheet-header'));
    const c = await box(await cardOf(page, 'Chair'));
    expect(c.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(c.y).toBeLessThan(PHONE.height - 100);
    await expectInside(page, chair);

    // Collapsed again with the chair selected: Edit brings its card back.
    await setDetent(page, 'peek');
    await expect(page.getByTestId('sheet-action')).toHaveText('Edit');
    await page.getByTestId('sheet-action').click();
    await expect(sheet(page)).toHaveAttribute('data-detent', 'half');
    await expect(card.getByLabel('Item label')).toHaveValue('Chair');
  });

  test('picking a card pans its piece out from under the sheet', async ({ page }) => {
    await page.goto('/');
    await ready(page);
    // Zoomed in, the desk (bottom right) is off the visible part of the plan.
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
    const desk = page.getByRole('button', { name: /^Desk,/ });
    const area = await visibleArea(page);
    const before = await box(desk);
    expect(before.y + before.height > area.bottom || before.x + before.width > area.right).toBe(
      true,
    );
    const deskCard = await cardOf(page, 'Desk');
    await deskCard.scrollIntoViewIfNeeded();
    await deskCard.click({ position: { x: 6, y: 6 } });
    await expect(desk).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(200);
    await expectInside(page, desk);
  });

  test('the focused field stays in view above the on-screen keyboard', async ({ page }) => {
    // Playwright has no on-screen keyboard: stand in for the visual viewport and shrink it.
    await page.addInitScript(() => {
      class FakeViewport extends EventTarget {
        get height() {
          return window.innerHeight - ((window as unknown as { __kb?: number }).__kb ?? 0);
        }
        get width() {
          return window.innerWidth;
        }
        offsetTop = 0;
        offsetLeft = 0;
        pageTop = 0;
        pageLeft = 0;
        scale = 1;
      }
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: new FakeViewport(),
      });
    });
    const keyboard = (px: number) =>
      page.evaluate((px) => {
        (window as unknown as { __kb: number }).__kb = px;
        window.visualViewport!.dispatchEvent(new Event('resize'));
      }, px);
    await page.goto('/');
    await ready(page);
    await openStep(page, 'furniture');
    // A field at the bottom of the half-open sheet, where the keyboard will come up.
    const field = page
      .getByTestId('furniture-card')
      .nth(1)
      .getByLabel(/^Width of /);
    await field.evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await field.focus();
    await keyboard(330);
    await animationsSettled(page);
    const top = PHONE.height - 330;
    const s = await box(sheet(page));
    expect(s.y + s.height).toBeCloseTo(top, 0);
    await expect(field).toBeFocused();
    const f = await box(field);
    const header = await box(page.getByTestId('sheet-header'));
    expect(f.y + f.height).toBeLessThanOrEqual(top);
    expect(f.y).toBeGreaterThanOrEqual(header.y + header.height - 1);

    await keyboard(0);
    await animationsSettled(page);
    const after = await box(sheet(page));
    expect(after.y + after.height).toBeCloseTo(PHONE.height, 0);
    expect(await sheetDetent(page)).toBe('half');
  });

  test('adding a piece while the sheet covers the plan lowers it, so the piece shows', async ({
    page,
  }) => {
    await page.goto('/');
    await ready(page);
    await setDetent(page, 'full');
    await page.getByRole('button', { name: 'Add Item' }).click();
    await expect(sheet(page)).toHaveAttribute('data-detent', 'half');
    await animationsSettled(page);
    await expectInside(page, page.getByRole('button', { name: /^New Item,/ }));
    // Its card is in view in the sheet too.
    await expect(await cardOf(page, 'New Item')).toBeInViewport();
  });
});

test('wide screens keep the sidebar (no sheet)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'wide screens');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await ready(page);
  await expect(handle(page)).toHaveCount(0);
  await expect(page.getByTestId('sheet-floating')).toHaveCount(0);
  const side = await box(sheet(page));
  expect(side).toMatchObject({ x: 0, width: 320 });
  expect(side.y).toBeCloseTo(64, 0);
  expect(side.height).toBeCloseTo(800 - 64, 0);
  await expect(sheet(page)).not.toHaveAttribute('data-detent');
  await expect(sheet(page)).not.toHaveAttribute('role');
  // Zoom and Snap stay in the top bar.
  await expect(page.getByTestId('snap-toggle')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit to view' })).toBeVisible();
});
