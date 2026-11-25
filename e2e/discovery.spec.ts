import { createHash } from 'node:crypto';
import { Validator } from '@seriousme/openapi-schema-validator';
import { expect, test, type APIRequestContext } from '@playwright/test';
import Ajv2020 from 'ajv/dist/2020.js';
import { PATHS, SKILL, markdownPath, registry as server } from '../scripts/discovery.mjs';

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

/** A Markdown twin: the `agent:` front matter (Search for Agents), then the page's `#` heading. */
const FRONT_MATTER = /^---\nagent:\n( {2}\w+: "[^"\n]*"\n){4}---\n\n# /;

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
  // ARD's Agentmap directive (crawlers ignore it) names the AI catalog.
  expect(text).toMatch(new RegExp(`^Agentmap: ${site}${PATHS.ard}$`, 'm'));
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
    // Front matter first: the Search for Agents pointers, then the page.
    expect(text, md).toMatch(FRONT_MATTER);
    expect(text, md).toContain(`  endpoint: "${site}${PATHS.search}?q={query}"`);
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

const sha256 = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('the AI catalog (ai-catalog.json and ard.json) lists ARD entries for the server, API and skill', async ({
  request,
}) => {
  const r = await request.get(PATHS.aiCatalog);
  expect(r.status()).toBe(200);
  expectHeaders(r, /^application\/ai-catalog\+json/);
  const text = await r.text();
  // One document at both paths: the AI Catalog's well-known URI and ARD's (v0.91).
  const ard = await request.get(PATHS.ard);
  expect(ard.status()).toBe(200);
  expectHeaders(ard, /^application\/ai-catalog\+json/);
  expect(await ard.text()).toBe(text);
  const catalog = JSON.parse(text);
  const host = new URL(site).hostname;
  expect(catalog.specVersion).toBe('0.9');
  expect(catalog.host).toMatchObject({ displayName: server.title, identifier: host });
  const entries = catalog.entries as Record<string, unknown>[];
  expect(entries.map((e) => e.identifier)).toEqual(
    ['mcp', 'api', 'skill'].map((kind) => `urn:air:${host}:room-planner:${kind}`),
  );
  for (const e of entries) {
    expect(typeof e.displayName).toBe('string');
    expect(typeof e.type).toBe('string');
    expect('url' in e !== 'data' in e, String(e.identifier)).toBe(true); // exactly one
    const queries = e.representativeQueries as string[];
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.length).toBeLessThanOrEqual(5);
  }
  const byType = Object.fromEntries(entries.map((e) => [e.type, e]));
  expect(byType['application/mcp-server-card+json']!.url).toBe(`${site}${PATHS.serverCard}`);
  expect(byType['application/openapi+json']!.url).toBe(`${site}${PATHS.openapi}`);
  const skill = byType['application/agent-skills+md']!;
  expect(skill.url).toBe(`${site}${PATHS.skill}`);
  expect(skill.digest).toBe(sha256(await (await get(request, skill.url as string)).body()));
});

test('the server card agrees with server.json, at /mcp/server-card and /.well-known/mcp/', async ({
  request,
}) => {
  // The static copy, for scanners that look under /.well-known/, names the canonical site.
  const r = await request.get(PATHS.serverCardWellKnown);
  expect(r.status()).toBe(200);
  expectHeaders(r, /^application\/mcp-server-card\+json/);
  const card = await r.json();
  expect(card.$schema).toBe(
    'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
  );
  expect(card.name).toBe(server.name);
  expect(card.version).toBe(server.version);
  expect(card.remotes).toHaveLength(1);
  expect(card.remotes[0].url).toBe(`${site}${PATHS.mcp}`);
  // No credentials asked for: the card format's way of saying "no authentication".
  expect(card.remotes[0].headers).toBeUndefined();
  test.skip(!worker, 'The server card at /mcp/server-card needs the Worker');
  const live = await request.get(PATHS.serverCard);
  expectHeaders(live, /^application\/mcp-server-card\+json/);
  const liveCard = await live.json();
  expect(liveCard.remotes[0].url).toBe(`${new URL(live.url()).origin}${PATHS.mcp}`);
  // The same card apart from the origin it names.
  expect({ ...liveCard, remotes: [] }).toEqual({ ...card, remotes: [] });
  expect(liveCard.remotes[0].supportedProtocolVersions).toEqual(
    card.remotes[0].supportedProtocolVersions,
  );
});

