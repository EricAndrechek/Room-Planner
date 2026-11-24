/**
 * Usage analytics for the MCP server (docs/design/plan-format.md, section 7, "Analytics"): one
 * batch of PostHog events per request, sent with `ctx.waitUntil` after the response, so a slow or
 * failing PostHog never delays or breaks a call.
 *
 * What is sent: which method or tool, whether it worked and why not (a fixed vocabulary), counts
 * (rooms, pieces, issues by severity), the plan's unit, whether the editor can open it, the
 * client's self-reported name and version, whether that client is a hosted service or runs
 * locally, the protocol version, the request's headers except credentials (`h_*`), Cloudflare's
 * network and location data for the request (`cf_*`), the environment, and the caller's IP as
 * `$ip` for PostHog's GeoIP, as for the website's own analytics. Never plan content, names,
 * labels or links. Events have no person profile.
 */
import type { Issue, ToolStats } from './tools';

/** The site's public PostHog project key (src/components/PostHog.astro): an ingest-only token. */
export const POSTHOG_KEY = 'phc_ykKVRqy82jxfkj4MNtEUhTRZKSLUQ2sDtUXizUoWQ77r';
export const POSTHOG_BATCH_URL = 'https://us.i.posthog.com/batch/';

export type Environment = 'production' | 'preview' | 'development';

export const environmentOf = (hostname: string): Environment =>
  hostname === 'room-planner.andrechek.com'
    ? 'production'
    : hostname.endsWith('.workers.dev')
      ? 'preview'
      : 'development';

/** The client software, coarsely, from its user agent (never the raw string). */
export function uaFamily(ua: string | null): string {
  if (!ua) return 'none';
  const rules: [RegExp, string][] = [
    [/claude-code/i, 'claude-code'],
    [/claude/i, 'claude'],
    [/openai|chatgpt/i, 'openai'],
    [/cursor/i, 'cursor'],
    [/vscode|visual studio code/i, 'vscode'],
    [/goose/i, 'goose'],
    [/mcp-remote/i, 'mcp-remote'],
    [/inspector/i, 'mcp-inspector'],
    [/python|httpx|aiohttp/i, 'python'],
    [/^node|undici/i, 'node'],
    [/curl/i, 'curl'],
    [/mozilla/i, 'browser'],
  ];
  return rules.find(([re]) => re.test(ua))?.[1] ?? 'other';
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

const sha = async (text: string) =>
  hex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).slice(
      0,
      16,
    ),
  );

/** Identifiers a host sends on its own (anonymous already; hashed again, never sent raw). */
export interface HostIds {
  /** ChatGPT: `_meta["openai/subject"]`, an anonymised user id. */
  openaiSubject?: string;
  /** ChatGPT: `_meta["openai/session"]`, an anonymised conversation id. */
  openaiSession?: string;
  /** Any client of a sessionful server: the `Mcp-Session-Id` header. */
  mcpSession?: string;
}

/**
 * `distinct_id` and where it came from. A host-provided id when there is one, so users of a
 * hosted client (who share its egress addresses) stay apart; else a hash of IP, user agent and
 * client name (`fallback`), which cannot tell apart users of a hosted client without host ids.
 */
export async function identify(
  ids: HostIds,
  fallback: { ip: string; userAgent: string; clientName: string },
): Promise<{ distinctId: string; idSource: string }> {
  if (ids.openaiSubject) {
    return { distinctId: `chatgpt_${await sha(ids.openaiSubject)}`, idSource: 'openai/subject' };
  }
  if (ids.openaiSession) {
    return {
      distinctId: `chatgptsession_${await sha(ids.openaiSession)}`,
      idSource: 'openai/session',
    };
  }
  if (ids.mcpSession) {
    return { distinctId: `mcpsession_${await sha(ids.mcpSession)}`, idSource: 'mcp-session-id' };
  }
  const { ip, userAgent, clientName } = fallback;
  return {
    distinctId: `mcp_${await sha(`${ip}|${userAgent}|${clientName}`)}`,
    idSource: 'fallback',
  };
}

/** Networks of cloud and AI providers: a call from one comes from a hosted client's servers. */
const DATACENTRE =
  /anthropic|openai|google|amazon|aws|microsoft|azure|oracle|cloudflare|digitalocean|hetzner|ovh|linode|akamai|fastly|vultr|alibaba|tencent/i;

/**
 * `hosted` for clients that call from their vendor's servers (Claude's connectors on the web and
 * desktop, ChatGPT), where the location is the vendor's datacentre; `local` for clients on the
 * user's machine (Claude Code, Cursor, VS Code, the Inspector, others). The network (Cloudflare's
 * `asOrganization`) is the strongest signal; the client's name and user agent come next.
 */
export function clientKind(
  clientName: string | undefined,
  family: string,
  asOrganization?: string,
): 'hosted' | 'local' {
  if (clientName && /claude-code|cursor|vscode|visual studio|inspector|goose/i.test(clientName)) {
    return 'local';
  }
  if (asOrganization && DATACENTRE.test(asOrganization)) return 'hosted';
  if (clientName && /claude|anthropic|openai|chatgpt/i.test(clientName)) return 'hosted';
  return family === 'claude' || family === 'openai' ? 'hosted' : 'local';
}

/** Header names never sent: credentials and anything that looks like one. */
const DENIED_HEADER =
  /^(authorization|proxy-authorization|cookie|set-cookie)$|token|secret|key|auth|session|signature|password/i;
const MAX_HEADER = 512;

