import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { viewerHtml } from '../scripts/build-viewer.mjs';
import { DINING } from '../worker/fixtures';
import { SHOWCASE_PLANS } from '../worker/showcase';
import { createPlan, readPlan, type ToolOutcome } from '../worker/tools';
import { storedDims, storedOpenings, storedPieces, workingPlan } from './storage';

// The MCP server (docs/design/plan-format.md, section 7) as users meet it:
// - a link the server makes opens in the real app as the same plan;
// - the MCP Apps plan viewer, driven by a minimal host that speaks the postMessage protocol;
// - the /mcp endpoint over HTTP, when the target serves it (`wrangler dev` or a preview, through
//   E2E_BASE_URL; `astro preview` has no Worker).

/** The viewer as the server serves it, built from source (as the Worker's build does). */
let viewer: Promise<string> | undefined;
const VIEWER = () => (viewer ??= viewerHtml());
/** Where to save viewer screenshots for review (optional). */
const SHOTS = process.env.MCP_SHOTS_DIR;

const bedroom = {
  version: 4,
  name: 'Guest bedroom',
  unit: 'in',
  rooms: [
    {
      id: 'room-1',
      name: 'Guest bedroom',
      outline: [
        { x: 0, y: 0 },
        { x: 132, y: 0 },
        { x: 132, y: 144 },
        { x: 0, y: 144 },
      ],
      openings: [
        { id: 'door-1', kind: 'door', wall: 2, offset: 90, width: 32 },
        { id: 'window-1', kind: 'window', wall: 0, offset: 42, width: 48 },
      ],
    },
  ],
  items: [
    { id: 'bed', label: 'Queen bed', width: 60, depth: 80, placement: { x: 66, y: 40 } },
    {
      id: 'ns-1',
      label: 'Nightstand',
      width: 20,
      depth: 16,
      color: '#fcd34d',
      placement: { x: 24, y: 8 },
    },
    {
      id: 'ns-2',
      label: 'Nightstand',
      width: 20,
      depth: 16,
      color: '#fcd34d',
      placement: { x: 108, y: 8 },
    },
    {
      id: 'dresser',
      label: 'Dresser',
      width: 18,
      depth: 60,
      color: '#d8b4fe',
      placement: { x: 123, y: 100 },
    },
    {
      id: 'chair',
      label: 'Armchair',
      width: 32,
      depth: 34,
      color: '#fdba74',
      placement: { x: 20, y: 120 },
    },
    {
      id: 'desk',
      label: 'Desk',
      width: 48,
      depth: 24,
      color: '#6ee7b7',
      placement: { x: 30, y: 128 },
    },
  ],
};

/** Two rooms joined by a door, with a round table, a piece set aside and two problems. */
const floor = {
  version: 4,
  name: 'Flat',
  unit: 'ft',
  rooms: [
    {
      id: 'living',
      name: 'Living room',
      // An L: 16 wide at the top, 10 wide below y = 8.
      outline: [
        { x: 0, y: 0 },
        { x: 16, y: 0 },
        { x: 16, y: 8 },
        { x: 10, y: 8 },
        { x: 10, y: 14 },
        { x: 0, y: 14 },
      ],
      openings: [
        // Wall 3 (x = 10, from y = 8 down to 14) is shared with the bedroom.
        { id: 'd-bed', kind: 'door', wall: 3, offset: 1, width: 3, type: 'swing-out' },
        { id: 'w-shared', kind: 'window', wall: 3, offset: 4.5, width: 1.5 },
        { id: 'w-1', kind: 'window', wall: 0, offset: 5, width: 4 },
      ],
    },
    {
      id: 'bedroom',
      name: 'Bedroom',
      outline: [
        { x: 10, y: 8 },
        { x: 16, y: 8 },
        { x: 16, y: 14 },
        { x: 10, y: 14 },
      ],
    },
  ],
  items: [
    { id: 'sofa', label: 'Sofa', width: 7, depth: 3, placement: { x: 5, y: 1.5 } },
    {
      id: 'table',
      label: 'Round table',
      shape: 'ellipse',
      width: 3.5,
      depth: 3.5,
      placement: { x: 4, y: 10 },
    },
    // In front of the door into the bedroom.
    { id: 'bed', label: 'Bed', width: 4, depth: 5, placement: { x: 12.5, y: 11 } },
    { id: 'spare', label: 'Spare chair', width: 2, depth: 2 },
  ],
};

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(500);
}

