# Deploying Room Planner (Cloudflare Workers)

Hosting is a Cloudflare Worker with static assets (`wrangler.jsonc`): `dist/` is served by the
assets layer (no Worker invocation), and `worker/index.ts` only handles `/ingest/*`, a reverse
proxy to PostHog US cloud so ad blockers do not drop events.

The `andrechek.com` zone lives in the owner's PERSONAL Cloudflare account. The account id is never
committed; it comes from `CLOUDFLARE_ACCOUNT_ID`.

## 1. One-time setup

### API token (personal account)

Dashboard > My Profile > API Tokens > Create Token (start from the "Edit Cloudflare Workers"
template, then restrict). Permissions:

| Scope                | Permission                                       |
| -------------------- | ------------------------------------------------ |
| Account              | Workers Scripts: Edit                            |
| Zone (andrechek.com) | Workers Routes: Edit                             |
| Zone (andrechek.com) | DNS: Edit (custom domains create the DNS record) |
| Zone (andrechek.com) | Zone: Read                                       |

Resources: Account = the personal account; Zone = `andrechek.com` only. (The Wrangler docs list the
exact set under "Roles and permissions"; if `wrangler deploy` reports a 403 for the custom domain,
the missing permission is named in the error. Add it rather than widening to all zones.)

### Repo secrets

```sh
gh secret set CLOUDFLARE_API_TOKEN  -R EricAndrechek/Room-Planner      # paste token
gh secret set CLOUDFLARE_ACCOUNT_ID -R EricAndrechek/Room-Planner      # 32-hex account id from the dashboard URL
# optional, PostHog source maps for error tracking:
gh secret set POSTHOG_CLI_API_KEY -R EricAndrechek/Room-Planner        # personal API key: error tracking write + organization read
gh variable set POSTHOG_CLI_PROJECT_ID -R EricAndrechek/Room-Planner --body <posthog project id>
```

Also create the GitHub environment `production` (Settings > Environments). Until the two Cloudflare
secrets exist, the deploy and preview jobs print a notice and exit green.

PostHog source maps need the build to emit maps (`vite.build.sourcemap: 'hidden'` in the Astro
config). `.assetsignore` (`*.map`) keeps them off the public site; they only go to PostHog.

## 2. Cutover

A Workers custom domain cannot be attached while a DNS record already exists for that hostname, and
today `roomplanner` is a proxied CNAME to `<user>.github.io`. The zone's Universal SSL wildcard
already covers `*.andrechek.com`, so the Worker serves HTTPS as soon as the record exists and
downtime is about a minute. Do steps 2 and 3 back to back.

1. **One-time setup** (section 1): API token and repo secrets in place.
2. **Delete the DNS record**: Cloudflare dashboard > andrechek.com > DNS > remove CNAME
   `roomplanner` (`<user>.github.io`).
3. **Deploy immediately**: Actions > Deploy > Run workflow (`workflow_dispatch`), or locally after
   `pnpm exec wrangler login` to the PERSONAL Cloudflare account: `pnpm build && pnpm deploy`.
   The custom domain in `wrangler.jsonc` recreates the DNS record.
4. **Verify** `https://roomplanner.andrechek.com`: app loads, headers (`curl -I`), a missing path
   shows the 404 page, `/ingest/static/array.js` returns JS, events arrive in PostHog, service
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

## 3. PR previews

On a same-repo pull request, the Deploy workflow builds and runs
`wrangler versions upload --preview-alias pr-<number>`, which uploads a version without deploying it
and comments the URL (`pr-<n>-room-planner.<subdomain>.workers.dev`) on the PR (updated in place on
each push). `preview_urls` is enabled in `wrangler.jsonc`. Notes: previews are public URLs; the
Worker must have been deployed once before versions can be uploaded; fork PRs get no preview.

## 4. Local development

```sh
pnpm build
pnpm dev:worker         # serves dist/ + the /ingest proxy on http://localhost:8787
pnpm exec wrangler deploy --dry-run --outdir /tmp/out   # validate config, no upload
```

`_headers` (from `public/`, copied into `dist/`) applies in `wrangler dev`. Regenerate Worker types
after changing `wrangler.jsonc`: `pnpm exec wrangler types worker/worker-configuration.d.ts`.

## 5. App requirements

PostHog must be initialised with `api_host: "/ingest"` and `ui_host: "https://us.posthog.com"`.
The CSP lives in `public/_headers` (rationale in the comment there).
