/**
 * Warm-up while the isolate starts (docs/design/plan-format.md, section 7, "CPU per request").
 *
 * Workers Free allows 10 ms of CPU per request. A warm call costs 1 to 3 ms, but the first request
 * an isolate serves also pays for everything done lazily the first time: Zod building its parsers
 * for the SDK's message schemas, the JSON Schema of the plan, the font metrics and date formatting
 * of the drawing, and V8 compiling each function on its first call. Global scope runs once per
 * isolate, before any request, under its own start-up limit, so this module runs one of each
 * piece there, synchronously (asynchronous work is not allowed in global scope). It never throws.
 */
import { specTypeSchemas } from '@modelcontextprotocol/server';
import { checkLayout } from '../src/core/check';
import { createServer } from './mcp';
import { planDrawing, planSchema, readPlanInput, summarize, unknownFields } from './tools';

const SAMPLE = {
  version: 4,
  name: 'Warm-up',
  unit: 'in',
  rooms: [
    {
      id: 'room-1',
      outline: [
        { x: 0, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 96 },
        { x: 0, y: 96 },
      ],
      openings: [
        { id: 'door-1', kind: 'door', wall: 2, offset: 10, width: 32 },
        { id: 'window-1', kind: 'window', wall: 0, offset: 30, width: 36 },
      ],
    },
  ],
  items: [
    { id: 'a', label: 'Bed', width: 60, depth: 80, placement: { x: 40, y: 40 } },
    { id: 'b', label: 'Desk', width: 48, depth: 24, placement: { x: 90, y: 80, rotation: 90 } },
  ],
};

const validate = (name: string, value: unknown) =>
  (specTypeSchemas as Record<string, { '~standard': { validate(v: unknown): unknown } }>)[name]?.[
    '~standard'
  ].validate(value);

export function warmUp(): void {
  try {
    planSchema();
    const input = readPlanInput(SAMPLE);
    if (input.ok) {
      unknownFields(SAMPLE);
      const issues = checkLayout(input.plan, { unitSystem: input.unitSystem });
      const summary = summarize(input.plan, input.unitSystem);
      planDrawing(input.plan, input.unitSystem);
      createServer('https://room-planner.andrechek.com');
      const call = { name: 'check_layout', arguments: { plan: SAMPLE } };
      validate('JSONRPCRequest', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: call });
      validate('CallToolRequest', { method: 'tools/call', params: call });
      validate('ListToolsRequest', { method: 'tools/list', params: {} });
      validate('ReadResourceRequest', { method: 'resources/read', params: { uri: 'ui://x' } });
      validate('InitializeRequest', {
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'x', version: '1' },
        },
      });
      validate('JSONRPCNotification', { jsonrpc: '2.0', method: 'notifications/initialized' });
      const result = {
        content: [{ type: 'text', text: summary }],
        structuredContent: { ok: false, issues, summary },
        _meta: { 'com.andrechek.room-planner/view': { title: 'x' } },
      };
      validate('CallToolResult', result);
      validate('JSONRPCResultResponse', { jsonrpc: '2.0', id: 1, result });
      validate('ListToolsResult', {
        tools: [{ name: 'x', inputSchema: { type: 'object', properties: { plan: planSchema() } } }],
      });
      validate('ReadResourceResult', {
        contents: [{ uri: 'ui://x', mimeType: 'text/html;profile=mcp-app', text: '<p></p>' }],
      });
      validate('InitializeResult', {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'x', version: '1' },
      });
    }
  } catch {
    // Warm-up is an optimisation only.
  }
}