test('the Agent Skills index (RFC v0.2.0) lists the room-planner skill with its digest', async ({
  request,
}) => {
  const r = await request.get(PATHS.agentSkills);
  expect(r.status()).toBe(200);
  expectHeaders(r, /^application\/json/);
  const index = await r.json();
  expect(index.$schema).toBe('https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  expect(index.skills).toHaveLength(1);
  const [entry] = index.skills;
  expect(entry).toMatchObject({ name: SKILL.name, type: 'skill-md', url: PATHS.skill });
  expect(entry.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  expect(entry.description.length).toBeLessThanOrEqual(1024);
  const md = await request.get(new URL(entry.url, r.url()).pathname);
  expect(md.status()).toBe(200);
  expectHeaders(md, /^text\/markdown/);
  const bytes = await md.body();
  expect(entry.digest).toBe(sha256(bytes));
  // SKILL.md: YAML front matter with the same name and description, then the instructions.
  const text = bytes.toString('utf8');
  const front = /^---\nname: (.+)\ndescription: (.+)\n---\n\n# /.exec(text);
  expect(front, 'front matter').not.toBeNull();
  expect(front![1]).toBe(entry.name);
  expect(JSON.parse(front![2]!)).toBe(entry.description);
  for (const s of ['#s=', '#p=', PATHS.mcp, '/api/plan/link', 'link text', 'y grows DOWN']) {
    expect(text).toContain(s);
  }
  expect(text.length).toBeLessThan(20_000); // about 5k tokens at most, per agentskills.io
});

test('poppy.json (Personal Agent Protocol 1.0) names this site, with no sign-in', async ({
  request,
}) => {
  const r = await request.get(PATHS.poppy);
  expect(r.status()).toBe(200);
  expectHeaders(r, /^application\/json/);
  const doc = await r.json();
  expect(doc.protocol_version).toBe('1.0');
  expect(doc.organization.domain).toBe(new URL(site).host);
  expect(doc.auth).toBeUndefined();
  expect(doc.web).toEqual({});
  expect(doc.apis.map((a: { type: string; url: string }) => [a.type, a.url])).toEqual([
    ['mcp', `${site}${PATHS.mcp}`],
    ['openapi', `${site}${PATHS.openapi}`],
  ]);
});

test('there is no OAuth metadata: the server and the API need no sign-in', async ({ request }) => {
  // A 200 here (even the HTML 404 page served as 200) would tell MCP clients to sign in.
  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
    '/auth.md',
  ]) {
    const r = await request.get(path);
    expect(r.status(), path).toBe(404);
  }
});

test('Search for Agents: every page names /.well-known/search, which answers in Markdown', async ({
  request,
  page,
}) => {
  await page.goto('/faq/');
  const meta = (name: string) => page.locator(`head meta[name="agent:${name}"]`);
  await expect(meta('endpoint')).toHaveAttribute('content', `${site}${PATHS.search}?q={query}`);
  await expect(meta('method')).toHaveAttribute('content', 'GET');
  await expect(meta('instructions')).toHaveAttribute('content', /search API/);
  test.skip(!worker, 'The search endpoint is the Worker');
  const r = await request.get(`${PATHS.search}?q=${encodeURIComponent('queen bed size')}`);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toMatch(/^text\/markdown/);
  expect(r.headers()['accept-query']).toContain('text/plain');
  expect(r.headers()['access-control-allow-origin']).toBe('*');
  const text = await r.text();
  expect(text).toMatch(/^# Search results for: "queen bed size"\n/);
  expect(text).toContain(`](${site}/guides/bedroom-layout/) (score: `);
  // QUERY with a JSON body, as Cloudflare's endpoint takes it.
  const q = await request.fetch(PATHS.search, {
    method: 'QUERY',
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify({ q: 'is it free' }),
  });
  expect(q.status()).toBe(200);
  expect(await q.text()).toMatch(/^# Search results for: "is it free"\n/);
  // No query: an error in Markdown, not an HTML page.
  const none = await request.get(PATHS.search);
  expect(none.status()).toBe(400);
  expect(none.headers()['content-type']).toMatch(/^text\/markdown/);
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
    await expect(head.locator('link[rel="ard"]')).toHaveAttribute('href', PATHS.ard);
    await expect(head.locator('link[rel="ai-catalog"]')).toHaveAttribute('href', PATHS.aiCatalog);
    await expect(head.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute(
      'href',
      md,
    );
    if (worker) {
      const link = (await request.get(path)).headers()['link'] ?? '';
      expect(link).toContain(`<${PATHS.openapi}>; rel="service-desc"`);
      expect(link).toContain(`<${PATHS.apiCatalog}>; rel="api-catalog"`);
      expect(link).toContain(`<${md}>; rel="alternate"; type="text/markdown"`);
      expect(link).toContain(`<${PATHS.ard}>; rel="ard"`);
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
  expect(await md.text()).toMatch(FRONT_MATTER);
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
        if (/^\/\.well-known\/|^\/search-index\.json$|\.md$/.test(path)) out.push([path, '']);
        else if (path.endsWith('/') || path.endsWith('.html')) {
          out.push([path, (await cache.match(req))!.headers.get('content-type') ?? '']);
        }
      }
    }
    return out;
  });
  // Neither Markdown nor any discovery file (the catalogs, the skill, the search index).
  expect(pages.filter(([, type]) => !type).map(([p]) => p)).toEqual([]);
  expect(pages.length).toBeGreaterThan(3);
  for (const [path, type] of pages) expect(type, path).toMatch(/^text\/html/);
});
