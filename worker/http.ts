/**
 * The MCP routes of the site's Worker (docs/design/plan-format.md, section 7):
 *
 * - `/mcp`: the MCP endpoint, stateless Streamable HTTP for both protocol eras (POST; GET and
 *   DELETE are 405, as a stateless server has no stream or session to offer);
 * - `/mcp/server-card`: the MCP Server Card (SEP-2127);
 * - anything else under `/mcp/`: 404;
 * - `/api/*`: the REST API over the same tools (api.ts).
 *
 * Every response here carries CORS for browser-based MCP clients, `Cache-Control: no-store` and
 * `nosniff`; `_headers` does not apply to Worker responses. Requests are rate limited per client
 * IP. Nothing is logged: no request body, no plan.
 */
import { SUPPORTED_PROTOCOL_VERSIONS, createMcpHandler } from '@modelcontextprotocol/server';
import { environmentOf, headerProps, report, type Activity, type HostIds } from './analytics';
import { API_PREFIX, handleApi } from './api';
import registry from '../server.json';
import {
  REGISTRY_NAME,
  SERVER_DESCRIPTION,
  SERVER_ICONS,
  SERVER_TITLE,
  SERVER_VERSION,
  WEBSITE_URL,
  createServer,
} from './mcp';

export interface Env {
  ASSETS: Fetcher;
  /** Every request to /mcp, /mcp/* and /api/*, per client IP (wrangler.jsonc `ratelimits`). */
  MCP_LIMIT?: RateLimit;
}

/** Largest request body the endpoint reads (a 500-piece plan is about 100 KB). */
export const MAX_BODY = 256 * 1024;
export const RETRY_AFTER_SECONDS = 60;
/** The per-request protocol revision (the SDK does not export its constant). */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

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

/** A REST API problem (RFC 9457) or answer. */
const apiJson = (
  body: unknown,
  status: number,
  problem: boolean,
  headers: Record<string, string> = {},
) =>
  withHeaders(
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': problem ? 'application/problem+json' : 'application/json',
        ...headers,
      },
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

const payloadTooLarge = () =>
  json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'The request body is too large.' },
    },
    413,
  );

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
  description: SERVER_DESCRIPTION,
  websiteUrl: WEBSITE_URL,
  repository: registry.repository,
  icons: SERVER_ICONS,
  remotes: [
    {
      type: 'streamable-http',
      url: `${origin}/mcp`,
      // createMcpHandler serves the 2026-07-28 revision and every 2025-era one.
      supportedProtocolVersions: [MODERN_PROTOCOL_VERSION, ...SUPPORTED_PROTOCOL_VERSIONS],
    },
  ],
});

/** The client's address, the only identity a free, account-less endpoint has. */
const clientKey = (request: Request) =>
  request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? 'unknown';

/** The limit in wrangler.jsonc, for the `RateLimit-Policy` header. */
export const RATE_LIMIT = 120;

/**
 * A fixed-window counter per client in this isolate's memory: the backstop for the binding, which
 * on this account accepted 450 requests a minute from one address without limiting (checked on
 * the preview). Approximate, since a client can reach several isolates, but free, and enough to
 * stop one client hammering the endpoint. Bounded: old windows are dropped.
 */
const windows = new Map<string, { start: number; count: number }>();
const WINDOW_MS = 60_000;
const MAX_CLIENTS = 10_000;

export function overMemoryLimit(key: string, now = Date.now()): boolean {
  let w = windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    if (windows.size >= MAX_CLIENTS) {
      for (const [k, v] of windows) if (now - v.start >= WINDOW_MS) windows.delete(k);
      if (windows.size >= MAX_CLIENTS) windows.clear();
    }
    w = { start: now, count: 0 };
    windows.set(key, w);
  }
  return ++w.count > RATE_LIMIT;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';
const PROTOCOL_KEY = 'io.modelcontextprotocol/protocolVersion';

/** What analytics learns about a request as it is handled. */
interface Trace {
  activities: Activity[];
  hostIds: HostIds;
  protocol?: string;
  clientName?: string;
  clientVersion?: string;
}

/**
 * Handle /mcp and /mcp/*. `RateLimit-Policy` (IETF draft) states the limit. With `ctx`, usage is
 * reported to PostHog after the response (production and previews only; analytics.ts).
 */
