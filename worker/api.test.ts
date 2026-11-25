/**
 * The REST API (api.ts) through the Worker, as an HTTP agent sees it: each operation, its errors
 * (400, 404, 405, 413, 422, 429), CORS, and that it answers exactly as the MCP tool does.
 */
import { describe, expect, it } from 'vitest';
import { readPlanLink } from '../src/core/share/plan';
import { API_EXAMPLE_PLAN } from '../src/lib/openapi';
import { API_CURL, READABLE_EXAMPLES } from '../src/lib/site';
import worker from './index';
import { MAX_BODY, type Env } from './http';
import { checkPlan, createPlan } from './tools';

const ORIGIN = 'https://room-planner.andrechek.com';

const env = (allowed = Infinity): Env => {
  let used = 0;
  return {
    ASSETS: { fetch: async () => new Response('asset', { status: 404 }) } as unknown as Fetcher,
    MCP_LIMIT: { limit: async () => ({ success: ++used <= allowed }) } as RateLimit,
  };
};

let ip = 0;
const call = (path: string, init: RequestInit = {}, e: Env = env()) =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      ...init,
      // A fresh address per call, so the in-memory limit never trips here.
      headers: { 'cf-connecting-ip': `198.51.100.${++ip % 250}`, ...(init.headers ?? {}) },
    }),
    e,
    undefined as unknown as ExecutionContext,
  );

const postJson = (path: string, body: unknown) =>
  call(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /api/plan/check', () => {
  it('checks a bare plan or {plan, minClearance}, as check_layout does', async () => {
    const r = await postJson('/api/plan/check', API_EXAMPLE_PLAN);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    const body = await r.json();
    expect(body).toEqual(checkPlan({ plan: API_EXAMPLE_PLAN }).structured);
    const wrapped = await postJson('/api/plan/check', { plan: API_EXAMPLE_PLAN, minClearance: 4 });
    expect(await wrapped.json()).toEqual(
      checkPlan({ plan: API_EXAMPLE_PLAN, minClearance: 4 }).structured,
    );
  });

  it('answers 422 with one line per field for an invalid plan, 400 for no JSON', async () => {
    const bad = await postJson('/api/plan/check', { ...API_EXAMPLE_PLAN, unit: 'yards' });
    expect(bad.status).toBe(422);
    expect(bad.headers.get('content-type')).toBe('application/problem+json');
    const p = (await bad.json()) as { error_kind: string; errors: string[]; status: number };
    expect(p.status).toBe(422);
    expect(p.error_kind).toBe('invalid_plan');
    expect(p.errors.join('\n')).toMatch(/^plan\.unit: /m);

    const notJson = await postJson('/api/plan/check', '{"rooms": [');
    expect(notJson.status).toBe(400);
    expect(((await notJson.json()) as { error_kind: string }).error_kind).toBe('bad_json');

    const bigger = await postJson('/api/plan/check', `"${'x'.repeat(MAX_BODY)}"`);
    expect(bigger.status).toBe(413);
  });
});

describe('POST /api/plan/link', () => {
  it('returns the plan, issues, summary and a link that opens the plan, as create_plan does', async () => {
    const r = await postJson('/api/plan/link', { plan: API_EXAMPLE_PLAN });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { url: string; plan: { rooms: unknown[] } };
    const tool = await createPlan({ plan: API_EXAMPLE_PLAN }, ORIGIN);
    expect(body).toEqual(tool.structured);
    const opened = await readPlanLink(body.url);
    expect(opened.ok && opened.plan.items.map((i) => i.label)).toEqual(['Queen bed', 'Dresser']);
  });

  it('accepts the documented curl example', async () => {
    const body = /-d '(.*)'$/.exec(API_CURL)![1]!;
    expect(API_CURL).toContain(`${ORIGIN}/api/plan/link`);
    const r = await postJson('/api/plan/link', body);
    expect(r.status).toBe(200);
  });

  it('answers 422 for an empty or null plan, naming what is missing', async () => {
    for (const body of [{}, { plan: null }]) {
      const r = await postJson('/api/plan/link', body);
      expect(r.status).toBe(422);
      expect(((await r.json()) as { detail: string }).detail).toMatch(/plan/);
    }
  });
});

describe('GET /api/plan', () => {
  it('reads a link given whole, or the text after #s= or #p=', async () => {
    const made = (await (await postJson('/api/plan/link', API_EXAMPLE_PLAN)).json()) as {
      url: string;
    };
    const byUrl = await call(`/api/plan?url=${encodeURIComponent(made.url)}`);
    expect(byUrl.status).toBe(200);
    const s = new URL(made.url).hash.slice('#s='.length);
    const byS = await call(`/api/plan?s=${s}`);
    expect(await byS.json()).toEqual(await byUrl.json());
    const byP = await call(`/api/plan?p=${encodeURIComponent(READABLE_EXAMPLES.bedroom)}`);
    expect(byP.status).toBe(200);
    expect(((await byP.json()) as { plan: { name: string } }).plan.name).toBe('Bedroom');
  });

  it('answers 400 without a link and 422 for a damaged one', async () => {
    expect((await call('/api/plan')).status).toBe(400);
    const damaged = await call('/api/plan?s=AAAA');
    expect(damaged.status).toBe(422);
    expect(((await damaged.json()) as { error_kind: string }).error_kind).toBe('damaged_link');
  });
});

describe('the API over HTTP', () => {
  it('405 with Allow for a wrong method, 404 for an unknown path, CORS preflight', async () => {
    const get = await call('/api/plan/link');
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, OPTIONS');
    const post = await postJson('/api/plan', API_EXAMPLE_PLAN);
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
    expect((await call('/api/nothing')).status).toBe(404);
    const pre = await call('/api/plan/link', {
      method: 'OPTIONS',
      headers: { origin: 'https://agent.example', 'access-control-request-method': 'POST' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    expect(pre.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
  });

  it('is rate limited with the /mcp limit: 429, Retry-After, a problem', async () => {
    const e = env(1);
    expect((await call('/api/plan?url=x', {}, e)).status).toBe(400);
    const r = await call('/api/plan?url=x', {}, e);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    expect(r.headers.get('content-type')).toBe('application/problem+json');
  });
});
