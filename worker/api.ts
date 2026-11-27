/**
 * The REST API (docs/design/plan-format.md, section 7, "REST API"): the MCP tools for agents that
 * can make HTTP requests but have no MCP client (curl, agent frameworks, ChatGPT Custom GPT
 * Actions). Each operation calls the same function as its tool (tools.ts); this file only maps
 * HTTP to it and back. Described by /openapi.json (src/lib/openapi.ts).
 *
 * - `POST /api/plan/check`: a plan (or `{plan, minClearance}`) -> `{ok, issues, summary}`.
 * - `POST /api/plan/link`: a plan (or `{plan}`) -> `{plan, issues, summary, url, editable}`.
 * - `GET /api/plan?url=<link>` (or `?s=`, `?p=`): the plan in a link -> as `/link`. As Markdown
 *   (the summary, the issues grouped, the link as Markdown link text) for `Accept: text/markdown`
 *   and for the fetchers of assistants that browse (ChatGPT-User, Claude-User, Perplexity-User…)
 *   unless they ask for JSON: that is how an assistant with no tools checks a link it wrote.
 *
 * Errors are `application/problem+json` (RFC 9457): 400 when the request cannot be read (not
 * JSON, no plan, a bad argument or URL), 422 when it was read but the plan is not valid (with one
 * `errors` line per field path) or the link is damaged or too new. Rate limit, CORS and analytics
 * are http.ts's, shared with /mcp.
 */
import { LLM_BOT_UA } from '@wave-rf/cloudflare-md-router';
import type { Activity } from './analytics';
import {
  checkPlan,
  createPlan,
  planMarkdown,
  readPlan,
  type ErrorKind,
  type ToolOutcome,
} from './tools';

export const API_PREFIX = '/api/';

/** The operations, by path, with the methods they answer. */
const ROUTES: Record<string, { op: ApiOp; allow: string }> = {
  '/api/plan/check': { op: 'check', allow: 'POST, OPTIONS' },
  '/api/plan/link': { op: 'link', allow: 'POST, OPTIONS' },
  '/api/plan': { op: 'read', allow: 'GET, HEAD, OPTIONS' },
};
export type ApiOp = 'check' | 'link' | 'read';

const UNREADABLE: ErrorKind[] = [
  'missing_plan',
  'bad_argument',
  'missing_url',
  'bad_url',
  'bad_json',
];
const TITLES: Partial<Record<ErrorKind, string>> = {
  too_large: 'The request body is too large',
  bad_json: 'The request body is not JSON',
  missing_plan: 'No plan in the request',
  invalid_plan: 'The plan is not valid',
  newer_version: 'The plan is from a newer version of the format',
  bad_argument: 'A parameter is not valid',
  missing_url: 'No link in the request',
  bad_url: 'Not a URL',
  no_plan_in_link: 'The link holds no plan',
  damaged_link: 'The link is damaged',
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface ApiAnswer {
  status: number;
  body: unknown;
  /** The answer as Markdown instead of JSON (`GET /api/plan` for assistants that browse). */
  markdown?: string;
  /** Extra headers (Allow on a 405). */
  headers?: Record<string, string>;
  problem?: boolean;
}

const problem = (
  status: number,
  kind: ErrorKind,
  detail: string,
  errors?: string[],
): ApiAnswer => ({
  status,
  problem: true,
  body: {
    type: `https://room-planner.andrechek.com/openapi.json#${kind}`,
    title: TITLES[kind] ?? 'The request failed',
    status,
    detail,
    error_kind: kind,
    ...(errors?.length ? { errors } : {}),
  },
});

/** The tool's outcome as an HTTP answer. */
const answer = (o: ToolOutcome): ApiAnswer => {
  if (!o.isError) return { status: 200, body: o.structured };
  const kind = o.stats.errorKind ?? 'bad_argument';
  return problem(UNREADABLE.includes(kind) ? 400 : 422, kind, o.text, o.details);
};

/** The fetchers of assistants that open pages for a user, beyond the crawlers LLM_BOT_UA names. */
const BROWSING_UA = /perplexity-user|mistralai-user|meta-externalfetcher|youbot|cohere-ai|phind/i;

/**
 * Whether a request wants Markdown: it asks for `text/markdown`, or it comes from an assistant's
 * fetcher and does not ask for JSON.
 */
export const wantsMarkdown = (request: Request): boolean => {
  const accept = (request.headers.get('accept') ?? '').toLowerCase();
  if (accept.includes('text/markdown')) return true;
  if (accept.includes('application/json') || accept.includes('application/problem+json'))
    return false;
  const ua = request.headers.get('user-agent') ?? '';
  return LLM_BOT_UA.test(ua) || BROWSING_UA.test(ua);
};

/** Whether `path` is an API route this file knows (else 404). */
export const isApiPath = (path: string) => path in ROUTES;

/**
 * Answer one API request (after CORS preflight and rate limiting, which http.ts does). `record`
 * hears what was done, for analytics.
 */
export async function handleApi(
  request: Request,
  path: string,
  origin: string,
  record: (a: Activity) => void,
  maxBody: number,
): Promise<ApiAnswer> {
  const route = ROUTES[path];
  if (!route) {
    return {
      status: 404,
      body: { error: 'Not found. See /openapi.json for the API.' },
    };
  }
  const methods = route.allow.split(', ');
  if (!methods.includes(request.method)) {
    return {
      status: 405,
      body: {
        error: `Method not allowed. Use ${methods.filter((m) => m !== 'OPTIONS').join(' or ')}.`,
      },
      headers: { Allow: route.allow },
    };
  }
  const start = Date.now();
  const done = (o: ToolOutcome): ApiAnswer => {
    record({
      kind: 'api',
      op: route.op,
      ok: !o.isError,
      stats: o.stats,
      durationMs: Date.now() - start,
    });
    return answer(o);
  };

  if (route.op === 'read') {
    const q = new URL(request.url).searchParams;
    const url =
      q.get('url') ??
      (q.get('s') ? `${origin}/#s=${q.get('s')}` : null) ??
      (q.get('p') ? `${origin}/#p=${q.get('p')}` : null);
    const outcome = await readPlan({ url: url ?? undefined }, origin);
    const a = done(outcome);
    return wantsMarkdown(request) ? { ...a, markdown: planMarkdown(outcome, origin) } : a;
  }

  const refuse = (status: number, kind: ErrorKind, detail: string): ApiAnswer => {
    record({ kind: 'api', op: route.op, ok: false, stats: { errorKind: kind }, durationMs: 0 });
    return problem(status, kind, detail);
  };
  const text = await request.text();
  if (text.length > maxBody) {
    return refuse(413, 'too_large', `The request body is over ${maxBody / 1024} KB.`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, 'bad_json', 'The request body must be a JSON plan, or {"plan": ...}.');
  }
  // A bare plan, or the tool's arguments ({plan, minClearance}).
  const args: Json = isObject(body) && 'plan' in body && !('rooms' in body) ? body : { plan: body };
  return done(route.op === 'check' ? checkPlan(args) : await createPlan(args, origin));
}