export async function handleMcp(
  request: Request,
  env: Env,
  ctx?: Pick<ExecutionContext, 'waitUntil'>,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const trace: Trace = {
    hostIds: { mcpSession: request.headers.get('mcp-session-id') ?? undefined },
    activities: [],
    protocol: request.headers.get('mcp-protocol-version') ?? undefined,
  };
  const response = await route(request, env, trace);
  response.headers.set('RateLimit-Policy', `"mcp";q=${RATE_LIMIT};w=60`);
  const hostname = new URL(request.url).hostname;
  if (!ctx || environmentOf(hostname) === 'development') return response;
  // A 2025-era answer is a stream that ends when the tool does, so report once the body is out.
  let sent: Promise<unknown> = Promise.resolve();
  let out = response;
  if (response.body) {
    const { readable, writable } = new TransformStream();
    sent = response.body.pipeTo(writable).catch(() => undefined);
    out = new Response(readable, response);
  }
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf;
  const headers = headerProps(request.headers);
  ctx.waitUntil(
    sent.then(() =>
      report(
        trace.activities,
        {
          hostname,
          ip: clientKey(request),
          userAgent: request.headers.get('user-agent'),
          headers,
          cf,
          hostIds: trace.hostIds,
          protocol: trace.protocol,
          clientName: trace.clientName,
          clientVersion: trace.clientVersion,
          serverVersion: SERVER_VERSION,
          now: Date.now(),
        },
        fetchImpl,
      ),
    ),
  );
  return out;
}

/** Read what analytics needs from a JSON-RPC message (no plan content). */
function observe(message: unknown, trace: Trace) {
  if (!isObject(message)) return;
  const params = isObject(message.params) ? message.params : {};
  const meta = isObject(params._meta) ? params._meta : {};
  const info = isObject(params.clientInfo)
    ? params.clientInfo
    : isObject(meta[CLIENT_INFO_KEY])
      ? meta[CLIENT_INFO_KEY]
      : {};
  if (typeof meta['openai/subject'] === 'string')
    trace.hostIds.openaiSubject = meta['openai/subject'];
  if (typeof meta['openai/session'] === 'string')
    trace.hostIds.openaiSession = meta['openai/session'];
  if (typeof info.name === 'string') trace.clientName = info.name;
  if (typeof info.version === 'string') trace.clientVersion = info.version;
  const protocol = params.protocolVersion ?? meta[PROTOCOL_KEY];
  if (typeof protocol === 'string') trace.protocol = protocol;
  if (message.method === 'initialize' || message.method === 'server/discover') {
    trace.activities.push({
      kind: 'initialize',
      clientName: trace.clientName,
      clientVersion: trace.clientVersion,
      protocol: trace.protocol,
    });
  }
}

async function route(request: Request, env: Env, trace: Trace): Promise<Response> {
  const url = new URL(request.url);
  // Links and the card point at this site; behind Cloudflare it is https (wrangler dev says http).
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const origin = local ? url.origin : `https://${url.host}`;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const isApi = path.startsWith(API_PREFIX) || path === API_PREFIX.slice(0, -1);
  const isEndpoint = path === '/mcp';
  const isCard = path === '/mcp/server-card';
  if (!isEndpoint && !isCard && !isApi) {
    return json({ error: 'Not found. The MCP endpoint is /mcp.' }, 404);
  }

  const allow = isApi
    ? path === '/api/plan'
      ? 'GET, HEAD, OPTIONS'
      : 'POST, OPTIONS'
    : isEndpoint
      ? 'POST, OPTIONS'
      : 'GET, HEAD, OPTIONS';
  if (request.method === 'OPTIONS') return preflight(allow);

  const key = clientKey(request);
  const limited =
    overMemoryLimit(key) || (env.MCP_LIMIT && !(await env.MCP_LIMIT.limit({ key })).success);
  if (limited) {
    trace.activities.push({ kind: 'rate_limited', transport: isApi ? 'rest' : 'mcp' });
    if (isApi) {
      return apiJson(
        {
          type: 'https://room-planner.andrechek.com/openapi.json#rate_limited',
          title: 'Too many requests',
          status: 429,
          detail: `Too many requests from this address. Wait ${RETRY_AFTER_SECONDS} seconds and try again.`,
          error_kind: 'rate_limited',
        },
        429,
        true,
        { 'Retry-After': String(RETRY_AFTER_SECONDS) },
      );
    }
    return tooManyRequests();
  }

  if (isApi) {
    const record = (a: Activity) => trace.activities.push(a);
    const a = await handleApi(request, path, origin, record, MAX_BODY);
    const head = request.method === 'HEAD';
    return apiJson(head ? null : a.body, a.status, a.problem ?? false, a.headers);
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
  // The body is parsed once, here: analytics reads the method and client, and the SDK gets the
  // parsed value (so this path applies the body limit itself).
  let parsedBody: unknown;
  if (request.method === 'POST') {
    const text = await request.clone().text();
    if (text.length > MAX_BODY) return payloadTooLarge();
    try {
      parsedBody = JSON.parse(text);
      observe(parsedBody, trace);
    } catch {
      parsedBody = undefined; // the SDK answers the parse error
    }
  }
  const record = (a: Activity) => trace.activities.push(a);
  const handler = createMcpHandler(() => createServer(origin, record), {
    maxRequestBodySize: MAX_BODY,
    // Reporting only, and never the request: an error can quote the body, which may hold a plan.
    onerror: (error) => console.error(`mcp: ${error.name}`),
  });
  const response = await handler.fetch(
    request,
    parsedBody === undefined ? undefined : { parsedBody },
  );
  return withHeaders(response, response.status === 405 ? { Allow: allow } : {});
}
