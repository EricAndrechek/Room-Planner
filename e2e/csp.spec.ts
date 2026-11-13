import { expect, test } from '@playwright/test';
import { isProblem } from './problems';

// Only meaningful against a server that applies public/_headers (e.g. `wrangler dev`):
//   E2E_BASE_URL=http://localhost:8787 pnpm test:e2e
test.skip(!process.env.E2E_BASE_URL, 'needs E2E_BASE_URL (a server that serves _headers)');
// WebKit (unlike Chromium/Firefox) does not exempt http://localhost from `upgrade-insecure-requests`,
// so it upgrades every subresource to https and fails with TLS errors. Real https hosts are fine.
test.skip(
  ({ browserName, baseURL }) => browserName === 'webkit' && !baseURL?.startsWith('https:'),
  'WebKit upgrades http://localhost subresources to https (upgrade-insecure-requests)',
);

test('pages load without CSP violations or console errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (isProblem(m)) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  for (const path of ['/', '/help/']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(problems).toEqual([]);
});

test('no inline script runs without a hash: PostHog (debug opt-in) loads and the service worker registers', async ({
  page,
}) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (isProblem(m)) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  const res = await page.request.get('/');
  const csp = res.headers()['content-security-policy'] ?? '';
  const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).toContain("'sha256-");

  await page.addInitScript(() => localStorage.setItem('rp:analytics-debug', '1'));
  await page.goto('/');
  await page.waitForSelector('html[data-planner-ready]');
  // The snippet's inline script ran under its hash: it replaced the stub with the real SDK once
  // array.js loaded (skipped if the network blocks PostHog).
  const sdk = await page
    .waitForFunction(
      () => typeof (window as unknown as { posthog?: { capture?: unknown } }).posthog?.capture,
      undefined,
      { timeout: 8000 },
    )
    .then(() => true);
  expect(sdk).toBe(true);
  const loaded = await page
    .waitForFunction(
      () => (window as unknown as { posthog?: { __loaded?: boolean } }).posthog?.__loaded === true,
      undefined,
      {
        timeout: 8000,
      },
    )
    .then(() => true)
    .catch(() => false);
  test.info().annotations.push({ type: 'posthog-sdk-loaded', description: String(loaded) });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1500);
  expect(problems).toEqual([]);
});
