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
import { CHATGPT_READABLE } from './fixtures';
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

describe('GET /api/plan for assistants that browse', () => {
  const p = `/api/plan?p=${encodeURIComponent(CHATGPT_READABLE)}`;

  it('answers Markdown to an assistant fetcher or Accept: text/markdown, JSON otherwise', async () => {
    for (const headers of <Record<string, string>[]>[
      { 'user-agent': 'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)' },
      { 'user-agent': 'Claude-User (claude-code/1.0; +https://www.anthropic.com)' },
      { 'user-agent': 'Perplexity-User/1.0' },
      { accept: 'text/markdown, text/plain;q=0.5' },
    ]) {
      const r = await call(p, { headers });
      expect(r.status, JSON.stringify(headers)).toBe(200);
      expect(r.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(r.headers.get('x-robots-tag')).toBe('noindex');
      expect(r.headers.get('vary')).toBe('Accept, User-Agent');
    }
    const json = await call(p, {
      headers: { 'user-agent': 'ChatGPT-User/1.0', accept: 'application/json' },
    });
    expect(json.headers.get('content-type')).toBe('application/json');
    expect(((await json.json()) as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
    expect((await call(p)).headers.get('content-type')).toBe('application/json');
  });

  it('says what is wrong with the plan ChatGPT wrote, naming pieces and places', async () => {
    const md = await (await call(p, { headers: { accept: 'text/markdown' } })).text();
    expect(md).toContain('# Thanksgiving\n');
    expect(md).toContain("Dining room is 20' × 12' (240 sq ft) with 1 door and 0 windows.");
    expect(md).toContain('## Errors\n\n- Chair at (11, 6) overlaps Chair at (11.75, 6) by 9".');
    expect(md).toContain(
      "- Small table is in the way of the door on the right wall (7'–10' from the top).",
    );
    expect(md).toContain(
      "- Chair at (17.5, 8.25) is in the way of the door on the right wall (7'–10' from the top).",
    );
    expect(md).toContain('To re-check after changes: ');
    expect(md).not.toContain('](https://');
  });

  it('gives the link as Markdown link text once the plan checks out, and says what it skipped', async () => {
    const ok =
      'ft;room:Bedroom:12x11;door:bottom:end-1:3;item:Queen_bed:5x6.7@6,3.35;item:Desk:4x2:wobbly';
    const md = await (
      await call(`/api/plan?p=${encodeURIComponent(ok)}`, { headers: { accept: 'text/markdown' } })
    ).text();
    expect(md).toContain('## Not understood in the link\n\n- statement 5 (item): "wobbly" ignored');
    const clean = await (
      await call(`/api/plan?p=${encodeURIComponent(ok.replace(':wobbly', ''))}`, {
        headers: { accept: 'text/markdown' },
      })
    ).text();
    expect(clean).toContain('No overlaps, blocked doors or pieces outside the room.');
    expect(clean).toMatch(
      /\[Open Bedroom in Room Planner\]\(https:\/\/room-planner\.andrechek\.com\/#s=[\w-]+\)/,
    );
  });

  it('explains a damaged link in Markdown too', async () => {
    const r = await call('/api/plan?s=AAAA', { headers: { accept: 'text/markdown' } });
    expect(r.status).toBe(422);
    expect(r.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await r.text()).toMatch(
      /^# Room Planner could not read this plan\n\nThe plan in this link is incomplete or damaged/,
    );
  });
});
