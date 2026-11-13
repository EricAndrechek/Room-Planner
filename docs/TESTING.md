# Testing

## What runs where

| Where                                 | What                                                                    | Blocks merge? |
| ------------------------------------- | ----------------------------------------------------------------------- | ------------- |
| `.github/workflows/ci.yml` (job `ci`) | check, lint, test, build, Playwright **chromium** only                  | yes (ruleset) |
| `.github/workflows/cross-browser.yml` | Playwright `webkit`, `firefox`, `mobile-safari`, `mobile-chrome`        | no (advisory) |
| cross-browser on `pull_request`       | against the PR's local build (Playwright starts `astro preview`)        |               |
| cross-browser on daily `schedule`     | against production, `https://room-planner.andrechek.com` (smoke)        |               |
| cross-browser on `workflow_dispatch`  | production, or the `base_url` input (e.g. a Workers Builds preview URL) |               |

Never name a job in `cross-browser.yml` `ci`; the ruleset requires only `ci`.

## Running locally

```sh
pnpm exec playwright install --with-deps chromium webkit firefox   # once

pnpm test:e2e                                  # chromium only (what CI requires)
pnpm test:e2e:all                              # every project, local build
pnpm exec playwright test --project=webkit     # one project
```

Projects: `chromium`, `webkit` (desktop Safari engine; macOS WebKit is the closest to real Safari
you can run here), `firefox`, `mobile-safari` (iPhone 15, WebKit, touch), `mobile-chrome` (Pixel 7).

### Against a running server, preview URL or production

`E2E_BASE_URL` skips the local web server:

```sh
E2E_BASE_URL=https://room-planner.andrechek.com pnpm test:e2e:all
E2E_BASE_URL=https://<branch-slug>-room-planner.ericandr.workers.dev pnpm test:e2e:all
```

`e2e/csp.spec.ts` only runs when `E2E_BASE_URL` is set, because only a server that applies
`_headers` enforces the CSP. To check it locally against the real built headers:

```sh
pnpm build && pnpm exec wrangler dev --port 8787 &
E2E_BASE_URL=http://localhost:8787 pnpm test:e2e:all
```

WebKit cannot run against `wrangler dev` over plain `http://localhost`: unlike Chromium and Firefox it
does not exempt localhost from the CSP's `upgrade-insecure-requests`, so every subresource is
upgraded to https and fails. WebKit projects therefore use the local `astro preview` build (no
`_headers`, so the CSP spec is skipped) or an https URL (preview or production). Everything else
runs under the real CSP.

In GitHub, run the workflow by hand: Actions > Cross-browser > Run workflow, optionally with a URL.

### Mobile projects

`mobile-safari`/`mobile-chrome` run the same specs as desktop plus `e2e/mobile.spec.ts` (tap, touch
drag via pointer events, share round-trip, no horizontal overflow). Below 768px the sidebar is an
off-canvas sheet and the step buttons read "1. Room" / "2. Items"; specs reach the sidebar through
`openStep()` / `viewPlan()` in `e2e/ui.ts`, which work on both layouts. Only the mouse drag/rotate
test in `planner.spec.ts` is desktop-only (its touch twin is in `mobile.spec.ts`).

On iOS (`mobile-safari`), PNG/PDF export opens the share sheet (Save Image / Save to Files) instead of
a blob download, falling back to a download if sharing is refused; `export.spec.ts` stubs
`navigator.share` there to check the shared file.

### Browser-specific skips and quirks

Some specs are skipped per engine with a reason in the spec (CDP installability checks are
Chromium-only). A skip is a note in the test output, not a silent pass.

Engine quirks the specs account for (none are app bugs):

- Download names: macOS WebKit reports them NFD-normalized (`café` as `e` + combining accent) and
  Linux WebKit replaces spaces with `_`; `export.spec.ts` compares the name in the app's spelling.
- Playwright's Firefox crashes the page when a `getByRole('dialog', { name })` lookup is followed by
  axe's `aria-dialog-name` rule (reproducible on a one-line static page), so the a11y spec finds
  dialogs by their heading before scanning.
- axe scans run with `reducedMotion: 'reduce'` and wait for animations to finish: a scan taken
  mid fade-in (a dialog, or the "Ready to work offline" toast) sees blended colors.
- Firefox logs PostHog's cookie-domain probe (`dmn_chk_…` rejected for `.com`) as an error;
  `e2e/problems.ts` tolerates it.

### Notifications

The daily run should only fail for a real regression. Each failing test is retried once on CI
(`retries: 1`; a pass on retry is reported as flaky, not failed), browser downloads are retried, and
a remote target must answer a retried `curl` before tests start, so a short outage or network blip
does not send a failure email.

## CSP

`public/_headers` keeps `'unsafe-inline'` in `script-src` as a source placeholder only.
`scripts/csp-hashes.mjs` (run after `astro build` by `build` and `build:ci`) replaces it in
`dist/_headers` with the `sha256-` hashes of every inline `<script>` in `dist/**/*.html`
(JSON-LD excluded) and fails the build if the CSP line or the token is missing.
`pnpm dev` / `astro preview` do not apply `_headers`.

## Cloudflare Browser Rendering (now "Browser Run")

Evaluated, not adopted. It drives Chrome only (Playwright/Puppeteer over CDP), so it adds no
Safari or Firefox coverage, and a Playwright-in-Actions chromium run already covers Chrome for free
with traces and reports. It is useful for rendering/screenshotting from a Worker, not for
cross-browser compatibility testing.

Real iOS/Android devices (touch quirks, iOS Safari viewport and storage behavior that desktop
WebKit emulation misses) would need a device cloud such as BrowserStack or LambdaTest. Paid; a
possible later option if the WebKit/mobile-safari projects stop catching Safari-only bugs.
