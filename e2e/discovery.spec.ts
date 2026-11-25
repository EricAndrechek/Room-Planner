import { Validator } from '@seriousme/openapi-schema-validator';
import { expect, test, type APIRequestContext } from '@playwright/test';
import Ajv2020 from 'ajv/dist/2020.js';
import { PATHS, markdownPath, registry as server } from '../scripts/discovery.mjs';

// Discovery for agents (docs/DEPLOY.md, "Discovery for agents"): every file an agent or crawler
// may look for, fetched from the server under test, parsed, and checked against each other, so
// the URLs and the version agree everywhere. Headers (content types, CORS, Link) are only checked
// where `public/_headers` applies: a Worker (`wrangler dev` or a preview, via E2E_BASE_URL), not
// `astro preview`. The links in the files name the canonical site; they are fetched here.

test.describe.configure({ mode: 'serial' });

let site = ''; // the canonical origin the files name, from robots.txt
let worker = false; // whether _headers apply (a Worker serves /mcp/server-card)

/** A URL the files name, on the server under test. */
const local = (url: string) => {
  const u = new URL(url, site);
  return `${u.pathname}${u.search}`;
};

const get = (request: APIRequestContext, url: string) => request.get(local(url));

test.beforeAll(async ({ request }) => {
  const robots = await (await request.get('/robots.txt')).text();
  site = new URL(/^Sitemap: (\S+)$/m.exec(robots)![1]!).origin;
  worker = (await request.get(PATHS.serverCard)).status() === 200;
});

test.beforeEach(() => {
  // HTTP only: one project per run is enough. Chromium locally and in CI; Firefox in the
  // cross-browser run, which has no Chromium and is the one that targets a preview.
  test.skip(
    !['chromium', 'firefox'].includes(test.info().project.name),
    'HTTP only: one project is enough',
  );
});

const expectHeaders = (
  r: { headers(): Record<string, string> },
  type: RegExp,
  { cors = true }: { cors?: boolean } = {},
) => {
  if (!worker) return;
  expect(r.headers()['content-type']).toMatch(type);
  if (cors) expect(r.headers()['access-control-allow-origin']).toBe('*');
};

test('robots.txt allows everything and names the sitemap', async ({ request }) => {
  const r = await request.get('/robots.txt');
  expect(r.status()).toBe(200);
  expectHeaders(r, /^text\/plain/);
  const text = await r.text();
  expect(text).toMatch(/^User-agent: \*$/m);
  expect(text).toMatch(/^Allow: \/$/m);
  expect(text).toMatch(/^Content-Signal: search=yes, ai-input=yes, ai-train=yes$/m);
  expect(text).not.toMatch(/^Disallow:/im);
  expect(text).toContain(`${site}/sitemap-index.xml`);
});

test('the sitemap lists every public page with a lastmod, and nothing else', async ({
  request,
}) => {
  const index = await (await request.get('/sitemap-index.xml')).text();
  const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
  const locs: string[] = [];
  for (const map of maps) {
    const xml = await (await get(request, map)).text();
    for (const u of xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)) {
      expect(Number.isNaN(Date.parse(u[2]!))).toBe(false);
      locs.push(new URL(u[1]!).pathname);
    }
  }
  for (const page of [
    '/',
    '/help/',
    '/faq/',
    '/guides/',
    '/agents/',
    '/privacy/',
    '/support/',
    '/terms/',
  ]) {
    expect(locs).toContain(page);
  }
  expect(locs.filter((p) => p.startsWith('/guides/')).length).toBeGreaterThan(1);
  expect(locs.filter((p) => /\.(json|md|txt)$|^\/api\/|^\/mcp/.test(p))).toEqual([]);
});

test('llms.txt follows llmstxt.org, and every link in it resolves', async ({ request }) => {
  const r = await request.get(PATHS.llms);
  expect(r.status()).toBe(200);
  expectHeaders(r, /^text\/plain/);
  const text = await r.text();
  expect(text).toMatch(/^# Room Planner\n\n> /);
  expect(text).toContain('## Use Room Planner from an agent');
  const links = [...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]!);
  const ours = [...new Set(links.filter((l) => new URL(l).origin === site))];
  expect(ours.length).toBeGreaterThan(15);
  for (const href of [
    PATHS.mcp,
    PATHS.serverCard,
    PATHS.openapi,
    PATHS.planSchema,
    PATHS.apiCatalog,
    PATHS.aiCatalog,
    '/agents.md',
  ]) {
    expect(ours).toContain(`${site}${href}`);
  }
  for (const href of ours) {
    if (href === `${site}${PATHS.mcp}`) continue; // POST only
    // The Worker's routes, and an extension-less asset `astro preview` does not serve.
    if (!worker && /^\/mcp\/|^\/\.well-known\/api-catalog$/.test(new URL(href).pathname)) continue;
    const page = await get(request, href);
    expect(page.status(), href).toBe(200);
  }
});

