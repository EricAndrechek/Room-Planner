import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

/**
 * Legacy-domain bridge, end to end. Needs two running servers on different origins:
 *
 *   pnpm build
 *   pnpm exec wrangler dev --port 8787                                   # new origin  http://localhost:8787
 *   pnpm exec wrangler dev -c legacy/wrangler.jsonc --port 8788 \
 *       --var TARGET_ORIGIN:http://localhost:8787                        # old origin  http://127.0.0.1:8788
 *   E2E_BASE_URL=http://localhost:8787 E2E_LEGACY_URL=http://127.0.0.1:8788 pnpm exec playwright test migrate
 *
 * Skipped unless both E2E_BASE_URL and E2E_LEGACY_URL are set.
 */
const NEW = process.env.E2E_BASE_URL;
const OLD = process.env.E2E_LEGACY_URL;
test.skip(!NEW || !OLD, 'set E2E_BASE_URL and E2E_LEGACY_URL (see the header of this file)');

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(new URL(`../src/lib/__fixtures__/${name}`, import.meta.url), 'utf8'));

const original: Record<string, string> = fixture('original-storage.json').localStorage;
const links = fixture('original-share-links.json');
const ftInConfig = links.ftIn.json;

const UNICODE_NAME = 'Schlafzimmer 寝室 🛏️ — Café';
const BASE_PROJECTS: { id: string; name: string; updatedAt: string; data: unknown }[] = JSON.parse(
  original['room-planner-projects']!,
);
const seedStorage = (extraProjects: object[] = []): Record<string, string> => ({
  ...original,
  'room-planner-projects': JSON.stringify([...BASE_PROJECTS, ...extraProjects]),
  'rp:analytics-debug': '0',
});
const unicodeProject = {
  id: 'project-1-unicode',
  name: UNICODE_NAME,
  data: BASE_PROJECTS[0]!.data,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

/** Put `data` into localStorage of the origin of `origin` (a blank page is served for the seed URL only). */
async function seed(page: Page, origin: string, data: Record<string, string>) {
  const url = `${origin}/__seed`;
  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>seed</title>' }),
  );
  await page.goto(url);
  await page.evaluate((d) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
  }, data);
  await page.unroute(url);
}

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

const projectsOf = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('room-planner-projects') ?? '[]'));

const b64url = (b: Buffer) => b.toString('base64url');
const shareHash = (config: object) =>
  `#s=${b64url(zlib.deflateRawSync(Buffer.from(JSON.stringify(config), 'utf8')))}`;

/** Navigations to the new origin must never leave migration data in the address bar. */
const watchFragments = (page: Page) => {
  const seen: string[] = [];
  page.on('framenavigated', (f) => f === page.mainFrame() && seen.push(f.url()));
  return seen;
};

test('saved projects and the current layout arrive on the new origin, hash cleaned', async ({
  page,
}) => {
  await seed(page, OLD!, seedStorage([unicodeProject]));
  await page.goto(`${OLD}/`);
  await page.waitForURL(`${NEW}/`);
  await ready(page);

  expect(page.url()).toBe(`${NEW}/`);
  expect(new URL(page.url()).hash).toBe('');

  const projects = await projectsOf(page);
  expect(projects.map((p: { name: string }) => p.name)).toEqual(['Café Plan', UNICODE_NAME]);
  expect(projects[0]).toEqual(BASE_PROJECTS[0]);
  expect(projects[1]).toEqual(unicodeProject);

  // Same current layout and settings, verbatim.
  for (const key of [
    'room-sim-v3-dims',
    'room-sim-v3-doors',
    'room-sim-v3-windows',
    'room-sim-v3-units',
    'room-sim-v3-mode',
    'room-sim-v3-currentProject',
  ]) {
    expect(await page.evaluate((k) => localStorage.getItem(k), key), key).toBe(original[key]);
  }
  await expect(page.getByRole('heading', { name: 'Café Plan' })).toBeVisible();

  // The old origin is left untouched (a safety net / rollback).
});

test('a legacy ?config= link opens correctly and the data still migrates', async ({ page }) => {
  const config = { ...ftInConfig, name: 'Café Gäste', roomDims: { width: 21, height: 9 } };
  const legacyParam = Buffer.from(JSON.stringify(config), 'latin1').toString('base64');
  await seed(page, OLD!, seedStorage());
  await page.goto(`${OLD}/?config=${encodeURIComponent(legacyParam)}`);
  await page.waitForURL(`${NEW}/**`);
  await ready(page);

  await expect(page.getByRole('heading', { name: 'Café Gäste' })).toBeVisible();
  const names = (await projectsOf(page)).map((p: { name: string }) => p.name);
  expect(names).toEqual(['Café Plan', 'Café Gäste']);
  expect(page.url()).not.toContain('rp-migrate');
});

test('a #s= share link opens correctly and the data still migrates', async ({ page }) => {
  const config = { ...ftInConfig, name: UNICODE_NAME, roomDims: { width: 18, height: 7 } };
  await seed(page, OLD!, seedStorage());
  await page.goto(`${OLD}/${shareHash(config)}`);
  await page.waitForURL(`${NEW}/**`);
  await ready(page);

  await expect(page.getByRole('heading', { name: UNICODE_NAME })).toBeVisible();
  const names = (await projectsOf(page)).map((p: { name: string }) => p.name);
  expect(names).toEqual(['Café Plan', UNICODE_NAME]);
  expect(page.url()).not.toContain('#s=');
  expect(page.url()).not.toContain('rp-migrate');
});

