# Deploying Room Planner (Cloudflare Workers)

Hosting is one Cloudflare Worker with static assets (`wrangler.jsonc`, served at
`room-planner.andrechek.com`). `dist/` is served by the assets layer. The Worker code
(`worker/index.ts`) runs only for `/mcp` and `/mcp/*` (`assets.run_worker_first`): the MCP server
for AI assistants (docs/design/plan-format.md, section 7). Every page, asset and 404 is served
without invoking the Worker, so the Workers Free daily invocation limit (100,000) is spent only on
MCP requests. A rate-limit binding (`MCP_LIMIT`, 120 requests per minute per client IP) guards
`/mcp`; it needs no setup in the dashboard. Wrangler's custom build (`build.command` in
`wrangler.jsonc`) bundles the MCP plan viewer (`scripts/build-viewer.mjs`) before every `dev`,
`deploy` and `preview`, so the Workers Builds commands are unchanged. The old hostname `roomplanner.andrechek.com` is a Cloudflare redirect rule, not a Worker
(section 5). PostHog analytics go directly from the browser to PostHog US cloud; there is no proxy.

The `andrechek.com` zone lives in the maintainer's Cloudflare account.

## 1. How deploys work (Cloudflare Workers Builds)

Cloudflare builds from GitHub on push; there are no GitHub Actions deploy jobs and no GitHub
secrets. (`.github/workflows/ci.yml` only runs the tests on PRs.)

- **Production**: a push to `main` builds and deploys the Worker.
  Build command `pnpm build:ci`, deploy command `pnpm run deploy`
  (`wrangler deploy && node scripts/indexnow.mjs`). After the upload, `scripts/indexnow.mjs`
  submits the sitemap URLs whose `<lastmod>` is in the last 7 days to IndexNow
  (`api.indexnow.org`: Bing, Yandex, Seznam...). It only runs when `WORKERS_CI_BRANCH` is `main`,
  never fails the deploy, and logs one `indexnow:` line in the build log. Its key is the public
  file `public/<key>.txt` (the key is in the script); to rotate it, replace both.
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
pnpm dev:worker         # serves dist/ and /mcp on http://localhost:8787
pnpm exec wrangler deploy --dry-run --outdir /tmp/out   # validate config and bundle, no upload
npx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --transport http --method tools/list
```

Against `wrangler dev` (or a preview, via `E2E_BASE_URL`) `e2e/mcp.spec.ts` also runs its `/mcp`
tests: a real call, CORS, 405/404 and a 429 burst. `astro preview` has no Worker, so they skip
there. `MCP_SHOTS_DIR=<dir>` saves screenshots of the plan viewer.

### MCP Registry releases

`server.json` (repository root) is the MCP Registry entry and the one source of the MCP server's
identity: the Worker's `initialize` serverInfo and its server card read their name, version, title,
description, website and icons from it. To release, bump `version` in `server.json` in a PR.
After the merge, `.github/workflows/mcp-registry.yml` validates it, skips a version the registry
already has, waits until `https://room-planner.andrechek.com/mcp/server-card` serves the new
version (Workers Builds deploys first), then logs in with GitHub OIDC (`id-token: write`, no
secrets; the registry grants `io.github.EricAndrechek/*` to this repository's workflows) and
publishes. Nothing is manual, including the first publish. `workflow_dispatch` reruns it. On
PRs the workflow only validates. `mcp-publisher` is pinned to a release and its SHA-256 is
checked; to upgrade, change both from that release's `registry_<version>_checksums.txt`.

A domain name instead: the owner approved `com.andrechek.room-planner/mcp`, verified over HTTP on
`room-planner.andrechek.com` (the registry grants exactly `com.andrechek.room-planner/*` to that
domain; no DNS change). It needs a private key that only the owner may store, so these steps are
the owner's:

1. Generate an Ed25519 key pair (OpenSSL 3 or later):
   `openssl genpkey -algorithm Ed25519 -out key.pem`.
2. Write the public half to `public/.well-known/mcp-registry-auth`:
   `echo "v=MCPv1; k=ed25519; p=$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)" > public/.well-known/mcp-registry-auth`.
   It is a static asset: served as is, with no Worker invocation; the service worker does not
   precache it (only html, js, css and images) and never answers `/.well-known/`.
3. Store the private half (hex) as the repository secret `MCP_REGISTRY_PRIVATE_KEY`:
   `openssl pkey -in key.pem -noout -text | sed -n '/priv:/,/pub:/p' | sed '1d;$d' | tr -d ' :\n' | gh secret set MCP_REGISTRY_PRIVATE_KEY -R EricAndrechek/Room-Planner`
   (and, if wanted, a copy in the gitignored `.env`), then delete `key.pem`.
4. Change `name` in `server.json` to `com.andrechek.room-planner/mcp` and the AI Catalog
   identifier to match, and in the workflow replace the OIDC login with
   `./mcp-publisher login http --domain room-planner.andrechek.com --private-key "$MCP_REGISTRY_PRIVATE_KEY"`
   (`env: MCP_REGISTRY_PRIVATE_KEY: ${{ secrets.MCP_REGISTRY_PRIVATE_KEY }}`), after a step that
   waits until `https://room-planner.andrechek.com/.well-known/mcp-registry-auth` serves the record
   (the registry fetches it from Google Cloud with `Accept: text/plain`; redirects fail).
5. Optionally mark the `io.github` entry deprecated with `mcp-publisher status`.

The workflow carries these lines in a comment. GitHub OIDC (`io.github.EricAndrechek/*`) stays
the fallback that needs no secret.

### MCP analytics

The Worker sends MCP usage events to PostHog (`worker/analytics.ts`, project key in the code). It
needs no setup.

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
