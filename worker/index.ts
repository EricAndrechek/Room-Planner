/**
 * The site's Worker (docs/design/plan-format.md, section 7). Static assets are served by the
 * assets layer without running this code: `assets.run_worker_first` in wrangler.jsonc sends only
 * `/mcp` and `/mcp/*` here, and http.ts answers them. The entry module exports nothing else
 * (workerd rejects named exports that are not handlers).
 */
import { handleMcp, type Env } from './http';
import { warmUp } from './warm';

warmUp();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/mcp' || pathname.startsWith('/mcp/')) return handleMcp(request, env);
    // Only reached for paths that `run_worker_first` sends here by mistake: serve the site.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
