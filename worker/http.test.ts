/**
 * The MCP endpoint through its HTTP handler, as a client sees it: both protocol eras (2025-era
 * stateless `initialize`, and 2026-07-28 with no handshake) with the official client, plus the
 * HTTP details (CORS, 404/405/413/429, the server card).
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { readPlanLink } from '../src/core/share/plan';
import worker from './index';
import { MAX_BODY, type Env } from './http';
import catalog from '../public/.well-known/ai-catalog.json';
import server from '../server.json';
import { VIEW_META_KEY, VIEWER_MIME_TYPE, VIEWER_URI } from './viewer';

const ORIGIN = 'https://room-planner.andrechek.com';

/** An Env whose rate limit allows `allowed` requests, and assets that answer 404. */
const env = (allowed = Infinity): Env & { calls: string[] } => {
  const calls: string[] = [];
  let used = 0;
  return {
    calls,
    ASSETS: { fetch: async () => new Response('asset', { status: 404 }) } as unknown as Fetcher,
    MCP_LIMIT: {
      limit: async ({ key }: { key: string }) => {
        calls.push(key);
        return { success: ++used <= allowed };
      },
    } as RateLimit,
  };
};

const call = (request: Request, e: Env = env()) => worker.fetch(request, e);

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'cf-connecting-ip': '203.0.113.7',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const ERAS = [
  { name: '2025-era (initialize, stateless)', mode: 'legacy' as const },
  { name: '2026-07-28 (no handshake)', mode: { pin: '2026-07-28' } },
];

/** What the client sent: each request's JSON-RPC method and MCP-Protocol-Version header. */
let sent: { method: string; version: string | null }[] = [];

const connect = async (mode: 'legacy' | { pin: string }) => {
  const e = env();
  sent = [];
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    fetch: async (input, init) => {
      const request = new Request(input as RequestInfo, init);
      const body = (request.method === 'POST' ? await request.clone().json() : {}) as {
        method: string;
      };
      sent.push({ method: body.method, version: request.headers.get('mcp-protocol-version') });
      return call(request, e);
    },
  });
  const client = new Client({ name: 'test', version: '1.0.0' }, { versionNegotiation: { mode } });
  await client.connect(transport);
  return client;
};

const bedroom = {
  version: 4,
  name: 'Bedroom',
  unit: 'in',
  rooms: [
    {
      id: 'room-1',
      outline: [
        { x: 0, y: 0 },
        { x: 144, y: 0 },
        { x: 144, y: 132 },
        { x: 0, y: 132 },
      ],
      openings: [
        { id: 'door-1', kind: 'door', wall: 2, offset: 12, width: 32 },
        { id: 'window-1', kind: 'window', wall: 0, offset: 48, width: 48 },
      ],
    },
  ],
  items: [
    { id: 'bed', label: 'Queen bed', width: 60, depth: 80, placement: { x: 72, y: 40 } },
    { id: 'desk', label: 'Desk', width: 48, depth: 24, placement: { x: 110, y: 118 } },
  ],
};

const textOf = (r: { content?: unknown }) =>
  ((r.content ?? []) as { type: string; text?: string }[])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

