/**
 * The Worker's pages: @wave-rf/cloudflare-md-router composed with the MCP server and the API
 * (index.ts). Markdown to `Accept: text/markdown` and to LLM crawlers, HTML to everyone else with
 * a `Link` to the twin, the API pointers added on / and /agents/, and /mcp and /api untouched.
 */
import { describe, expect, it } from 'vitest';
import worker from './index';
import type { Env } from './http';

const ORIGIN = 'https://room-planner.andrechek.com';

/** Assets: HTML pages and Markdown twins, as dist/ has them (no twin for /no-twin/). */
const FILES: Record<string, [string, string]> = {
  '/': ['<!doctype html><title>Home</title>', 'text/html; charset=utf-8'],
  '/index.md': ['# Room Planner', 'text/markdown; charset=utf-8'],
  '/agents/': ['<!doctype html><title>Agents</title>', 'text/html; charset=utf-8'],
  '/agents.md': ['# Use Room Planner from an AI assistant', 'text/markdown; charset=utf-8'],
  '/faq/': ['<!doctype html><title>FAQ</title>', 'text/html; charset=utf-8'],
  '/faq.md': ['# FAQ', 'text/markdown; charset=utf-8'],
  '/no-twin/': ['<!doctype html><title>No twin</title>', 'text/html; charset=utf-8'],
};

const env = (): Env & { fetched: string[] } => {
  const fetched: string[] = [];
  return {
    fetched,
    ASSETS: {
      fetch: async (input: Request | string) => {
        const path = new URL(typeof input === 'string' ? input : input.url).pathname;
        fetched.push(path);
        const file = FILES[path];
        return file
          ? new Response(file[0], {
              headers: { 'Content-Type': file[1], 'Content-Security-Policy': "default-src 'self'" },
            })
          : new Response('not found', { status: 404, headers: { 'Content-Type': 'text/html' } });
      },
    } as unknown as Fetcher,
    MCP_LIMIT: { limit: async () => ({ success: true }) } as RateLimit,
  };
};

const get = (path: string, headers: Record<string, string> = {}, e: Env = env()) =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, { headers }),
    e,
    undefined as unknown as ExecutionContext,
  );

describe('pages through the Markdown router', () => {
  it('serves the Markdown twin to Accept: text/markdown, with Vary: Accept', async () => {
    const r = await get('/faq/', { accept: 'text/markdown' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/markdown/);
    expect(await r.text()).toBe('# FAQ');
    expect(r.headers.get('vary')).toContain('Accept');
  });

  it('serves the twin to an LLM crawler, and the HTML page to a search crawler', async () => {
    const bot = await get('/faq/', { 'user-agent': 'Mozilla/5.0 (compatible; GPTBot/1.2)' });
    expect(await bot.text()).toBe('# FAQ');
    const google = await get('/faq/', {
      'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    });
    expect(google.headers.get('content-type')).toMatch(/^text\/html/);
  });

  it('serves a browser the HTML, its headers kept, with a Link to the twin', async () => {
    const r = await get('/faq/', {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0',
    });
    expect(r.headers.get('content-type')).toMatch(/^text\/html/);
    expect(r.headers.get('content-security-policy')).toBe("default-src 'self'");
    expect(r.headers.get('link')).toBe('</faq.md>; rel="alternate"; type="text/markdown"');
    // No Vary: Accept on HTML: the service worker's precache would never match a navigation.
    expect(r.headers.get('vary')).toBeNull();
  });

  it('adds the API pointers on / and /agents/ to the twin link, not instead of it', async () => {
    for (const [path, md] of [
      ['/', '/index.md'],
      ['/agents/', '/agents.md'],
    ] as const) {
      const link = (await get(path)).headers.get('link')!;
      expect(link).toContain(`<${md}>; rel="alternate"; type="text/markdown"`);
      expect(link).toContain(
        '</openapi.json>; rel="service-desc"; type="application/openapi+json"',
      );
      expect(link).toContain('</.well-known/api-catalog>; rel="api-catalog"');
      expect(link.match(/text\/markdown/g)).toHaveLength(1);
    }
    expect((await get('/faq/')).headers.get('link')).not.toContain('api-catalog');
    // Markdown answers carry no page pointers.
    expect((await get('/agents/', { accept: 'text/markdown' })).headers.get('link')).toBeNull();
  });

  it('falls back to the HTML page when a page has no twin', async () => {
    const r = await get('/no-twin/', { accept: 'text/markdown' });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/html/);
    expect(r.headers.get('vary')).toBeNull();
  });

  it('leaves /mcp and /api to their handlers, whatever the Accept', async () => {
    const e = env();
    const card = await get('/mcp/server-card', { accept: 'text/markdown' }, e);
    expect(card.headers.get('content-type')).toBe('application/mcp-server-card+json');
    const api = await get('/api/plan', { accept: 'text/markdown' }, e);
    expect(api.status).toBe(400);
    expect(api.headers.get('content-type')).toBe('application/problem+json');
    expect(e.fetched).toEqual([]);
  });
});
