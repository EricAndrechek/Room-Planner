import { expect, test } from '@playwright/test';

// Only meaningful against a server that applies public/_headers (e.g. `wrangler dev`):
//   E2E_BASE_URL=http://localhost:8787 pnpm test:e2e
test.skip(!process.env.E2E_BASE_URL, 'needs E2E_BASE_URL (a server that serves _headers)');

test('pages load without CSP violations or console errors', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /content security policy/i.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  for (const path of ['/', '/help/']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(problems).toEqual([]);
});