test('llms-full.txt and the Markdown twins carry the pages, agent docs included', async ({
  request,
}) => {
  const full = await (await request.get(PATHS.llmsFull)).text();
  expect(full).toContain('## No setup: plan links');
  expect(full).toContain('```\nimport base64, json, zlib');
  for (const page of [
    '',
    'faq/',
    'help/',
    'agents/',
    'privacy/',
    'support/',
    'terms/',
    'guides/',
    'guides/bedroom-layout/',
  ]) {
    const md = markdownPath(page)!;
    const r = await request.get(md);
    expect(r.status(), md).toBe(200);
    expectHeaders(r, /^text\/markdown/);
    const text = await r.text();
    expect(text, md).toMatch(/^# /);
    expect(text, md).toContain(`Source: ${site}/${page}`);
  }
});

test('/openapi.json is valid OpenAPI 3.1 and names this site and version', async ({ request }) => {
  const r = await request.get(PATHS.openapi);
  expect(r.status()).toBe(200);
  expectHeaders(r, /^application\/(openapi\+)?json/);
  const spec = await r.json();
  const result = await new Validator().validate(spec);
  expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  expect(spec.servers[0].url).toBe(site);
  expect(spec.info.version).toBe(server.version);
  expect(Object.keys(spec.paths).sort()).toEqual([
    '/api/plan',
    '/api/plan/check',
    '/api/plan/link',
  ]);
});

test('/plan.schema.json compiles and validates the OpenAPI example', async ({ request }) => {
  const r = await request.get(PATHS.planSchema);
  expect(r.status()).toBe(200);
  expectHeaders(r, /^application\/(schema\+)?json/);
  const schema = await r.json();
  expect(schema.$id).toBe(`${site}${PATHS.planSchema}`);
  const spec = await (await request.get(PATHS.openapi)).json();
  const example = spec.paths['/api/plan/link'].post.requestBody.content['application/json'].example;
  const validate = new Ajv2020({ strict: false }).compile(schema);
  expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
});

test('the API catalog (RFC 9727) points at the REST API and the MCP server', async ({
  request,
}) => {
  test.skip(!worker, '`astro preview` does not serve an extension-less file');
  const r = await request.get(PATHS.apiCatalog);
  expect(r.status()).toBe(200);
  expectHeaders(r, /^application\/linkset\+json/);
  const { linkset } = (await r.json()) as {
    linkset: ({ anchor: string } & Record<string, { href: string }[] | string>)[];
  };
  const byAnchor = Object.fromEntries(linkset.map((l) => [l.anchor, l]));
  const self = byAnchor[`${site}${PATHS.apiCatalog}`]!;
  expect((self.item as { href: string }[]).map((i) => i.href).sort()).toEqual(
    [`${site}${PATHS.api}`, `${site}${PATHS.mcp}`].sort(),
  );
  const api = byAnchor[`${site}${PATHS.api}`]!;
  expect((api['service-desc'] as { href: string }[])[0]!.href).toBe(`${site}${PATHS.openapi}`);
  const mcp = byAnchor[`${site}${PATHS.mcp}`]!;
  expect((mcp['service-desc'] as { href: string }[])[0]!.href).toBe(`${site}${PATHS.serverCard}`);
  for (const l of linkset) {
    for (const [rel, v] of Object.entries(l)) {
      if (rel === 'anchor' || rel === 'item') continue;
      for (const { href } of v as { href: string }[]) {
        if (!worker && new URL(href).pathname.startsWith('/mcp/')) continue; // needs the Worker
        expect((await get(request, href)).status(), href).toBe(200);
      }
    }
  }
});

test('the AI catalog and the server card agree with server.json', async ({ request }) => {
  const catalog = await (await request.get(PATHS.aiCatalog)).json();
  const urls = (catalog.entries as { url: string }[]).map((e) => e.url);
  expect(urls).toContain(`${site}${PATHS.serverCard}`);
  expect(urls).toContain(`${site}${PATHS.openapi}`);
  test.skip(!worker, 'The server card needs the Worker');
  const r = await request.get(PATHS.serverCard);
  expectHeaders(r, /^application\/mcp-server-card\+json/);
  const card = await r.json();
  expect(card.name).toBe(server.name);
  expect(card.version).toBe(server.version);
  expect(card.remotes[0].url).toBe(`${new URL(r.url()).origin}${PATHS.mcp}`);
});

test('security.txt (RFC 9116) has a contact, a future expiry and its canonical URL', async ({
  request,
}) => {
  const r = await request.get(PATHS.security);
  expect(r.status()).toBe(200);
  expectHeaders(r, /^text\/plain/);
  const text = await r.text();
  expect(text).toMatch(/^Contact: https:\/\/github\.com\/.+$/m);
  expect(Date.parse(/^Expires: (.+)$/m.exec(text)![1]!)).toBeGreaterThan(Date.now());
  expect(text).toContain(`Canonical: ${site}${PATHS.security}`);
  expect(text).toMatch(/^Preferred-Languages: en$/m);
});

test('/ and /agents/ point at the API, the catalog and their Markdown, in HTML and headers', async ({
  request,
  page,
}) => {
  for (const [path, md] of [
    ['/', '/index.md'],
    ['/agents/', '/agents.md'],
  ] as const) {
    await page.goto(path);
    const head = page.locator('head');
    await expect(head.locator('link[rel="service-desc"]')).toHaveAttribute('href', PATHS.openapi);
    await expect(head.locator('link[rel="api-catalog"]')).toHaveAttribute('href', PATHS.apiCatalog);
    await expect(head.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute(
      'href',
      md,
    );
    if (worker) {
      const link = (await request.get(path)).headers()['link'] ?? '';
      expect(link).toContain(`<${PATHS.openapi}>; rel="service-desc"`);
      expect(link).toContain(`<${PATHS.apiCatalog}>; rel="api-catalog"`);
      expect(link).toContain(`<${md}>; rel="alternate"; type="text/markdown"`);
    }
  }
  // /agents/ describes both ways in as WebAPI nodes.
  await page.goto('/agents/');
  const graph = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((s) => s.flatMap((x) => JSON.parse(x.textContent!)['@graph'] ?? []));
  const apis = graph.filter((n: { '@type': string }) => n['@type'] === 'WebAPI');
  expect(apis.map((a: { url: string }) => new URL(a.url).pathname).sort()).toEqual([
    PATHS.api,
    PATHS.mcp,
  ]);
});

test('pages negotiate Markdown: Accept: text/markdown and LLM crawlers get the twin', async ({
  request,
}) => {
  test.skip(!worker, "Content negotiation is the Worker's");
  const md = await request.get('/agents/', { headers: { accept: 'text/markdown' } });
  expect(md.headers()['content-type']).toMatch(/^text\/markdown/);
  expect(md.headers()['vary']).toContain('Accept');
  expect(await md.text()).toMatch(/^# /);
  const bot = await request.get('/faq/', {
    headers: {
      'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0)',
    },
  });
  expect(bot.headers()['content-type']).toMatch(/^text\/markdown/);
  const html = await request.get('/faq/', { headers: { accept: 'text/html' } });
  expect(html.headers()['content-type']).toMatch(/^text\/html/);
  // The assets' own headers (_headers) survive the Worker.
  expect(html.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(html.headers()['x-content-type-options']).toBe('nosniff');
  expect(html.headers()['link']).toContain('</faq.md>; rel="alternate"; type="text/markdown"');
  // Vary: Accept only on the Markdown: on HTML the service worker's precache would never match.
  expect(html.headers()['vary'] ?? '').not.toMatch(/accept/i);
});

test('the service worker caches HTML for every page URL, never Markdown', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('html[data-planner-ready]');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 })
    .toBe(true);
  const pages = await page.evaluate(async () => {
    const out: [string, string][] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        const path = new URL(req.url).pathname;
        if (path.endsWith('/') || path.endsWith('.html')) {
          out.push([path, (await cache.match(req))!.headers.get('content-type') ?? '']);
        }
      }
    }
    return out;
  });
  expect(pages.length).toBeGreaterThan(3);
  for (const [path, type] of pages) expect(type, path).toMatch(/^text\/html/);
  expect(pages.map(([p]) => p).filter((p) => p.endsWith('.md'))).toEqual([]);
});
