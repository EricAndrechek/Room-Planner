import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { isProblem } from './problems';
import fs from 'node:fs';

// Service workers and offline mode are Chromium features; this runs against `astro preview`
// by default and against `wrangler dev` (which applies public/_headers) via E2E_BASE_URL.

const legacyLink: string = JSON.parse(
  fs.readFileSync(
    new URL('../src/lib/__fixtures__/original-share-links.json', import.meta.url),
    'utf8',
  ),
).ftIn.url;

async function ready(page: Page) {
  await page.waitForSelector('html[data-planner-ready]');
  await page.waitForTimeout(700);
}

/** Resolve once the service worker is active AND controls this page (precache is complete by then). */
async function controlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 })
    .toBe(true);
}

function watchProblems(context: BrowserContext, problems: string[]) {
  context.on('console', (m) => {
    if (isProblem(m)) problems.push(m.text());
  });
  context.on('weberror', (e) => problems.push(String(e.error())));
}

test('manifest is valid and the app is installable', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Page.getAppManifest / installability need CDP (Chromium)');
  await page.goto('/');
  await ready(page);
  await controlled(page);
  const cdp = await page.context().newCDPSession(page);
  const { url, errors, data } = await cdp.send('Page.getAppManifest');
  expect(url).toMatch(/\/manifest\.webmanifest$/);
  expect(errors).toEqual([]);
  const manifest = JSON.parse(data!);
  expect(manifest).toMatchObject({
    id: '/',
    name: 'Room Planner',
    short_name: 'Room Planner',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#4f46e5',
    background_color: '#f8fafc',
  });
  expect(
    manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`),
  ).toEqual(expect.arrayContaining(['192x192/any', '512x512/any', '512x512/maskable']));
  expect(manifest.screenshots.map((s: { form_factor: string }) => s.form_factor).sort()).toEqual([
    'narrow',
    'wide',
  ]);
  const installability = await cdp.send('Page.getInstallabilityErrors');
  expect(installability.installabilityErrors).toEqual([]);
  for (const path of ['/manifest.webmanifest', '/pwa-512x512.png', '/screenshots/wide.webp']) {
    expect((await page.request.get(path)).ok()).toBe(true);
  }
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
});

test('the whole app works offline', async ({ page, context, isMobile }) => {
  test.skip(
    isMobile,
    'drives the desktop sidebar tabs; the service worker is the same engine path',
  );
  test.slow(); // WebKit/Firefox service workers are slower to install under load
  const problems: string[] = [];
  watchProblems(context, problems);

  await page.goto('/');
  await ready(page);
  await controlled(page);

  // A project name + a share link, created while online.
  await page.getByTitle('Click to rename').click();
  await page.getByLabel('Floor plan name').fill('Offline plan');
  await page.getByLabel('Floor plan name').press('Enter');
  await page.getByRole('button', { name: 'Share and save layout' }).click();
  // The link is compressed asynchronously; wait for it before reading.
  await expect(page.locator('#share-url')).toHaveValue(/#s=/);
  const shareUrl = await page.locator('#share-url').inputValue();
  await page.getByLabel('Close modal').click();

  // The service worker never precaches PostHog (cross-origin, no runtimeCaching).
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys())
        urls.push(new URL(req.url).pathname);
    return urls;
  });
  expect(cached.length).toBeGreaterThan(8);
  expect(cached.filter((u) => /og-image|screenshots|\.map$/.test(u))).toEqual([]);
  expect(cached).toEqual(expect.arrayContaining(['/', '/help/', '/manifest.webmanifest']));

  await context.setOffline(true);

  // Reload `/` and use the planner.
  await page.reload();
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Offline plan' })).toBeVisible();
  await page.getByRole('button', { name: '2. Furniture' }).click();
  await page.getByRole('button', { name: 'Add new furniture item' }).click();
  await expect(page.getByRole('button', { name: /^New Item,/ })).toBeVisible();
  await expect(page.getByTestId('save-status')).toContainText('Saved');

  // /help/ loads offline.
  await page.goto('/help/');
  await expect(
    page.getByRole('heading', { name: /Help & FAQ|Getting started/ }).first(),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Install & offline' })).toBeVisible();

  // A legacy ?config= link loads offline into the planner.
  expect(legacyLink).toContain('?config=');
  await page.goto('/' + legacyLink.slice(legacyLink.indexOf('?')));
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Café Plan' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');

  // A #s= share link loads offline.
  await page.goto('/');
  await page.goto(shareUrl);
  await page.reload();
  await ready(page);
  await expect(page.getByTestId('room')).toBeVisible();

  // (The failed offline navigation below legitimately logs a network error; check before it.)
  expect(problems).toEqual([]);

  // Unknown URLs are not answered with the app shell.
  await page.goto('about:blank'); // WebKit keeps the old page when an offline navigation fails
  await page.goto('/definitely-not-a-page/').catch(() => {});
  await expect(page.getByTestId('room')).toHaveCount(0);

  await context.setOffline(false);
});

test('install button appears on beforeinstallprompt and hides once installed', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'on narrow layouts the install button lives in the collapsed sidebar sheet');
  await page.goto('/');
  await ready(page);
  await expect(page.getByRole('button', { name: 'Install app' })).toHaveCount(0);
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(e, {
      prompt: () => {
        (window as unknown as { __prompted: boolean }).__prompted = true;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(e);
  });
  const button = page.getByRole('button', { name: 'Install app' });
  await expect(button).toBeVisible();
  await button.click();
  expect(
    await page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted),
  ).toBe(true);
  await expect(button).toHaveCount(0);
});

test('asks for persistent storage once, after the first save', async ({ page, isMobile }) => {
  test.skip(isMobile, 'drives the desktop sidebar tabs');
  await page.addInitScript(() => {
    (window as unknown as { __persistCalls: number }).__persistCalls = 0;
    // Patch the prototype: WebKit hands out per-access wrappers / ignores instance assignment.
    const storage = Object.getPrototypeOf(navigator.storage);
    Object.defineProperty(storage, 'persist', {
      configurable: true,
      value: () => {
        (window as unknown as { __persistCalls: number }).__persistCalls++;
        return Promise.resolve(true);
      },
    });
    Object.defineProperty(storage, 'persisted', {
      configurable: true,
      value: () => Promise.resolve(false),
    });
  });
  await page.goto('/');
  await ready(page);
  // The first autosave of a new visitor's plan is the first successful save.
  const calls = () =>
    page.evaluate(() => (window as unknown as { __persistCalls: number }).__persistCalls);
  await expect.poll(calls).toBe(1);
  await page.getByRole('button', { name: '2. Furniture' }).click();
  await page.getByRole('button', { name: 'Add new furniture item' }).click();
  await expect(page.getByTestId('save-status')).toContainText('Saved');
  expect(await calls()).toBe(1);
});
