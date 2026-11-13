import { expect, test } from '@playwright/test';

// Playwright sets navigator.webdriver, so analytics must stay fully off (no SDK, no network)
// regardless of host.
test('analytics stays off under automation: no PostHog requests', async ({ page }) => {
  const hits: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).hostname.endsWith('posthog.com')) hits.push(r.url());
  });
  for (const path of ['/', '/help/']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  await page.waitForTimeout(3500); // let any late loaders fire
  expect(hits).toEqual([]);
});
