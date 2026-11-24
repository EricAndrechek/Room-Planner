import { describe, expect, it } from 'vitest';
import { buildEvents, clientKind, environmentOf, identify, uaFamily } from './analytics';
import { handleMcp, type Env } from './http';

const env = { ASSETS: { fetch: async () => new Response('') } } as unknown as Env;

const bedroom = {
  version: 4,
  name: 'Secret Bedroom Name',
  unit: 'in',
  rooms: [
    {
      id: 'room-1',
      name: 'Private Room Label',
      outline: [
        { x: 0, y: 0 },
        { x: 144, y: 0 },
        { x: 144, y: 132 },
        { x: 0, y: 132 },
      ],
      openings: [{ id: 'door-1', kind: 'door', wall: 2, offset: 12, width: 32 }],
    },
  ],
  items: [
    { id: 'bed', label: 'Grandmas Quilt Bed', width: 60, depth: 80, placement: { x: 72, y: 40 } },
    { id: 'desk', label: 'Desk', width: 48, depth: 24, placement: { x: 110, y: 118 } },
  ],
};

/** Call the endpoint like Workers does, capturing what would be sent to PostHog. */
async function run(
  body: unknown,
  {
    host = 'room-planner.andrechek.com',
    fetchImpl,
    headers = {},
  }: { host?: string; fetchImpl?: typeof fetch; headers?: Record<string, string> } = {},
) {
  const pending: Promise<unknown>[] = [];
  const sent: { url: string; body: string }[] = [];
  const request = new Request(`https://${host}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      'cf-connecting-ip': '198.51.100.23',
      'user-agent': 'claude-user/1.0 (+https://claude.ai)',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  Object.defineProperty(request, 'cf', {
    value: {
      country: 'DE',
      city: 'Berlin',
      regionCode: 'BE',
      latitude: '52.52',
      longitude: '13.40',
      asn: 15169,
      asOrganization: 'Google LLC',
      colo: 'FRA',
      tlsVersion: 'TLSv1.3',
      clientTcpRtt: 12,
    },
  });
  const response = await handleMcp(
    request,
    env,
    { waitUntil: (p) => void pending.push(p) },
    fetchImpl ??
      (async (url, init) => {
        sent.push({ url: String(url), body: String(init?.body) });
        return new Response('{}');
      }),
  );
  await response.text();
  await Promise.all(pending);
  return { response, sent, pending };
}

const callTool = (name: string, args: unknown) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name, arguments: args },
});

describe('MCP usage analytics', () => {
  it('reports a tool call with counts and the IP for location, and no plan content or link', async () => {
    const { sent, response } = await run(callTool('create_plan', { plan: bedroom }));
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://us.i.posthog.com/batch/');
    const raw = sent[0]!.body;
    for (const secret of [
      'Secret Bedroom Name',
      'Private Room Label',
      'Grandmas Quilt Bed',
      'Desk',
      '#s=',
      '"x":',
    ]) {
      expect(raw).not.toContain(secret);
    }
    const { api_key, batch } = JSON.parse(raw);
    expect(api_key).toMatch(/^phc_/);
    expect(batch).toHaveLength(1);
    const e = batch[0];
    expect(e.event).toBe('mcp_tool_called');
    expect(e.distinct_id).toMatch(/^mcp_[0-9a-f]{32}$/);
    expect(e.distinct_id).toBe(
      (
        await identify(
          {},
          {
            ip: '198.51.100.23',
            userAgent: 'claude-user/1.0 (+https://claude.ai)',
            clientName: '',
          },
        )
      ).distinctId,
    );
    expect(e.properties).toMatchObject({
      tool: 'create_plan',
      ok: true,
      error_kind: null,
      rooms: 1,
      items: 2,
      unit: 'in',
      issues_error: 0,
      $process_person_profile: false,
      environment: 'production',
      id_source: 'fallback',
      ua_family: 'claude',
      h_user_agent: 'claude-user/1.0 (+https://claude.ai)',
      h_mcp_protocol_version: '2025-06-18',
      cf_country: 'DE',
      cf_city: 'Berlin',
      cf_region_code: 'BE',
      cf_asn: 15169,
      cf_as_organization: 'Google LLC',
      cf_colo: 'FRA',
      cf_tls_version: 'TLSv1.3',
      client_kind: 'hosted',
      $ip: '198.51.100.23',
      protocol: '2025-06-18',
    });
    expect(e.properties).not.toHaveProperty('$geoip_disable');
    expect(e.properties).not.toHaveProperty('cf_client_tcp_rtt');
    expect(e.properties.issues_warning).toBeGreaterThan(0);
    expect(e.properties.issue_codes).toContain('door_blocked');
  });

  it('reports why a call failed, as a fixed vocabulary', async () => {
    const { sent } = await run(callTool('read_plan', { url: 'https://example.com/#s=AAAA' }));
    const e = JSON.parse(sent[0]!.body).batch[0];
    expect(e.properties).toMatchObject({
      tool: 'read_plan',
      ok: false,
      error_kind: 'damaged_link',
    });
    expect(sent[0]!.body).not.toContain('example.com');
  });

  it('reports initialize with the client name and version, and resource reads', async () => {
    const init = await run({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'claude-ai', version: '0.1.0' },
      },
    });
    expect(JSON.parse(init.sent[0]!.body).batch[0]).toMatchObject({
      event: 'mcp_initialize',
      properties: { client_name: 'claude-ai', client_version: '0.1.0', protocol: '2025-06-18' },
    });
    const read = await run({
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/read',
      params: { uri: 'ui://room-planner/plan-viewer.html' },
    });
    expect(JSON.parse(read.sent[0]!.body).batch[0]).toMatchObject({
      event: 'mcp_resource_read',
      properties: { uri: 'ui://room-planner/plan-viewer.html' },
    });
  });

  it('sends nothing for list calls or in local development, and marks previews', async () => {
    expect((await run({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).sent).toEqual([]);
    expect(
      (await run(callTool('check_layout', { plan: bedroom }), { host: 'localhost' })).sent,
    ).toEqual([]);
    const preview = await run(callTool('check_layout', { plan: bedroom }), {
      host: 'feat-x-room-planner.ericandr.workers.dev',
    });
    expect(JSON.parse(preview.sent[0]!.body).batch[0].properties.environment).toBe('preview');
  });

  it('a failing PostHog never breaks or delays a call', async () => {
    const { response, pending } = await run(callTool('check_layout', { plan: bedroom }), {
      fetchImpl: async () => {
        throw new Error('PostHog is down');
      },
    });
    expect(response.status).toBe(200);
    await expect(Promise.all(pending)).resolves.toBeDefined();
  });

  it('never sends credential headers', async () => {
    const secrets = {
      authorization: 'Bearer sk-live-1',
      'proxy-authorization': 'Basic abc',
      cookie: 'sid=cookie-value',
      'x-api-key': 'key-value',
      'x-auth-token': 'token-value',
      'x-amz-signature': 'sig-value',
      'x-client-secret': 'secret-value',
      'mcp-session-id': 'session-value',
      'x-password': 'pw-value',
    };
    const { sent } = await run(callTool('check_layout', { plan: bedroom }), {
      headers: { ...secrets, 'accept-language': 'de-DE', 'x-very-long': 'v'.repeat(2000) },
    });
    const raw = sent[0]!.body;
    for (const value of Object.values(secrets)) expect(raw).not.toContain(value);
    const props = JSON.parse(raw).batch[0].properties;
    for (const name of Object.keys(secrets)) {
      expect(props).not.toHaveProperty(`h_${name.replace(/-/g, '_')}`);
    }
    expect(props.h_accept_language).toBe('de-DE');
    expect(props.h_x_very_long).toHaveLength(512);
  });

  it('uses a host-provided id when there is one, hashed and prefixed by source', async () => {
    const withMeta = (meta: Record<string, string>) => ({
      ...callTool('check_layout', { plan: bedroom }),
      params: { name: 'check_layout', arguments: { plan: bedroom }, _meta: meta },
    });
    const subject = JSON.parse(
      (await run(withMeta({ 'openai/subject': 'v1/anon-user-7' }))).sent[0]!.body,
    ).batch[0];
    expect(subject.distinct_id).toMatch(/^chatgpt_[0-9a-f]{32}$/);
    expect(subject.properties.id_source).toBe('openai/subject');
    expect(JSON.stringify(subject)).not.toContain('anon-user-7');
    const session = JSON.parse((await run(withMeta({ 'openai/session': 'conv-9' }))).sent[0]!.body)
      .batch[0];
    expect(session.distinct_id).toMatch(/^chatgptsession_/);
    const mcp = JSON.parse(
      (
        await run(callTool('check_layout', { plan: bedroom }), {
          headers: { 'mcp-session-id': 's-1' },
        })
      ).sent[0]!.body,
    ).batch[0];
    expect(mcp.distinct_id).toMatch(/^mcpsession_/);
    expect(mcp.properties.id_source).toBe('mcp-session-id');
  });

  it('the fallback id is stable for one client at one address', async () => {
    const id = (ip: string, ua: string, name: string) =>
      identify({}, { ip, userAgent: ua, clientName: name }).then((r) => r.distinctId);
    const a = await id('203.0.113.1', 'node', 'claude-code');
    expect(await id('203.0.113.1', 'node', 'claude-code')).toBe(a);
    expect(await id('203.0.113.2', 'node', 'claude-code')).not.toBe(a);
    expect(await id('203.0.113.1', 'node', 'cursor')).not.toBe(a);
    expect(await id('203.0.113.1', 'curl', 'claude-code')).not.toBe(a);
  });

  it('tells hosted clients from local ones', () => {
    expect(clientKind('claude-ai', 'claude')).toBe('hosted');
    expect(clientKind('openai-mcp', 'openai')).toBe('hosted');
    expect(clientKind(undefined, 'claude')).toBe('hosted');
    expect(clientKind('claude-code', 'claude-code')).toBe('local');
    expect(clientKind('Visual Studio Code', 'node')).toBe('local');
    expect(clientKind('cursor-vscode', 'node')).toBe('local');
    expect(clientKind(undefined, 'node')).toBe('local');
    expect(clientKind(undefined, 'node', 'Microsoft Corporation')).toBe('hosted');
    expect(clientKind(undefined, 'node', 'Comcast Cable Communications, LLC')).toBe('local');
    expect(clientKind('claude-code', 'node', 'Google LLC')).toBe('local');
  });

  it('classifies environments and user agents', async () => {
    expect(environmentOf('room-planner.andrechek.com')).toBe('production');
    expect(environmentOf('x-room-planner.ericandr.workers.dev')).toBe('preview');
    expect(environmentOf('localhost')).toBe('development');
    expect(uaFamily('Claude-User/1.0')).toBe('claude');
    expect(uaFamily('openai-mcp/1.0.0')).toBe('openai');
    expect(uaFamily('node')).toBe('node');
    expect(uaFamily(null)).toBe('none');
    expect(await buildEvents([], {} as never)).toEqual([]);
  });
});
