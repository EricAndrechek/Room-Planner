import { expect, test } from '@playwright/test';

// Playwright sets navigator.webdriver, so analytics must stay fully off (no SDK, no network)
// regardless of host.
test('analytics stays off under automation: no /rpq requests', async ({ page }) => {
  const hits: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/rpq')) hits.push(r.url());
  });
  for (const path of ['/', '/help/']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  await page.waitForTimeout(3500); // let any late loaders fire
  expect(hits).toEqual([]);
});
