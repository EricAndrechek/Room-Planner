/**
 * `/.well-known/search` through the Worker, with an index built from two small pages
 * (scripts/search.mjs) and served by a fake assets binding.
 */
import { describe, expect, it } from 'vitest';
import { buildSearchIndex, search, tokenize } from '../scripts/search.mjs';
import worker from './index';
import type { Env } from './http';

const ORIGIN = 'https://room-planner.andrechek.com';

const INDEX = buildSearchIndex([
  {
    url: `${ORIGIN}/faq/`,
    title: 'Frequently asked questions',
    markdown:
      '# Frequently asked questions\n\nShort answers.\n\n## Is Room Planner free?\n\nYes. Every feature is free.\n\n## Does it work offline?\n\nYes, once installed.\n',
  },
  {
    url: `${ORIGIN}/guides/bedroom-layout/`,
    title: 'Bedroom layout guide',
    markdown:
      '# Bedroom layout guide\n\n## Standard mattress sizes\n\nA queen bed is 60 × 80 in.\n\n### King\n\nA king bed is 76 × 80 in.\n',
  },
]);

/** Assets that serve the index at /search-index.json (and nothing else). */
const env = (): Env => ({
  ASSETS: {
    fetch: async (input: URL | Request) =>
      new URL(input instanceof Request ? input.url : input).pathname === '/search-index.json'
        ? Response.json(INDEX)
        : new Response('missing', { status: 404 }),
  } as unknown as Fetcher,
});

const call = (request: Request, e: Env = env()) =>
  worker.fetch(request, e, undefined as unknown as ExecutionContext);

describe('search index', () => {
  it('folds case, accents and plurals and drops stop words', () => {
    expect(tokenize('The Beds of Café, 12×11')).toEqual(['bed', 'cafe', '12', '11']);
  });

  it('ranks the matching section first, sub-headings flattened', () => {
    const hits = search(INDEX, 'queen bed');
    expect(hits[0]!.doc.h).toBe('Standard mattress sizes');
    expect(hits[0]!.score).toBe(1);
    expect(hits[0]!.doc.x).toContain('**King**');
    expect(search(INDEX, 'zebra')).toEqual([]);
  });
});

describe('/.well-known/search', () => {
  it('answers GET ?q= in Markdown, with the results heading and Accept-Query', async () => {
    const r = await call(new Request(`${ORIGIN}/.well-known/search?q=is+it+free`));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(r.headers.get('accept-query')).toBe('text/plain, application/json');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    const text = await r.text();
    expect(text).toMatch(
      /^# Search results for: "is it free"\n\n## \[Frequently asked questions: Is Room Planner free\?\]\(https:\/\/room-planner\.andrechek\.com\/faq\/\) \(score: 1\.000\)/,
    );
  });

  it('answers QUERY with a text or JSON body', async () => {
    for (const [type, body] of [
      ['text/plain', 'offline'],
      ['application/json', '{"q":"offline"}'],
    ] as const) {
      const r = await call(
        new Request(`${ORIGIN}/.well-known/search`, {
          method: 'QUERY',
          headers: { 'content-type': type },
          body,
        }),
      );
      expect(r.status, type).toBe(200);
      expect(await r.text()).toContain('Does it work offline?');
    }
  });

  it('says so when nothing matches, and asks for a query when there is none', async () => {
    const none = await call(new Request(`${ORIGIN}/.well-known/search?q=zebra`));
    expect(none.status).toBe(200);
    expect(await none.text()).toContain('No results.');
    const empty = await call(new Request(`${ORIGIN}/.well-known/search`));
    expect(empty.status).toBe(400);
    expect(empty.headers.get('content-type')).toMatch(/^text\/markdown/);
  });

  it('is 405 for other methods and 204 for a preflight', async () => {
    const del = await call(new Request(`${ORIGIN}/.well-known/search?q=x`, { method: 'DELETE' }));
    expect(del.status).toBe(405);
    expect(del.headers.get('allow')).toContain('QUERY');
    const pre = await call(new Request(`${ORIGIN}/.well-known/search`, { method: 'OPTIONS' }));
    expect(pre.status).toBe(204);
  });
});
