/**
 * The MCP routes of the site's Worker (docs/design/plan-format.md, section 7):
 *
 * - `/mcp`: the MCP endpoint, stateless Streamable HTTP for both protocol eras (POST; GET and
 *   DELETE are 405, as a stateless server has no stream or session to offer);
 * - `/mcp/server-card`: the MCP Server Card (SEP-2127);
 * - anything else under `/mcp/`: 404.
 *
 * Every response here carries CORS for browser-based MCP clients, `Cache-Control: no-store` and
 * `nosniff`; `_headers` does not apply to Worker responses. Requests are rate limited per client
 * IP. Nothing is logged: no request body, no plan.
 */
import { SUPPORTED_PROTOCOL_VERSIONS, createMcpHandler } from '@modelcontextprotocol/server';
import { SERVER_TITLE, SERVER_VERSION, SITE, createServer } from './mcp';

export interface Env {
  ASSETS: Fetcher;
  /** Every request to /mcp and /mcp/*, per client IP (wrangler.jsonc `ratelimits`). */
  MCP_LIMIT?: RateLimit;
}

/** The registry name (server.json) and the card's `name`. */
export const REGISTRY_NAME = 'io.github.ericandrechek/room-planner';
/** Largest request body the endpoint reads (a 500-piece plan is about 100 KB). */
export const MAX_BODY = 256 * 1024;
export const RETRY_AFTER_SECONDS = 60;

const BASE_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': '*',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

/** `response` with this endpoint's headers added (CORS, no caching). */
const withHeaders = (response: Response, extra: Record<string, string> = {}): Response => {
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries({ ...BASE_HEADERS, ...extra })) out.headers.set(k, v);
  return out;
};

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  withHeaders(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    }),
  );

const preflight = (allow: string) =>
  withHeaders(new Response(null, { status: 204 }), {
    'Access-Control-Allow-Methods': allow,
    // No credentials are ever sent, so the wildcard is honoured, which also covers the
    // `Mcp-Param-*` headers of the 2026-07-28 revision.
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
  });

const methodNotAllowed = (allow: string) =>
  json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed.' } }, 405, {
    Allow: allow,
  });

const tooManyRequests = () =>
  json(
    {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: `Too many requests from this address. Wait ${RETRY_AFTER_SECONDS} seconds and try again.`,
      },
    },
    429,
    { 'Retry-After': String(RETRY_AFTER_SECONDS) },
  );

/** The MCP Server Card (SEP-2127): who the server is and where to connect. */
export const serverCard = (origin: string) => ({
  $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
  name: REGISTRY_NAME,
  version: SERVER_VERSION,
  title: SERVER_TITLE,
  description:
    'Lay out a room: furniture to scale, clash checks, and a link to edit it. Free, no account.',
  websiteUrl: `${SITE}/agents/`,
  repository: { url: 'https://github.com/EricAndrechek/Room-Planner', source: 'github' },
  icons: [{ src: `${SITE}/pwa-192x192.png`, mimeType: 'image/png', sizes: ['192x192'] }],
  remotes: [
    {
      type: 'streamable-http',
      url: `${origin}/mcp`,
      supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
    },
  ],
});

/** The client's address, the only identity a free, account-less endpoint has. */
const clientKey = (request: Request) =>
  request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? 'unknown';

/** Handle /mcp and /mcp/*. */
export async function handleMcp(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // Links and the card point at this site; behind Cloudflare it is https (wrangler dev says http).
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const origin = local ? url.origin : `https://${url.host}`;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const isEndpoint = path === '/mcp';
  const isCard = path === '/mcp/server-card';
  if (!isEndpoint && !isCard) {
    return json({ error: 'Not found. The MCP endpoint is /mcp.' }, 404);
  }

  const allow = isEndpoint ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS';
  if (request.method === 'OPTIONS') return preflight(allow);

  if (env.MCP_LIMIT) {
    const { success } = await env.MCP_LIMIT.limit({ key: clientKey(request) });
    if (!success) return tooManyRequests();
  }

  if (isCard) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed(allow);
    return withHeaders(
      new Response(request.method === 'HEAD' ? null : JSON.stringify(serverCard(origin)), {
        headers: { 'Content-Type': 'application/mcp-server-card+json' },
      }),
      { 'Cache-Control': 'public, max-age=3600' },
    );
  }

  // POST is the protocol; GET and DELETE are the SDK's 405 for a stateless server.
  if (!['POST', 'GET', 'DELETE'].includes(request.method)) return methodNotAllowed(allow);
  const handler = createMcpHandler(() => createServer(origin), {
    maxRequestBodySize: MAX_BODY,
    responseMode: 'json',
    // Reporting only, and never the request: an error can quote the body, which may hold a plan.
    onerror: (error) => console.error(`mcp: ${error.name}`),
  });
  const response = await handler.fetch(request);
  return withHeaders(response, response.status === 405 ? { Allow: allow } : {});
}
