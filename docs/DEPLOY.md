# Deploying Room Planner (Cloudflare Workers)

Hosting is two Cloudflare Workers. The app is a Worker with static assets (`wrangler.jsonc`, served
at `room-planner.andrechek.com`): `dist/` is served by the assets layer. It is an assets-only Worker (no `main`, no Worker code, no invocations or Worker
limits). The second Worker, `room-planner-legacy` (`legacy/`), serves the old hostname
`roomplanner.andrechek.com` (section 5). PostHog analytics go directly from the browser to PostHog US cloud; there is no proxy.

The `andrechek.com` zone lives in the maintainer's Cloudflare account.

## 1. How deploys work (Cloudflare Workers Builds)

Cloudflare builds from GitHub on push; there are no GitHub Actions deploy jobs and no GitHub
secrets. (`.github/workflows/ci.yml` only runs the tests on PRs.)

- **Production**: a push to `main` builds and deploys the Worker.
  Build command `pnpm build:ci`, deploy command
  `npx wrangler deploy && npx wrangler deploy -c legacy/wrangler.jsonc` (both Workers; the legacy one
  needs no build output).
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

## 2. Cutover to `room-planner.andrechek.com`

A Workers custom domain cannot be attached while a DNS record already exists for that hostname. Both
hostnames are in the `andrechek.com` zone (Universal SSL wildcard covers them), so each Worker serves
HTTPS as soon as its record exists. The main Worker owns `room-planner.andrechek.com`; the legacy
Worker owns `roomplanner.andrechek.com`.

1. **Prepare**: update the Workers Builds deploy command (section 1) so both Workers deploy.
2. **New domain first**: nothing else uses `room-planner`, so merge to `main` and let the build deploy.
   The main Worker attaches `room-planner.andrechek.com`. Verify it before touching the old name.
3. **Move the old hostname**: in the Cloudflare dashboard, remove the old `roomplanner.andrechek.com`
   custom domain from the `room-planner` Worker (Settings > Domains & Routes), delete any left-over
   DNS record for it, and deploy the legacy Worker (`pnpm deploy:legacy` or retry the build). Its
   `custom_domain` route recreates the record. Do these back to back; downtime is about a minute.
4. **Verify** (see section 5), and that PostHog sees `environment: production` on the new host.
5. **Disable GitHub Pages** if it is still enabled:
   `gh api -X DELETE repos/EricAndrechek/Room-Planner/pages`.

Owner TODO: in Google Search Console add the new domain as a property and use **Settings > Change of
address** from the old property to the new one (the legacy Worker already answers crawlers with `301`s
to the same path, which is what Change of address requires). Update any external links you control.

### Rollback

- Bad release: `pnpm exec wrangler rollback` (or dashboard > Workers > room-planner > Deployments >
  rollback), or revert the commit and push.
- The bridge misbehaves: the data is never deleted from the old origin (the bridge only reads it), so a
  fix can be redeployed any time. To fall back to a plain redirect, ship a legacy Worker that always
  returns `301` (`redirectTo` in `legacy/lib.ts`); visitors who already migrated keep their data.

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

## 5. The legacy hostname (`roomplanner.andrechek.com`)

`legacy/` is a separate Worker (`legacy/wrangler.jsonc`, name `room-planner-legacy`, `TARGET_ORIGIN`
var). The logic is in `legacy/lib.ts`, the entry in `legacy/index.ts`. Deploy: `pnpm deploy:legacy`;
it is also part of the Workers Builds deploy command.

| Request                                                                                                                                                                  | Response                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /sw.js`                                                                                                                                                             | Kill-switch service worker (`Cache-Control: no-store`): skips waiting, deletes all caches, unregisters itself and reloads every controlled tab. Visitors who installed the old PWA keep a service worker serving the cached old app; browsers re-fetch `/sw.js` on navigation, so they pick this up. |
| Crawlers (Googlebot, bingbot, `bot`/`crawler`/`spider`/`preview` UAs), assets (`/_astro/*`, icons, manifest, og-image...) and anything that is not a document navigation | `301` to `TARGET_ORIGIN + path + search` (`308` for non-GET)                                                                                                                                                                                                                                         |
| Browser navigations                                                                                                                                                      | Bridge HTML: `no-store`, `noindex`, canonical link, `<noscript>` meta refresh, CSP allowing only its own inline script/style by hash                                                                                                                                                                 |

The bridge script retires any service worker and caches (best effort, at most ~1 s), collects every
`localStorage` key starting with `room-planner-`, `room-sim-v<n>-` or `rp:`, and redirects to
`TARGET_ORIGIN + path + search + '#rp-migrate=' + payload`, where the payload is
`base64url(deflate-raw(JSON))` of `{ v: 1, keys: {...}, path, search, hash }`
(`#rp-migrate-j=` is the uncompressed variant for browsers without `CompressionStream`; `hash` is the
original fragment, e.g. a `#s=` share link). With no app data it redirects to the plain URL. If the URL
would exceed ~1.5 MB it offers a downloadable backup (the app's own "projects" export format, for
Import) and a Continue link instead. The old origin's data is never deleted.

On arrival, `src/lib/migrate.ts` (before anything reads storage) decodes the payload and merges it:

- Target has no `room-planner-projects` or layout keys: every carried key is written verbatim.
- Otherwise `room-planner-projects` is merged by project id (the copy with the newer `updatedAt`
  wins; ties and missing timestamps keep the existing copy; new ids are appended) and every other key
  is written only if absent.
- A corrupt payload is ignored (error captured), the URL is cleaned, boot continues. The URL is then
  restored to the original path, query and fragment. Event: `domain_migration_imported`.

Verify after cutover:

```sh
curl -sI -A Googlebot https://roomplanner.andrechek.com/help/    # 301 -> https://room-planner.andrechek.com/help/
curl -s https://roomplanner.andrechek.com/sw.js | head -3        # kill switch
curl -sI -H 'Sec-Fetch-Dest: document' -H 'Accept: text/html' https://roomplanner.andrechek.com/   # 200 bridge, no-store
```

Local end-to-end test (`e2e/migrate.spec.ts`; skipped unless both URLs are set):

```sh
pnpm build
pnpm exec wrangler dev --port 8787 --inspector-port 9331 &
pnpm exec wrangler dev -c legacy/wrangler.jsonc --port 8788 --inspector-port 9332 \
  --var TARGET_ORIGIN:http://localhost:8787 &
E2E_BASE_URL=http://localhost:8787 E2E_LEGACY_URL=http://127.0.0.1:8788 pnpm exec playwright test migrate
```
