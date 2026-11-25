/**
 * The site's Worker (docs/design/plan-format.md, section 7; docs/DEPLOY.md, "Discovery for
 * agents"). `assets.run_worker_first` in wrangler.jsonc sends only the page routes, `/mcp`,
 * `/mcp/*` and `/api/*` here; every asset (scripts, images, `.md`, `llms*.txt`, `/.well-known/*`,
 * `/openapi.json`) is served by the assets layer without running this code.
 *
 * - `/mcp`, `/mcp/*`, `/api/*`: http.ts.
 * - Pages: @wave-rf/cloudflare-md-router, which serves a page's Markdown twin (`/faq/` ->
 *   `/faq.md`) to `Accept: text/markdown` and to known LLM crawlers, the HTML otherwise with a
 *   `Link` to the twin, and `Vary: Accept`. On `/` and `/agents/` this file adds `Link`s to the
 *   API (scripts/discovery.mjs) to the router's.
 *
 * The entry module exports nothing else (workerd rejects named exports that are not handlers).
 */
import { createMdRouter } from '@wave-rf/cloudflare-md-router';
import { API_POINTER_PAGES, linkHeader } from '../scripts/discovery.mjs';
import { handleMcp, type Env } from './http';
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
  if (!API_POINTER_PAGES.includes(path) || response.status !== 200 || !html) return response;
  const out = new Response(response.body, response);
  // Merged with the router's `Link` (the Markdown twin), never replacing it.
  out.headers.append('Link', linkHeader(path, { twin: false }));
  return out;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/mcp' || pathname.startsWith('/mcp/') || pathname.startsWith('/api/')) {
      return handleMcp(request, env, ctx);
    }
    return page(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