/** The request's headers as `h_*` properties, without credentials, values cut to 512 chars. */
export function headerProps(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (DENIED_HEADER.test(name)) return;
    out[`h_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`] = value.slice(0, MAX_HEADER);
  });
  return out;
}

/** Cloudflare's network and location data for the request, as `cf_*` properties. */
export function cfProps(cf: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!cf) return out;
  const keys: [string, string][] = [
    ['city', 'cf_city'],
    ['region', 'cf_region'],
    ['regionCode', 'cf_region_code'],
    ['postalCode', 'cf_postal_code'],
    ['country', 'cf_country'],
    ['continent', 'cf_continent'],
    ['latitude', 'cf_latitude'],
    ['longitude', 'cf_longitude'],
    ['timezone', 'cf_timezone'],
    ['asn', 'cf_asn'],
    ['asOrganization', 'cf_as_organization'],
    ['colo', 'cf_colo'],
    ['httpProtocol', 'cf_http_protocol'],
    ['tlsVersion', 'cf_tls_version'],
  ];
  for (const [from, to] of keys) {
    const v = cf[from];
    if (typeof v === 'string' || typeof v === 'number')
      out[to] = typeof v === 'string' ? v.slice(0, MAX_HEADER) : v;
  }
  return out;
}

/** What a request did, as analytics sees it. */
export type Activity =
  | { kind: 'initialize'; clientName?: string; clientVersion?: string; protocol?: string }
  | { kind: 'tool'; tool: string; ok: boolean; stats?: ToolStats; durationMs: number }
  | { kind: 'tool_failed'; tool: string; durationMs: number }
  | { kind: 'resource'; uri: string }
  | { kind: 'rate_limited' };

export interface RequestContext {
  hostname: string;
  ip: string;
  userAgent: string | null;
  /** `headerProps(request.headers)`. */
  headers: Record<string, string>;
  /** `request.cf`. */
  cf?: Record<string, unknown>;
  hostIds: HostIds;
  protocol?: string;
  clientName?: string;
  clientVersion?: string;
  serverVersion: string;
  now: number;
}

const severityCounts = (issues: Issue[] = []) => ({
  issues_error: issues.filter((i) => i.severity === 'error').length,
  issues_warning: issues.filter((i) => i.severity === 'warning').length,
  issues_info: issues.filter((i) => i.severity === 'info').length,
  issue_codes: [...new Set(issues.map((i) => i.code))].sort(),
});

/** Keep a self-reported string short and printable. */
const clip = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v.replace(/[^\x20-\x7e]/g, '').slice(0, 60) : undefined;

/** The PostHog events for one request (empty for requests not worth an event). */
export async function buildEvents(
  activities: Activity[],
  ctx: RequestContext,
): Promise<Record<string, unknown>[]> {
  if (!activities.length) return [];
  // An initialize names the client even when the request headers do not.
  const init = activities.find((a) => a.kind === 'initialize');
  const clientName = clip(ctx.clientName) ?? clip(init?.clientName);
  const family = uaFamily(ctx.userAgent);
  const cf = cfProps(ctx.cf);
  const { distinctId, idSource } = await identify(ctx.hostIds, {
    ip: ctx.ip,
    userAgent: ctx.userAgent ?? '',
    clientName: clientName ?? '',
  });
  const base = {
    ...ctx.headers,
    ...cf,
    $process_person_profile: false,
    // PostHog's GeoIP reads this (the request reaching PostHog comes from Cloudflare).
    $ip: ctx.ip,
    $lib: 'room-planner-mcp',
    $lib_version: ctx.serverVersion,
    environment: environmentOf(ctx.hostname),
    id_source: idSource,
    ua_family: family,
    client_kind: clientKind(clientName, family, cf.cf_as_organization as string | undefined),
    protocol: clip(ctx.protocol) ?? clip(init?.protocol),
    client_name: clientName,
    client_version: clip(ctx.clientVersion) ?? clip(init?.clientVersion),
  };
  const timestamp = new Date(ctx.now).toISOString();
  const event = (name: string, properties: Record<string, unknown>) => ({
    event: name,
    distinct_id: distinctId,
    timestamp,
    properties: { ...base, ...properties },
  });
  return activities.map((a) => {
    switch (a.kind) {
      case 'initialize':
        return event('mcp_initialize', {});
      case 'tool':
        return event('mcp_tool_called', {
          tool: a.tool,
          ok: a.ok,
          error_kind: a.stats?.errorKind ?? null,
          rooms: a.stats?.rooms ?? null,
          items: a.stats?.items ?? null,
          unit: a.stats?.unit ?? null,
          editable: a.stats?.editable ?? null,
          duration_ms: a.durationMs,
          ...severityCounts(a.stats?.issues),
        });
      case 'tool_failed':
        return event('mcp_tool_called', {
          tool: a.tool,
          ok: false,
          error_kind: 'internal',
          duration_ms: a.durationMs,
        });
      case 'resource':
        return event('mcp_resource_read', { uri: a.uri });
      case 'rate_limited':
        return event('mcp_rate_limited', {});
    }
  });
}

/**
 * Send a request's activities to PostHog. Never throws: a PostHog outage costs only the events.
 * The caller runs it inside `waitUntil`, after the response, so it never delays a call.
 */
export async function report(
  activities: Activity[],
  ctx: RequestContext,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!activities.length) return;
  try {
    const batch = await buildEvents(activities, ctx);
    await fetchImpl(POSTHOG_BATCH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: POSTHOG_KEY, batch }),
    });
  } catch {
    // Analytics are best effort.
  }
}