describe.each(ERAS)('MCP over $name', ({ mode }) => {
  it('speaks the era it claims', async () => {
    const client = await connect(mode);
    await client.listTools();
    const methods = sent.map((m) => m.method);
    if (mode === 'legacy') {
      expect(methods[0]).toBe('initialize');
    } else {
      expect(methods).not.toContain('initialize');
      expect(sent.at(-1)!.version).toBe('2026-07-28');
    }
  });

  it('lists the three tools with their schemas and the viewer link', async () => {
    const client = await connect(mode);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['check_layout', 'create_plan', 'read_plan']);
    const create = tools.find((t) => t.name === 'create_plan')!;
    expect(create.inputSchema.required).toEqual(['plan']);
    const plan = (create.inputSchema.properties as Record<string, Record<string, unknown>>).plan!;
    expect(plan.required).toEqual(['version', 'unit', 'rooms']);
    expect(create.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(create._meta).toMatchObject({ ui: { resourceUri: VIEWER_URI } });
    expect(create.description).toContain('clockwise');
    expect(tools.find((t) => t.name === 'check_layout')!._meta?.ui).toBeUndefined();
  });

  it('create_plan returns the plan in the agent unit, the issues, a summary and a link', async () => {
    const client = await connect(mode);
    const r = await client.callTool({ name: 'create_plan', arguments: { plan: bedroom } });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent as {
      plan: { unit: string; items: { placement: { x: number } }[] };
      issues: { code: string; ids: string[] }[];
      url: string;
      summary: string;
    };
    expect(s.plan.unit).toBe('in');
    expect(s.plan.items[0]!.placement.x).toBe(72);
    expect(s.issues.map((i) => i.code)).toContain('door_blocked');
    expect(s.summary).toContain('144 in × 132 in');
    expect(s.url.startsWith(`${ORIGIN}/#s=`)).toBe(true);
    // The link is alone on the last line of the text.
    expect(textOf(r).split('\n').at(-1)).toBe(s.url);
    // The drawing goes to the viewer only.
    const view = (r._meta as Record<string, { svg: string; url: string }>)[VIEW_META_KEY]!;
    expect(view.svg).toContain('data-id="desk"');
    expect(view.url).toBe(s.url);
    const opened = await readPlanLink(s.url);
    expect(opened.ok && opened.plan.items.length).toBe(2);
  });

  it('create_plan reports an invalid plan with paths, as a tool error', async () => {
    const client = await connect(mode);
    const bad = { ...bedroom, unit: 'yards', rooms: [{ ...bedroom.rooms[0], outline: [] }] };
    const r = await client.callTool({ name: 'create_plan', arguments: { plan: bad } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('plan.unit:');
    expect(textOf(r)).toContain('plan.rooms.0.outline:');
  });

  it('create_plan says what to change for a plan the app cannot open yet', async () => {
    const client = await connect(mode);
    const two = {
      ...bedroom,
      rooms: [
        bedroom.rooms[0],
        {
          id: 'hall',
          outline: [
            { x: 144, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 50 },
            { x: 144, y: 50 },
          ],
        },
      ],
    };
    const r = await client.callTool({ name: 'create_plan', arguments: { plan: two } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain('2 rooms');
  });

  it('check_layout returns ok and issues, with minClearance in the plan unit', async () => {
    const client = await connect(mode);
    const r = await client.callTool({
      name: 'check_layout',
      arguments: { plan: bedroom, minClearance: 1 },
    });
    const s = r.structuredContent as { ok: boolean; issues: { code: string }[] };
    expect(s.ok).toBe(false);
    expect(s.issues.some((i) => i.code === 'tight_clearance')).toBe(false);
    expect(r._meta?.[VIEW_META_KEY]).toBeUndefined();
    const bad = await client.callTool({
      name: 'check_layout',
      arguments: { plan: { version: 9 } },
    });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain('version 9');
  });

  it('read_plan reads a link, and explains a damaged one', async () => {
    const client = await connect(mode);
    const made = await client.callTool({ name: 'create_plan', arguments: { plan: bedroom } });
    const url = (made.structuredContent as { url: string }).url;
    const r = await client.callTool({ name: 'read_plan', arguments: { url } });
    const s = r.structuredContent as { plan: { unit: string; rooms: unknown[] } };
    expect(s.plan.unit).toBe('in');
    expect(s.plan.rooms).toHaveLength(1);
    const cut = await client.callTool({ name: 'read_plan', arguments: { url: url.slice(0, 60) } });
    expect(cut.isError).toBe(true);
    expect(textOf(cut)).toContain('damaged');
  });

  it('serves the viewer as an MCP Apps resource', async () => {
    const client = await connect(mode);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual([VIEWER_URI]);
    const r = await client.readResource({ uri: VIEWER_URI });
    const c = r.contents[0] as { mimeType: string; text: string };
    expect(c.mimeType).toBe(VIEWER_MIME_TYPE);
    expect(c.text).toContain('ui/initialize');
    expect(c.text).not.toMatch(/<script[^>]+src=|<link[^>]+href=|https?:\/\/(?!www\.w3\.org)/);
  });
});

describe('HTTP', () => {
  it('answers a CORS preflight for any origin', async () => {
    const r = await call(
      new Request(`${ORIGIN}/mcp`, {
        method: 'OPTIONS',
        headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' },
      }),
    );
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('access-control-allow-methods')).toContain('POST');
    expect(r.headers.get('access-control-allow-headers')).toBe('*');
  });

  it('sets CORS and no-store on MCP responses', async () => {
    const r = await call(post({ jsonrpc: '2.0', id: 1, method: 'ping' }));
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers GET, DELETE and PUT on /mcp with 405', async () => {
    for (const method of ['GET', 'DELETE', 'PUT']) {
      const r = await call(new Request(`${ORIGIN}/mcp`, { method }));
      expect(r.status, method).toBe(405);
      expect(r.headers.get('allow')).toBe('POST, OPTIONS');
    }
  });

  it('answers unknown paths under /mcp/ with 404', async () => {
    const r = await call(new Request(`${ORIGIN}/mcp/nope`));
    expect(r.status).toBe(404);
  });

  it('passes anything else to the assets', async () => {
    const r = await call(new Request(`${ORIGIN}/not-mcp`));
    expect(await r.text()).toBe('asset');
  });

  it('rejects a body over the limit with 413', async () => {
    const r = await call(
      post(`{"jsonrpc":"2.0","id":1,"method":"ping","x":"${'a'.repeat(MAX_BODY)}"}`),
    );
    expect(r.status).toBe(413);
  });

  it('rate limits per client address with 429, Retry-After and a JSON-RPC error', async () => {
    const e = env(2);
    const ping = () => call(post({ jsonrpc: '2.0', id: 1, method: 'ping' }), e);
    expect((await ping()).status).toBe(200);
    expect((await ping()).status).toBe(200);
    const r = await ping();
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await r.json()) as { jsonrpc: string; error: { message: string } };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error.message).toMatch(/Too many requests/);
    expect(e.calls).toEqual(['203.0.113.7', '203.0.113.7', '203.0.113.7']);
  });

  it('serves the server card', async () => {
    const r = await call(new Request(`${ORIGIN}/mcp/server-card`));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/mcp-server-card+json');
    const card = (await r.json()) as {
      name: string;
      description: string;
      remotes: { url: string; supportedProtocolVersions: string[] }[];
    };
    expect(card.name).toBe('io.github.EricAndrechek/room-planner');
    expect(card.description.length).toBeLessThanOrEqual(100);
    expect(card.remotes[0]!.url).toBe(`${ORIGIN}/mcp`);
    expect(
      (card.remotes[0] as { supportedProtocolVersions: string[] }).supportedProtocolVersions,
    ).toEqual(expect.arrayContaining(['2026-07-28', '2025-06-18']));
  });
});

describe('registry entry', () => {
  it('server.json and the AI Catalog agree with the server card', async () => {
    const card = (await (await call(new Request(`${ORIGIN}/mcp/server-card`))).json()) as Record<
      string,
      unknown
    >;
    expect(server.name).toBe(card.name);
    expect(server.version).toBe(card.version);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.remotes[0].url).toBe(`${ORIGIN}/mcp`);
    expect(catalog.entries[0].url).toBe(`${ORIGIN}/mcp/server-card`);
  });
});
