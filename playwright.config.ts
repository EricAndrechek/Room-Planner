import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 43291);
// Set E2E_BASE_URL to test an already-running server (e.g. `wrangler dev`); no webServer is started.
// Empty counts as unset (the cross-browser workflow sets it to '' on PRs).
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL || undefined;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: EXTERNAL_BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  // `chromium` is the only project the required `ci` job runs (`pnpm test:e2e`). The rest run in the
  // advisory cross-browser workflow (`pnpm test:e2e:all`); see docs/TESTING.md.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit',
      timeout: 60_000, // WebKit/Firefox/emulated mobile are slower than Chromium
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'firefox',
      timeout: 60_000,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    { name: 'mobile-safari', timeout: 60_000, use: { ...devices['iPhone 15'] } },
    { name: 'mobile-chrome', timeout: 60_000, use: { ...devices['Pixel 7'] } },
  ],
  webServer: EXTERNAL_BASE_URL
    ? undefined
    : {
        // Builds first so the spec always runs against the current static output.
        command: `pnpm run build && pnpm exec astro preview --ignore-lock --port ${PORT} --host localhost`,
        url: `http://localhost:${PORT}/`,
        // Never reuse: a leftover server on this port could silently serve a stale dist.
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
