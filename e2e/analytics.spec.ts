import { expect, test } from '@playwright/test';

// Playwright sets navigator.webdriver, so analytics must stay fully off (no SDK, no network)
// even when the build carries a PUBLIC_POSTHOG_KEY.
test('analytics stays off under automation: no /ingest requests', async ({ page }) => {
  const hits: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/ingest')) hits.push(r.url());
  });
  for (const path of ['/', '/help/']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  await page.waitForTimeout(3500); // longer than the idle-callback timeout
  expect(hits).toEqual([]);
});
