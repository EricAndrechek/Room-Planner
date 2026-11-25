/**
 * The site's Worker (docs/design/plan-format.md, section 7; docs/DEPLOY.md, "Discovery for
 * agents"). `assets.run_worker_first` in wrangler.jsonc sends only the page routes, `/mcp`,
 * `/mcp/*`, `/api/*` and `/.well-known/search` here; every asset (scripts, images, `.md`,
 * `llms*.txt`, the other `/.well-known/*` files, `/openapi.json`) is served by the assets layer
 * without running this code.
 *
 * - `/mcp`, `/mcp/*`, `/api/*`: http.ts.
 * - `/.well-known/search`: search.ts (Search for Agents over the site's pages).
 * - Pages: @wave-rf/cloudflare-md-router, which serves a page's Markdown twin (`/faq/` ->
 *   `/faq.md`) to `Accept: text/markdown` and to known LLM crawlers, the HTML otherwise with a
 *   `Link` to the twin, and `Vary: Accept` on the Markdown (this file takes it off the HTML, for
 *   the service worker). On `/` and `/agents/` this file adds `Link`s to the API
 *   (scripts/discovery.mjs) to the router's.
 *
 * The entry module exports nothing else (workerd rejects named exports that are not handlers).
 */
import { createMdRouter } from '@wave-rf/cloudflare-md-router';
import { API_POINTER_PAGES, PATHS, linkHeader } from '../scripts/discovery.mjs';
import { handleMcp, type Env } from './http';
import { handleSearch } from './search';
import { warmUp } from './warm';

warmUp();

const pages = createMdRouter<Env>({ vary: true });

/** A page answer with the API pointers added to its `Link` header, where it carries them. */
async function page(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const response = await pages.fetch!(
    request as Request<unknown, IncomingRequestCfProperties>,
    env,
    ctx,
  );
  const path = new URL(request.url).pathname.replace(/^\/+/, '');
  const html = (response.headers.get('content-type') ?? '').startsWith('text/html');
  if (!html) return response;
  const out = new Response(response.body, response);
  // `Vary: Accept` stays on the Markdown answers only. On HTML it breaks the service worker: the
  // Cache API honours Vary, so a page precached with `Accept: */*` never matches a navigation's
  // `Accept: text/html,...`, and the installed app fails offline (seen in WebKit and Chrome on
  // the preview). No shared cache stores these answers (they are Worker responses with
  // `max-age=0, must-revalidate`), so the HTML loses nothing by it.
  const vary = (out.headers.get('vary') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v && v.toLowerCase() !== 'accept');
  if (vary.length) out.headers.set('Vary', vary.join(', '));
  else out.headers.delete('Vary');
  if (API_POINTER_PAGES.includes(path) && response.status === 200) {
    // Merged with the router's `Link` (the Markdown twin), never replacing it.
    out.headers.append('Link', linkHeader(path, { twin: false }));
  }
  return out;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/mcp' || pathname.startsWith('/mcp/') || pathname.startsWith('/api/')) {
      return handleMcp(request, env, ctx);
    }
    if (pathname === PATHS.search) return handleSearch(request, env);
    return page(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
