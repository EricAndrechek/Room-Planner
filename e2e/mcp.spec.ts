import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { VIEW_META_KEY, createPlan, readPlan, type ToolOutcome } from '../worker/tools';

// The MCP server (docs/design/plan-format.md, section 7) as users meet it:
// - a link the server makes opens in the real app as the same plan;
// - the MCP Apps plan viewer, driven by a minimal host that speaks the postMessage protocol;
// - the /mcp endpoint over HTTP, when the target serves it (`wrangler dev` or a preview, through
//   E2E_BASE_URL; `astro preview` has no Worker).

const VIEWER = fs.readFileSync(new URL('../worker/viewer/viewer.html', import.meta.url), 'utf8');
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

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(500);
}

const storedLayout = (page: Page) =>
  page.evaluate(() => ({
    dims: JSON.parse(localStorage.getItem('room-sim-v3-dims') ?? 'null'),
    doors: JSON.parse(localStorage.getItem('room-sim-v3-doors') ?? '[]'),
    windows: JSON.parse(localStorage.getItem('room-sim-v3-windows') ?? '[]'),
    items: JSON.parse(localStorage.getItem('room-sim-v3-items') ?? '[]'),
    units: localStorage.getItem('room-sim-v3-units'),
  }));

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

  const s = await storedLayout(page);
  // (The app keeps the visitor's own display unit; the link's lengths are converted to feet.)
  expect(s.dims).toMatchObject({ width: 11, height: 12 });
  // The door is on the bottom wall, 90 in from the bottom-right corner: 10 in from the left.
  expect(s.doors).toEqual([
    expect.objectContaining({
      wall: 'bottom',
      width: 32 / 12,
      position: 10 / 12,
      type: 'swing-in',
    }),
  ]);
  expect(s.windows).toEqual([expect.objectContaining({ wall: 'top', width: 4, position: 3.5 })]);
  const items = s.items.map((i: Record<string, number | string>) => ({
    label: i.label,
    x: +(+i.x * 12).toFixed(3),
    y: +(+i.y * 12).toFixed(3),
    width: +(+i.width * 12).toFixed(3),
    height: +(+i.height * 12).toFixed(3),
  }));
  expect(items).toEqual(
    bedroom.items.map((i) => ({
      label: i.label,
      x: i.placement.x - i.width / 2,
      y: i.placement.y - i.depth / 2,
      width: i.width,
      height: i.depth,
    })),
  );
  // The app shows the same problems the server reported (the desk and the chair overlap).
  await expect(page.getByText(/Overlapping/).first()).toBeVisible();
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
  ...(o.view ? { _meta: { [VIEW_META_KEY]: o.view } } : {}),
});

/**
 * A minimal MCP Apps host: an iframe with the viewer that answers `ui/initialize`, sends the
 * tool result after `ui/notifications/initialized`, and records what the view asks for.
 */
async function host(
  page: Page,
  result: unknown,
  { theme = 'light', width = 720 }: { theme?: 'light' | 'dark'; width?: number } = {},
) {
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:16px;background:${theme === 'dark' ? '#0b1120' : '#f1f5f9'}">` +
      `<iframe id="view" title="Room Planner plan" sandbox="allow-scripts" style="border:0;width:min(${width}px,calc(100vw - 32px));height:400px;display:block"></iframe>` +
      `</body></html>`,
  );
  await page.evaluate(
    ({ html, result, theme }) => {
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
          frame.style.height = `${msg.params.height}px`;
        } else if (msg.method === 'ui/open-link') {
          reply({ result: {} });
        }
      });
      frame.srcdoc = html;
    },
    { html: VIEWER, result, theme },
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
    await first.click();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(view.locator('g[data-id="desk"]')).toHaveClass(/focus/);
    await expect(view.locator('g[data-id="bed"]')).not.toHaveClass(/focus/);

    await view.getByRole('button', { name: 'Open in Room Planner' }).click();
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

  test('shows the text result when the host passes no drawing, and errors as text', async ({
    page,
    baseURL,
  }) => {
    const outcome = await createPlan({ plan: bedroom }, new URL(baseURL!).origin);
    const { _meta: _, ...bare } = toResult(outcome);
    const view = await host(page, bare);
    await expect(view.locator('#sheet')).toBeHidden();
    await expect(view.locator('#summary')).toContainText('132 in × 144 in');
    await expect(view.locator('#note')).toContainText('did not pass the drawing');
    await expect(view.getByRole('button', { name: 'Open in Room Planner' })).toBeVisible();

    const bad = await createPlan({ plan: { version: 4, unit: 'yd' } }, 'https://x.test');
    const errorView = await host(page, toResult(bad));
    await expect(errorView.locator('#summary')).toContainText('The plan is not valid');
    await expect(errorView.getByRole('button', { name: 'Open in Room Planner' })).toBeHidden();
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
    }
  });
});

// --- /mcp over HTTP (wrangler dev or a preview) ----------------------------------------------------

test.describe('the /mcp endpoint', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ request, browserName }) => {
    test.skip(browserName !== 'chromium', 'HTTP only: one engine is enough');
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

  // Last: it uses up this address's allowance for a minute.
  test('rate limits a burst with 429 and Retry-After', async ({ request }) => {
    test.slow();
    const statuses: number[] = [];
    let retryAfter: string | undefined;
    for (let round = 0; round < 6 && !statuses.includes(429); round++) {
      const batch = await Promise.all(
        Array.from({ length: 40 }, () => request.post('/mcp', rpc('ping'))),
      );
      for (const r of batch) {
        statuses.push(r.status());
        if (r.status() === 429) retryAfter = r.headers()['retry-after'];
      }
    }
    expect(statuses).toContain(429);
    expect(retryAfter).toBe('60');
  });
});
