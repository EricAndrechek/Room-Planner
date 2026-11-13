# Deploying Room Planner (Cloudflare Workers)

Hosting is one Cloudflare Worker. The app is a Worker with static assets (`wrangler.jsonc`, served
at `room-planner.andrechek.com`): `dist/` is served by the assets layer. It is an assets-only Worker (no `main`, no Worker code, no invocations or Worker
limits). The old hostname `roomplanner.andrechek.com` is a Cloudflare redirect rule, not a Worker
(section 5). PostHog analytics go directly from the browser to PostHog US cloud; there is no proxy.

The `andrechek.com` zone lives in the maintainer's Cloudflare account.

## 1. How deploys work (Cloudflare Workers Builds)

Cloudflare builds from GitHub on push; there are no GitHub Actions deploy jobs and no GitHub
secrets. (`.github/workflows/ci.yml` only runs the tests on PRs.)

- **Production**: a push to `main` builds and deploys the Worker.
  Build command `pnpm build:ci`, deploy command `pnpm run deploy` (`wrangler deploy`).
  **Gotcha (only relevant if a second Worker is ever deployed from this repo):** Workers Builds
  sets `WRANGLER_CI_OVERRIDE_NAME` (and `WRANGLER_CI_MATCH_TAG`) for the connected Worker, and
  Wrangler applies them to _every_ deploy in the build, so a second `wrangler deploy -c other/...`
  silently uploads that code **as `room-planner`** and steals its custom domain. Clear both
  variables for the second deploy (`env -u WRANGLER_CI_OVERRIDE_NAME -u WRANGLER_CI_MATCH_TAG wrangler deploy -c ...`).
- **Previews**: pushes to other branches (and PRs) run `npx wrangler preview` as the
  non-production branch deploy command. The preview URL
  (`<alias>-room-planner.<subdomain>.workers.dev`) shows in the Cloudflare dashboard (Workers >
  room-planner > Deployments) and in the GitHub check. `preview_urls` is enabled in
  `wrangler.jsonc`. Previews are public; the Worker must have been deployed once first.

The connection is configured once in the dashboard (Workers > room-planner > Settings > Builds).
The account id is never committed.

### Optional: source maps for error tracking

`pnpm build:ci` runs `astro build` then `scripts/upload-sourcemaps.sh`, which injects and uploads
source maps to PostHog only when `POSTHOG_CLI_API_KEY` and `POSTHOG_CLI_PROJECT_ID` are set, and
is a no-op otherwise. To enable, add them in the Builds settings: `POSTHOG_CLI_API_KEY` as a build
secret (personal API key with error tracking write + organization read) and
`POSTHOG_CLI_PROJECT_ID` as a build variable. Maps are emitted as `hidden`
(`vite.build.sourcemap` in the Astro config) and `.assetsignore` (`*.map`) keeps them off the
public site.

## 2. Cutover to `room-planner.andrechek.com`

A Workers custom domain cannot be attached while a DNS record already exists for that hostname. The
main Worker owns `room-planner.andrechek.com` (Universal SSL covers it).

1. **New domain first**: merge to `main` and let the build deploy. The Worker attaches
   `room-planner.andrechek.com`. Verify it before touching the old name.
2. **Move the old hostname**: in the Cloudflare dashboard, remove the old `roomplanner.andrechek.com`
   custom domain from the `room-planner` Worker (Settings > Domains & Routes), delete any left-over
   DNS record for it, then create the redirect described in section 5.
3. **Verify** (see section 5), and that PostHog sees `environment: production` on the new host.
4. **Disable GitHub Pages** if it is still enabled:
   `gh api -X DELETE repos/EricAndrechek/Room-Planner/pages`.

Owner TODO: in Google Search Console add the new domain as a property and use **Settings > Change of
address** from the old property to the new one (the redirect answers every request with a `301` to
the same path, which is what Change of address requires). Update any external links you control.

### Rollback

- Bad release: `pnpm exec wrangler rollback` (or dashboard > Workers > room-planner > Deployments >
  rollback), or revert the commit and push.
- The old-hostname redirect misbehaves: disable or edit the Single Redirect rule in the Cloudflare
  dashboard; nothing in this repo is involved.

## 3. Local development

```sh
pnpm build
pnpm dev:worker         # serves dist/ (assets only) on http://localhost:8787
pnpm exec wrangler deploy --dry-run --outdir /tmp/out   # validate config, no upload
```

`_headers` (from `public/`, copied into `dist/`) applies in `wrangler dev`.

## 4. App requirements

`src/components/PostHog.astro` initialises PostHog with `api_host: "https://us.i.posthog.com"`; the CSP must allow `https://*.posthog.com`.
The CSP lives in `public/_headers` (rationale in the comment there).

## 5. The old hostname (`roomplanner.andrechek.com`)

`roomplanner.andrechek.com` is a Cloudflare **Single Redirect rule** on the `andrechek.com` zone,
managed in the Cloudflare dashboard/API, not in this repo:

- Match: hostname equals `roomplanner.andrechek.com`.
- Action: dynamic redirect, status `301`, target
  `concat("https://room-planner.andrechek.com", http.request.uri.path)` with **Preserve query
  string** on.
- The rule only fires for proxied hostnames, so the zone needs a proxied placeholder DNS record:
  `AAAA roomplanner 100::` (proxied, orange cloud).

Projects saved in the browser on the old origin are **not migrated** (owner's decision; `localStorage`
is per-origin). `#s=` share links survive because browsers keep the URL fragment across redirects.

Verify:

```sh
curl -sI https://roomplanner.andrechek.com/help/?x=1    # 301, location: https://room-planner.andrechek.com/help/?x=1
```