test('a share link from an empty old origin still opens (no migration payload)', async ({
  page,
}) => {
  const seen = watchFragments(page);
  const config = { ...ftInConfig, name: 'Only shared', roomDims: { width: 12, height: 12 } };
  await page.goto(`${OLD}/${shareHash(config)}`);
  await page.waitForURL(`${NEW}/**`);
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Only shared' })).toBeVisible();
  expect(seen.some((u) => u.includes('rp-migrate'))).toBe(false);
});

test('an empty old origin redirects without a migration payload', async ({ page }) => {
  const seen = watchFragments(page);
  await page.goto(`${OLD}/help/`);
  await page.waitForURL(`${NEW}/help/`);
  expect(seen.some((u) => u.includes('rp-migrate'))).toBe(false);
  expect(new URL(page.url()).hash).toBe('');
});

test('merging into a target that already has a newer copy keeps the newer copy', async ({
  page,
}) => {
  const newerHere = {
    ...BASE_PROJECTS[0]!,
    name: 'Café Plan (edited on the new site)',
    updatedAt: '2099-01-01T00:00:00.000Z',
  };
  const olderHere = {
    ...unicodeProject,
    name: 'older here',
    updatedAt: '2000-01-01T00:00:00.000Z',
  };
  await seed(page, NEW!, {
    'room-planner-projects': JSON.stringify([newerHere, olderHere]),
    'room-sim-v3-units': 'm',
  });
  await seed(
    page,
    OLD!,
    seedStorage([{ ...unicodeProject, name: UNICODE_NAME + ' (newer there)' }]),
  );
  await page.goto(`${OLD}/`);
  await page.waitForURL(`${NEW}/`);
  await ready(page);

  const projects: { id: string; name: string }[] = await projectsOf(page);
  expect(projects.map((p) => [p.id, p.name])).toEqual([
    [newerHere.id, newerHere.name],
    [unicodeProject.id, UNICODE_NAME + ' (newer there)'],
  ]);
  // Settings already present here are not overwritten.
  expect(await page.evaluate(() => localStorage.getItem('room-sim-v3-units'))).toBe('m');
});

test('crawlers get a 301 to the same path on the new origin', async ({ request }) => {
  for (const ua of ['Googlebot/2.1', 'Mozilla/5.0 (compatible; bingbot/2.0)']) {
    const res = await request.get(`${OLD}/help/?x=1`, {
      headers: { 'user-agent': ua },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(301);
    expect(res.headers()['location']).toBe(`${NEW}/help/?x=1`);
  }
  const asset = await request.get(`${OLD}/_astro/x.js`, { maxRedirects: 0 });
  expect(asset.status()).toBe(301);
});

test('/sw.js is the kill switch and the bridge is uncached and noindex', async ({ request }) => {
  const sw = await request.get(`${OLD}/sw.js`, { maxRedirects: 0 });
  expect(sw.status()).toBe(200);
  expect(sw.headers()['cache-control']).toBe('no-store');
  expect(await sw.text()).toContain('registration.unregister()');
  const page = await request.get(`${OLD}/`, {
    headers: { 'sec-fetch-dest': 'document', accept: 'text/html' },
    maxRedirects: 0,
  });
  expect(page.status()).toBe(200);
  expect(page.headers()['cache-control']).toBe('no-store');
  expect(await page.text()).toContain('noindex');
});

// --- the old PWA service worker ------------------------------------------------------------------

/**
 * A stand-in for the legacy hostname that can change what it serves at runtime: first the REAL built
 * app (with its precaching service worker, exactly what visitors from the last day have installed),
 * then - after `switchToBridge()` - the legacy Worker (proxied), the way the real hostname changes
 * when the legacy Worker takes over the custom domain.
 */
async function startSwitchableOrigin() {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  };
  let bridge = false;
  const server = http.createServer((req, res) => {
    if (bridge) {
      const up = http.request(
        OLD!,
        {
          method: req.method,
          path: req.url,
          headers: { ...req.headers, host: new URL(OLD!).host },
        },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      );
      up.on('error', () => res.writeHead(502).end());
      req.pipe(up);
      return;
    }
    const url = new URL(req.url ?? '/', 'http://x');
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  return {
    origin: `http://127.0.0.1:${port}`,
    switchToBridge: () => void (bridge = true),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test('a visitor with the old PWA installed is moved to the new origin by the kill switch', async ({
  page,
}) => {
  test.skip(!fs.existsSync('dist/sw.js'), 'needs a built app (pnpm build)');
  const legacy = await startSwitchableOrigin();
  try {
    // 1. The old site: real app, service worker installed and controlling, some saved data.
    await seed(page, legacy.origin, {});
    await page.goto(`${legacy.origin}/`);
    await ready(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 })
      .toBe(true);
    await page.evaluate(
      (d) => {
        for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
      },
      seedStorage([unicodeProject]),
    );
    expect((await page.evaluate(() => caches.keys())).length).toBeGreaterThan(0);

    // 2. The hostname now belongs to the legacy Worker. The visitor comes back.
    legacy.switchToBridge();
    await page.goto(`${legacy.origin}/`);

    // 3. The old service worker serves the cached app once; its update check fetches the kill
    //    switch, which unregisters it and reloads the tab into the bridge -> new origin.
    await page.waitForURL(`${NEW}/**`, { timeout: 30_000 });
    await ready(page);
    const names = (await projectsOf(page)).map((p: { name: string }) => p.name);
    expect(names).toEqual(['Café Plan', UNICODE_NAME]);
    expect(new URL(page.url()).hash).toBe('');
  } finally {
    await legacy.close();
  }
});