/** The link `create_plan` gives, on this server's origin. */
async function serverLink(baseURL: string, plan: unknown = bedroom): Promise<string> {
  const r = await createPlan({ plan }, new URL(baseURL).origin);
  expect(r.isError, r.text).toBeFalsy();
  return (r.structured as { url: string }).url;
}

test('a link from create_plan opens in the app as the same plan', async ({ page, baseURL }) => {
  const url = await serverLink(baseURL!);
  expect(url).toMatch(/\/#s=[A-Za-z0-9_-]+$/);
  await page.goto(url);
  await ready(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Guest bedroom' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  // No "made with a newer version" or "damaged link" dialog.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // What the editor stored (feet) is the plan the server made (inches).
  const inches = (v: number) => +(v * 12).toFixed(2) + 0; // + 0 turns -0 into 0
  const dims = await storedDims(page);
  expect([inches(dims.width), inches(dims.height)]).toEqual([132, 144]);
  // The door is on the bottom wall, 90 in from the bottom-right corner: 10 in from the left.
  const doors = await storedOpenings(page, 'door');
  expect(doors.map((d) => [d.wall, inches(d.position), inches(d.width), d.type])).toEqual([
    ['bottom', 10, 32, 'swing-in'],
  ]);
  const windows = await storedOpenings(page, 'window');
  expect(windows.map((w) => [w.wall, inches(w.position), inches(w.width)])).toEqual([
    ['top', 42, 48],
  ]);
  const pieces = await storedPieces(page);
  expect(
    pieces.map((p) => [p.label, inches(p.x), inches(p.y), inches(p.width), inches(p.height)]),
  ).toEqual(
    bedroom.items.map((i) => [
      i.label,
      i.placement.x - i.width / 2,
      i.placement.y - i.depth / 2,
      i.width,
      i.depth,
    ]),
  );
  expect((await workingPlan(page)).name).toBe('Guest bedroom');
  // The app shows the same problems the server reported (the desk and the chair overlap).
  await expect(page.getByText(/Overlapping/).first()).toBeVisible();
});

test('a floor of several rooms from create_plan opens in the app', async ({ page, baseURL }) => {
  await page.goto(await serverLink(baseURL!, floor));
  await ready(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const stored = await workingPlan(page);
  expect(stored.rooms.map((r) => [r.id, r.name, r.outline.length])).toEqual([
    ['living', 'Living room', 6],
    ['bedroom', 'Bedroom', 4],
  ]);
  expect(stored.items.map((i) => [i.id, i.shape, Boolean(i.placement)])).toEqual([
    ['sofa', 'rect', true],
    ['table', 'ellipse', true],
    ['bed', 'rect', true],
    ['spare', 'rect', false],
  ]);
});

test('read_plan reads a link the app made', async ({ page, baseURL }) => {
  await page.goto(await serverLink(baseURL!));
  await ready(page);
  await page.getByRole('button', { name: 'Share / Save' }).click();
  await expect(page.locator('#share-url')).toHaveValue(/#s=/);
  const appLink = await page.locator('#share-url').inputValue();
  const r = await readPlan({ url: appLink }, new URL(baseURL!).origin);
  expect(r.isError, r.text).toBeFalsy();
  // The app shares in its display unit (feet and inches here), so the plan comes back in feet.
  const plan = (r.structured as { plan: typeof bedroom }).plan;
  expect(plan.unit).toBe('ft');
  expect(
    plan.items.map((i) => [
      i.label,
      +(i.placement.x * 12).toFixed(3),
      +(i.placement.y * 12).toFixed(3),
    ]),
  ).toEqual(bedroom.items.map((i) => [i.label, i.placement.x, i.placement.y]));
});

// --- The plan viewer (MCP Apps) ------------------------------------------------------------------

/** The CallToolResult a host would forward for a tool outcome. */
const toResult = (o: ToolOutcome) => ({
  content: [{ type: 'text', text: o.text }],
  ...(o.structured ? { structuredContent: o.structured } : {}),
  ...(o.isError ? { isError: true } : {}),
});

/**
 * A minimal MCP Apps host: an iframe with the viewer that answers `ui/initialize`, sends the
 * tool result after `ui/notifications/initialized`, sizes the frame as the view asks, and records
 * what the view asks for. Its page is Claude's background in each theme.
 */
async function host(
  page: Page,
  result: unknown,
  {
    theme = 'light',
    width = 720,
    displayModes = ['inline'],
  }: { theme?: 'light' | 'dark'; width?: number; displayModes?: string[] } = {},
) {
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:16px;background:${theme === 'dark' ? '#262624' : '#faf9f5'}">` +
      `<iframe id="view" title="Room Planner plan" sandbox="allow-scripts" style="border:0;width:min(${width}px,calc(100vw - 32px));height:400px;display:block"></iframe>` +
      `</body></html>`,
  );
  await page.evaluate(
    ({ html, result, theme, displayModes }) => {
      const w = window as unknown as { __log: { method: string; params: unknown }[] };
      w.__log = [];
      const frame = document.getElementById('view') as HTMLIFrameElement;
      window.addEventListener('message', (e) => {
        if (e.source !== frame.contentWindow) return;
        const msg = e.data;
        w.__log.push({ method: msg.method, params: msg.params });
        const reply = (body: object) =>
          frame.contentWindow!.postMessage({ jsonrpc: '2.0', id: msg.id, ...body }, '*');
        if (msg.method === 'ui/initialize') {
          reply({
            result: {
              protocolVersion: '2026-01-26',
              hostInfo: { name: 'test-host', version: '1' },
              hostCapabilities: { openLinks: {} },
              hostContext: {
                theme,
                displayMode: 'inline',
                availableDisplayModes: displayModes,
                containerDimensions: { maxHeight: 2000 },
              },
            },
          });
        } else if (msg.method === 'ui/notifications/initialized') {
          frame.contentWindow!.postMessage(
            { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: {} } },
            '*',
          );
          frame.contentWindow!.postMessage(
            { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result },
            '*',
          );
        } else if (msg.method === 'ui/notifications/size-changed') {
          // Full screen is the window's size, whatever the view says.
          if (frame.style.position !== 'fixed') frame.style.height = `${msg.params.height}px`;
        } else if (msg.method === 'ui/open-link') {
          reply({ result: {} });
        } else if (msg.method === 'ui/request-display-mode') {
          const mode = msg.params.mode;
          if (mode === 'fullscreen') {
            frame.style.cssText = 'border:0;position:fixed;inset:0;width:100vw;height:100vh';
          }
          reply({ result: { mode } });
          frame.contentWindow!.postMessage(
            {
              jsonrpc: '2.0',
              method: 'ui/notifications/host-context-changed',
              params: { displayMode: mode },
            },
            '*',
          );
        }
      });
      frame.srcdoc = html;
    },
    { html: await VIEWER(), result, theme, displayModes },
  );
  const view = page.frameLocator('#view');
  await expect(view.locator('#summary')).not.toHaveText(/Loading|Checking/);
  return view;
}

const viewerLog = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __log: { method: string; params: unknown }[] }).__log,
  );

