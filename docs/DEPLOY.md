# Deploying Room Planner (Cloudflare Workers)

Hosting is a Cloudflare Worker with static assets (`wrangler.jsonc`): `dist/` is served by the
assets layer. It is an assets-only Worker (no `main`, no Worker code, no invocations or Worker
limits). PostHog analytics go directly from the browser to PostHog US cloud; there is no proxy.

The `andrechek.com` zone lives in the maintainer's Cloudflare account.

## 1. How deploys work (Cloudflare Workers Builds)

Cloudflare builds from GitHub on push; there are no GitHub Actions deploy jobs and no GitHub
secrets. (`.github/workflows/ci.yml` only runs the tests on PRs.)

- **Production**: a push to `main` builds and deploys the Worker.
  Build command `pnpm build:ci`, deploy command `npx wrangler deploy`.
- **Previews**: pushes to other branches (and PRs) run `npx wrangler versions upload` as the
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

## 2. Cutover

A Workers custom domain cannot be attached while a DNS record already exists for that hostname, and
today `roomplanner` is a proxied CNAME to `<user>.github.io`. The zone's Universal SSL wildcard
already covers `*.andrechek.com`, so the Worker serves HTTPS as soon as the record exists and
downtime is about a minute. Do steps 2 and 3 back to back.

1. **Prepare**: the Workers Builds connection (section 1) is in place and `main` has deployed once.
2. **Delete the DNS record**: Cloudflare dashboard > andrechek.com > DNS > remove CNAME
   `roomplanner` (`<user>.github.io`).
3. **Deploy immediately**: retry the latest build in the dashboard (or push to `main`), or locally
   after `pnpm exec wrangler login` to the account that owns the zone: `pnpm build && pnpm deploy`.
   The custom domain in `wrangler.jsonc` recreates the DNS record.
4. **Verify** `https://roomplanner.andrechek.com`: app loads, headers (`curl -I`), a missing path
   shows the 404 page, the `_headers` CSP applies, events arrive in PostHog, service
   worker registers, no CSP violations in the console.
5. **Disable GitHub Pages**: `gh api -X DELETE repos/EricAndrechek/Room-Planner/pages`.

### Rollback

- Bad release (domain already on the Worker): `pnpm exec wrangler rollback` (or dashboard >
  Workers > room-planner > Deployments > rollback), or revert the commit and push.
- Need Pages back (domain cut over but Worker unusable): delete the Worker custom domain
  (dashboard > Workers > room-planner > Settings > Domains & Routes), re-create the proxied CNAME
  `roomplanner` -> `<user>.github.io`, and re-enable Pages
  (`gh api -X POST repos/EricAndrechek/Room-Planner/pages -f build_type=workflow`) with the old
  workflow and `public/CNAME` from git history (commit `2cae5c5`).

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
