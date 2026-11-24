/**
 * Usage analytics for the MCP server (docs/design/plan-format.md, section 7, "Analytics"): one
 * batch of PostHog events per request, sent with `ctx.waitUntil` after the response, so a slow or
 * failing PostHog never delays or breaks a call.
 *
 * What is sent: which method or tool, whether it worked and why not (a fixed vocabulary), counts
 * (rooms, pieces, issues by severity), the plan's unit, the client's self-reported name and
 * version, whether that client is a hosted service or runs locally, the protocol version, a
 * user-agent family, the environment, and the caller's IP address as `$ip`, from which PostHog
 * derives an approximate location, as for the website's own analytics. Never plan content, names,
 * labels or links. Events have no person profile; `distinct_id` is a hash of IP and client name.
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

/** A stable id for one client at one address: `mcp_` and 32 hex digits of SHA-256(ip|client). */
export async function clientId(ip: string, client: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}|${client}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return `mcp_${hex(digest.slice(0, 16))}`;
}

/**
 * `hosted` for clients that call from their vendor's servers (Claude's connectors on the web and
 * desktop, ChatGPT), where the location is the vendor's datacentre; `local` for clients on the
 * user's machine (Claude Code, Cursor, VS Code, the Inspector, others).
 */
export function clientKind(clientName: string | undefined, family: string): 'hosted' | 'local' {
  if (clientName && /claude-code|cursor|vscode|visual studio|inspector|goose/i.test(clientName)) {
    return 'local';
  }
  if (clientName && /claude|anthropic|openai|chatgpt/i.test(clientName)) return 'hosted';
  return family === 'claude' || family === 'openai' ? 'hosted' : 'local';
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
  country?: string;
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
  const distinctId = await clientId(ctx.ip, clientName ?? family);
  const base = {
    $process_person_profile: false,
    // PostHog's GeoIP reads this (the request reaching PostHog comes from Cloudflare).
    $ip: ctx.ip,
    $lib: 'room-planner-mcp',
    $lib_version: ctx.serverVersion,
    environment: environmentOf(ctx.hostname),
    country: ctx.country,
    ua_family: family,
    client_kind: clientKind(clientName, family),
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