test.describe('plan viewer', () => {
  test('draws the plan, marks the issues, and opens the link through the host', async ({
    page,
    baseURL,
  }) => {
    const outcome = await createPlan({ plan: bedroom }, new URL(baseURL!).origin);
    const view = await host(page, toResult(outcome));
    await expect(view.locator('#sheet svg')).toBeVisible();
    await expect(view.getByRole('heading', { level: 1 })).toHaveText('Guest bedroom');
    await expect(view.locator('#summary')).toContainText('132 in × 144 in');
    // The drawing names its dimensions and the overlapping pieces are marked.
    await expect(view.locator('svg text', { hasText: '132 in' }).first()).toBeVisible();
    await expect(view.locator('g[data-id="desk"]')).toHaveClass(/hl-error/);
    await expect(view.locator('g[data-id="chair"]')).toHaveClass(/hl-error/);
    // Errors first in the list.
    const first = view.getByRole('button', { name: /overlaps/ }).first();
    await expect(view.locator('#issues button').first()).toContainText('error');
    // Choosing an issue points at its pieces.
    // Enter, not a click: iOS WebKit grows an iframe to its content, which confuses hit testing in
    // this test host (real hosts embed the view in their own web view).
    await first.press('Enter');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(view.locator('g[data-id="desk"]')).toHaveClass(/focus/);
    await expect(view.locator('g[data-id="bed"]')).not.toHaveClass(/focus/);

    await view.getByRole('button', { name: 'Open in Room Planner' }).press('Enter');
    await expect
      .poll(async () => (await viewerLog(page)).find((m) => m.method === 'ui/open-link')?.params)
      .toEqual({ url: (outcome.structured as { url: string }).url });
    const methods = (await viewerLog(page)).map((m) => m.method);
    expect(methods.slice(0, 2)).toEqual(['ui/initialize', 'ui/notifications/initialized']);
    expect(methods).toContain('ui/notifications/size-changed');
  });

  test('is accessible and follows the host theme', async ({ page, baseURL }) => {
    const outcome = await createPlan({ plan: bedroom }, new URL(baseURL!).origin);
    for (const theme of ['light', 'dark'] as const) {
      const view = await host(page, toResult(outcome), { theme });
      await expect(view.locator('#sheet svg')).toBeVisible();
      await expect(view.locator('html')).toHaveAttribute('data-theme', theme);
      const results = await new AxeBuilder({ page })
        .include('#view')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'])
        .analyze();
      const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact!));
      expect(serious.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    }
  });

  test('shows the text when the host passes no structured result, and errors as text', async ({
    page,
    baseURL,
  }) => {
    const outcome = await createPlan({ plan: bedroom }, new URL(baseURL!).origin);
    const { structuredContent: _, ...bare } = toResult(outcome);
    const view = await host(page, bare);
    await expect(view.locator('#sheet')).toBeHidden();
    await expect(view.locator('#summary')).toContainText('132 in × 144 in');
    // The link at the end of the text (Markdown or bare) still gets the button.
    await view.getByRole('button', { name: 'Open in Room Planner' }).press('Enter');
    await expect
      .poll(async () => (await viewerLog(page)).find((m) => m.method === 'ui/open-link')?.params)
      .toEqual({ url: (outcome.structured as { url: string }).url });

    const bad = await createPlan({ plan: { version: 4, unit: 'yd' } }, 'https://x.test');
    const errorView = await host(page, toResult(bad));
    await expect(errorView.locator('#summary')).toContainText('The plan is not valid');
    await expect(errorView.getByRole('button', { name: 'Open in Room Planner' })).toBeHidden();
  });

  test('draws a floor of several rooms: names, set-aside list, issues per room', async ({
    page,
    baseURL,
  }) => {
    const outcome = await createPlan({ plan: floor }, new URL(baseURL!).origin);
    expect(outcome.isError).toBeFalsy();
    expect(outcome.structured).toMatchObject({ editable: true });
    const view = await host(page, toResult(outcome));
    await expect(view.locator('#sheet svg')).toBeVisible();
    await expect(view.locator('#summary')).toContainText(
      'Doors between rooms: Living room to Bedroom',
    );
    // Each room is labelled with its name; the piece set aside is listed under the drawing.
    for (const name of ['Living room', 'Bedroom']) {
      await expect(view.locator('g[data-role="room-label"] text', { hasText: name })).toHaveCount(
        1,
      );
    }
    await expect(view.locator('svg text', { hasText: 'Set aside (1)' })).toHaveCount(1);
    await expect(view.locator('svg text', { hasText: /Spare chair/ })).toHaveCount(1);
    // The window on the shared wall marks the window and the room that lists it.
    await expect(view.locator('g[data-id="w-shared"]')).toHaveClass(/hl-warning/);
    await expect(view.locator('g[data-role="room"][data-id="living"]')).toHaveClass(/hl-warning/);
    // The bed in the doorway, in the next room, is marked too.
    await expect(view.locator('g[data-id="bed"]')).toHaveClass(/hl-warning/);
    await expect(view.getByRole('button', { name: 'Open in Room Planner' })).toBeVisible();
    await expect(view.locator('#note')).toHaveText('');
    if (SHOTS && test.info().project.name === 'chromium') {
      await page.locator('#view').screenshot({ path: `${SHOTS}/viewer-floor.png` });
    }
  });

  test('carousel screenshots for the directories (PNG, 1000 px and wider)', async ({
    page,
    baseURL,
    browserName,
  }) => {
    test.skip(!SHOTS || browserName !== 'chromium', 'Set MCP_SHOTS_DIR to save screenshots');
    const origin = new URL(baseURL!).origin;
    for (const [name, plan] of SHOWCASE_PLANS) {
      await page.setViewportSize({ width: 1100 + 32, height: 1400 });
      const view = await host(page, toResult(await createPlan({ plan }, origin)), { width: 1100 });
      await expect(view.locator('#sheet svg')).toBeVisible();
      await view.locator('body').evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      await page.locator('#view').screenshot({ path: `${SHOTS}/carousel-${name}.png` });
    }
  });

  test('the dining plan: the plan alone, the link first, gaps grouped and closed', async ({
    page,
    baseURL,
  }) => {
    const outcome = await createPlan({ plan: DINING }, new URL(baseURL!).origin);
    const view = await host(page, toResult(outcome), { width: 390 });
    await expect(view.locator('#sheet svg')).toBeVisible();
    await expect(view.getByRole('heading', { level: 1 })).toHaveText(DINING.name);
    // The heading names the plan once: the drawing has no title, date or site of its own.
    await expect(view.locator('#sheet g[data-role="title"]')).toHaveCount(0);
    await expect(view.locator('#sheet g[data-role="footer"]')).toHaveCount(0);
    await expect(view.locator('#sheet svg text', { hasText: DINING.name })).toHaveCount(0);
    await expect(view.locator('#sheet svg text', { hasText: 'room-planner' })).toHaveCount(0);
    // The main action comes first.
    const first = await view
      .locator('body')
      .evaluate(
        () =>
          [...document.querySelectorAll<HTMLElement>('button, summary, a[href], [tabindex]')].find(
            (el) => el.offsetParent !== null,
          )?.id,
      );
    expect(first).toBe('open');
    await expect(view.getByRole('button', { name: 'Full screen' })).toBeHidden();
    // At phone size, pieces show their names but not their sizes; hover or a tap gives them.
    const chair = view.locator('g[data-id="chair-1"]');
    await expect(chair.locator('text').nth(0)).toBeVisible();
    await expect(chair.locator('text').nth(1)).toBeHidden();
    await chair.locator('rect').dispatchEvent('click');
    await expect(view.locator('#picked')).toHaveText(/^Chair · 18 in × 20 in$/);
    await expect(chair).toHaveClass(/focus/);

    // No errors or warnings: one line says so; the tight gaps are grouped, closed, and counted.
    await expect(view.locator('#issues .ok')).toContainText('No overlaps');
    const details = view.locator('#issues-section details');
    await expect(details.locator('summary')).toHaveText('6 tight gaps');
    await expect(details).not.toHaveAttribute('open');
    const group = view.getByRole('button', { name: /Chair and Buffet/ });
    await expect(group).toBeHidden();
    await details.locator('summary').press('Enter');
    await expect(group).toHaveCount(1);
    await expect(group).toContainText('×3');
    await group.press('Enter');
    for (const id of ['chair-6', 'chair-7', 'chair-8', 'buffet']) {
      await expect(view.locator(`g[data-id="${id}"]`)).toHaveClass(/focus/);
    }
    await expect(view.locator('g[data-id="chair-1"]')).not.toHaveClass(/focus/);

    // Closed again, the frame shrinks back to the content: no blank space under it.
    const heights = async () =>
      (await viewerLog(page))
        .filter((m) => m.method === 'ui/notifications/size-changed')
        .map((m) => (m.params as { height: number }).height);
    const open = (await heights()).at(-1)!;
    await details.locator('summary').press('Enter');
    await expect.poll(async () => (await heights()).at(-1)).toBeLessThan(open);
    const content = await view
      .locator('main')
      .evaluate((el) => Math.ceil(el.getBoundingClientRect().height));
    await expect.poll(async () => (await heights()).at(-1)).toBe(content);
    const frame = await page.locator('#view').boundingBox();
    expect(Math.round(frame!.height)).toBe(content);
    // The last thing in the view ends at the frame's bottom, less main's padding.
    const gap = await view.locator('body').evaluate(() => {
      const last = document.querySelector('#issues-section')!.getBoundingClientRect().bottom;
      return window.innerHeight - last;
    });
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(16);
  });

  test('offers full screen only when the host has it', async ({ page, baseURL }) => {
    const outcome = await createPlan({ plan: DINING }, new URL(baseURL!).origin);
    const view = await host(page, toResult(outcome), { displayModes: ['inline', 'fullscreen'] });
    const button = view.getByRole('button', { name: 'Full screen' });
    await expect(button).toBeVisible();
    await button.press('Enter');
    await expect
      .poll(async () => (await viewerLog(page)).find((m) => m.method === 'ui/request-display-mode'))
      .toEqual({ method: 'ui/request-display-mode', params: { mode: 'fullscreen' } });
    await expect(view.locator('html')).toHaveAttribute('data-mode', 'fullscreen');
    await expect(view.getByRole('button', { name: 'Exit full screen' })).toBeVisible();
    // In full screen the drawing may be as tall as the window allows, not the inline 560 px.
    await expect
      .poll(() =>
        view
          .locator('#sheet')
          .evaluate((el) => parseFloat(el.style.getPropertyValue('--sheet-max'))),
      )
      .toBeGreaterThan(560);
    if (SHOTS && test.info().project.name === 'chromium') {
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SHOTS}/dining-fullscreen-light.png` });
    }
  });

  test('dining plan screenshots: phone and desktop, dark and light', async ({
    page,
    baseURL,
    browserName,
  }) => {
    test.skip(!SHOTS || browserName !== 'chromium', 'Set MCP_SHOTS_DIR to save screenshots');
    const outcome = await createPlan({ plan: DINING }, new URL(baseURL!).origin);
    for (const theme of ['dark', 'light'] as const) {
      for (const [name, width] of [
        ['phone', 390],
        ['desktop', 720],
      ] as const) {
        await page.setViewportSize({ width: width + 32, height: 1400 });
        const view = await host(page, toResult(outcome), { theme, width });
        await expect(view.locator('#sheet svg')).toBeVisible();
        await view.locator('body').evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        // The host page around the frame, to its bottom: blank space in the view would show.
        const shot = async (path: string) => {
          const box = (await page.locator('#view').boundingBox())!;
          await page.screenshot({
            path,
            clip: { x: 0, y: 0, width: width + 32, height: Math.ceil(box.y + box.height + 16) },
          });
        };
        await shot(`${SHOTS}/dining-${name}-${theme}.png`);
        if (name === 'phone') {
          await view.locator('#issues-section summary').press('Enter');
          await view.getByRole('button', { name: /Chair and Buffet/ }).press('Enter');
          await page.waitForTimeout(300);
          await shot(`${SHOTS}/dining-${name}-${theme}-gaps.png`);
        }
      }
    }
  });

  test('screenshots for review', async ({ page, baseURL, browserName }) => {
    test.skip(!SHOTS || browserName !== 'chromium', 'Set MCP_SHOTS_DIR to save screenshots');
    const outcome = await createPlan({ plan: bedroom }, new URL(baseURL!).origin);
    for (const theme of ['light', 'dark'] as const) {
      for (const [name, width] of [
        ['desktop', 720],
        ['narrow', 360],
      ] as const) {
        await page.setViewportSize({ width: width + 32, height: 1200 });
        const view = await host(page, toResult(outcome), { theme, width });
        await expect(view.locator('#sheet svg')).toBeVisible();
        await view.locator('body').evaluate(() => document.fonts.ready);
        await page.waitForTimeout(200);
        await page.locator('#view').screenshot({ path: `${SHOTS}/viewer-${name}-${theme}.png` });
      }
      // A floor of several rooms, with its labels, shared walls and set-aside list.
      await page.setViewportSize({ width: 720 + 32, height: 1200 });
      const flat = await createPlan({ plan: floor }, new URL(baseURL!).origin);
      const view = await host(page, toResult(flat), { theme });
      await expect(view.locator('#sheet svg')).toBeVisible();
      await view.locator('body').evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      await page.locator('#view').screenshot({ path: `${SHOTS}/viewer-floor-${theme}.png` });
    }
  });
});

// --- /mcp over HTTP (wrangler dev or a preview) ----------------------------------------------------

test.describe('the /mcp endpoint', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ request }) => {
    // HTTP only: one project per run is enough. Chromium locally and in CI; Firefox in the
    // cross-browser run, which has no Chromium and is the one that targets a preview.
    test.skip(
      !['chromium', 'firefox'].includes(test.info().project.name),
      'HTTP only: one project is enough',
    );
    const card = await request.get('/mcp/server-card');
    test.skip(card.status() !== 200, 'This server has no Worker (astro preview)');
  });

  const rpc = (method: string, params: object = {}, id = 1) => ({
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    data: { jsonrpc: '2.0', id, method, params },
  });
  /** The JSON-RPC message in a response (a JSON body or one SSE event). */
  const message = async (r: { text(): Promise<string> }) => {
    const body = await r.text();
    const data = body.trim().startsWith('{') ? body : /^data: (.*)$/m.exec(body)![1]!;
    return JSON.parse(data);
  };

  test('lists the tools, makes a plan whose link opens in the app', async ({ request, page }) => {
    const list = await message(await request.post('/mcp', rpc('tools/list')));
    expect(list.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      'check_layout',
      'create_plan',
      'read_plan',
    ]);
    const made = await message(
      await request.post(
        '/mcp',
        rpc('tools/call', { name: 'create_plan', arguments: { plan: bedroom } }),
      ),
    );
    const url: string = made.result.structuredContent.url;
    // The link names the canonical site; open its fragment on the server under test.
    await page.goto(`/${new URL(url).hash}`);
    await ready(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Guest bedroom' })).toBeVisible();
  });

  test('the REST API makes a link that opens the plan; its description is served', async ({
    request,
    page,
  }) => {
    const r = await request.post('/api/plan/link', { data: floor });
    expect(r.status()).toBe(200);
    expect(r.headers()['access-control-allow-origin']).toBe('*');
    const { url } = (await r.json()) as { url: string };
    await page.goto(`/${new URL(url).hash}`);
    await ready(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Flat' })).toBeVisible();
    expect((await workingPlan(page)).rooms.map((x) => x.name)).toEqual(['Living room', 'Bedroom']);

    const bad = await request.post('/api/plan/check', { data: { ...floor, unit: 'yd' } });
    expect(bad.status()).toBe(422);
    expect(bad.headers()['content-type']).toBe('application/problem+json');
    const spec = await request.get('/openapi.json');
    expect(spec.status()).toBe(200);
    expect(((await spec.json()) as { openapi: string }).openapi).toBe('3.1.0');
    expect((await request.get('/plan.schema.json')).status()).toBe(200);
  });

  test('CORS, 405 and 404, and the pages still come from the assets', async ({ request }) => {
    const pre = await request.fetch('/mcp', {
      method: 'OPTIONS',
      headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' },
    });
    expect(pre.status()).toBe(204);
    expect(pre.headers()['access-control-allow-origin']).toBe('*');
    expect((await request.get('/mcp')).status()).toBe(405);
    expect((await request.get('/mcp/nope')).status()).toBe(404);
    const missing = await request.get('/no-such-page/');
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain('<html');
    const home = await request.get('/');
    expect(home.status()).toBe(200);
    expect(home.headers()['content-security-policy']).toContain("default-src 'self'");
    const catalog = await request.get('/.well-known/ai-catalog.json');
    expect(catalog.headers()['content-type']).toContain('application/ai-catalog+json');
  });

  // The registry fetches the proof with Accept: text/plain and follows no redirects.
  test('serves the MCP Registry proof as plain text, as committed', async ({ request }) => {
    const proof = await request.get('/.well-known/mcp-registry-auth', {
      headers: { Accept: 'text/plain', 'User-Agent': 'mcp-registry/1.0' },
      maxRedirects: 0,
    });
    expect(proof.status()).toBe(200);
    expect(proof.headers()['content-type']).toMatch(/^text\/plain/);
    expect(await proof.text()).toBe(readFileSync('public/.well-known/mcp-registry-auth', 'utf8'));
  });

  // Last: it uses up this address's allowance for a minute. Sequential, so the requests share a
  // connection and so an isolate (the in-memory limit is per isolate; see worker/http.ts).
  test('rate limits a burst with 429 and Retry-After', async ({ request }) => {
    test.slow();
    let limited: { status: number; retryAfter?: string } | undefined;
    for (let i = 0; i < 250 && !limited; i++) {
      const r = await request.post('/mcp', rpc('ping'));
      if (r.status() === 429) limited = { status: 429, retryAfter: r.headers()['retry-after'] };
      else expect(r.status()).toBe(200);
    }
    expect(limited).toEqual({ status: 429, retryAfter: '60' });
  });
});
