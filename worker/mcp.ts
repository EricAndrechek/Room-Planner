/**
 * The MCP server: three tools and the plan viewer (docs/design/plan-format.md, section 7). One
 * factory serves both protocol eras through `createMcpHandler` (index.ts), a fresh server per
 * request: nothing is kept between calls.
 */
import {
  McpServer,
  type CallToolResult,
  type StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { version } from '../package.json';
import { CHECK_LAYOUT, CREATE_PLAN, INSTRUCTIONS, READ_PLAN } from './descriptions';
import { checkPlan, createPlan, planSchema, readPlan, type ToolOutcome } from './tools';
import { VIEW_META_KEY, VIEWER_MIME_TYPE, VIEWER_URI, viewerHtml } from './viewer';

export const SERVER_NAME = 'room-planner';
export const SERVER_TITLE = 'Room Planner';
export const SERVER_VERSION: string = version;
export const SITE = 'https://room-planner.andrechek.com';

/**
 * A tool's input schema as the SDK wants it (a Standard Schema with a JSON Schema). Validation is
 * left to the handler, which reads the plan with `loadPlan(..., 'strict')` and reports every
 * problem with its path; the SDK only checks that the arguments are an object.
 */
const inputSchema = (
  json: () => Record<string, unknown>,
): StandardSchemaWithJSON<Record<string, unknown>> => ({
  '~standard': {
    version: 1,
    vendor: 'room-planner',
    validate: (value: unknown) =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? { value: value as Record<string, unknown> }
        : { issues: [{ message: 'The arguments must be an object.' }] },
    jsonSchema: { input: json, output: json },
  },
});

const object = (properties: Record<string, unknown>, required: string[]) => () => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const planArgs = object({ plan: planSchema() }, ['plan']);
const checkArgs = object(
  {
    plan: planSchema(),
    minClearance: {
      type: 'number',
      minimum: 0,
      description: "Report gaps below this as tight_clearance, in the plan's unit. Default 24 in.",
    },
  },
  ['plan'],
);
const urlArgs = object(
  { url: { type: 'string', description: 'The whole Room Planner link, as the user gave it.' } },
  ['url'],
);

/** The tool result: text for every client, the drawing in `_meta` for the viewer only. */
const toResult = (o: ToolOutcome): CallToolResult => ({
  content: [{ type: 'text', text: o.text }],
  ...(o.structured ? { structuredContent: o.structured } : {}),
  ...(o.isError ? { isError: true } : {}),
  ...(o.view ? { _meta: { [VIEW_META_KEY]: o.view } } : {}),
});

/** `_meta` linking a tool to the viewer (the flat key is the deprecated form older hosts read). */
const withViewer = { ui: { resourceUri: VIEWER_URI }, 'ui/resourceUri': VIEWER_URI };

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** A fresh server for one request. `origin` is the site the links point at. */
export function createServer(origin: string): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: SERVER_TITLE,
      version: SERVER_VERSION,
      websiteUrl: `${SITE}/agents/`,
    },
    { instructions: INSTRUCTIONS, capabilities: { tools: {}, resources: {} } },
  );

  server.registerTool(
    'create_plan',
    {
      title: 'Create a room plan',
      description: CREATE_PLAN,
      inputSchema: inputSchema(planArgs),
      annotations: { title: 'Create a room plan', ...READ_ONLY },
      _meta: withViewer,
    },
    async (args) => toResult(await createPlan(args, origin)),
  );

  server.registerTool(
    'check_layout',
    {
      title: 'Check a room layout',
      description: CHECK_LAYOUT,
      inputSchema: inputSchema(checkArgs),
      annotations: { title: 'Check a room layout', ...READ_ONLY },
    },
    async (args) => toResult(checkPlan(args)),
  );

  server.registerTool(
    'read_plan',
    {
      title: 'Read a Room Planner link',
      description: READ_PLAN,
      inputSchema: inputSchema(urlArgs),
      annotations: { title: 'Read a Room Planner link', ...READ_ONLY },
      _meta: withViewer,
    },
    async (args) => toResult(await readPlan(args, origin)),
  );

  server.registerResource(
    'plan-viewer',
    VIEWER_URI,
    {
      title: 'Room Planner plan viewer',
      description:
        'Shows a plan from create_plan or read_plan: the drawing, its issues, and a button that opens it in Room Planner.',
      mimeType: VIEWER_MIME_TYPE,
      _meta: { ui: { prefersBorder: true } },
      cacheHint: { ttlMs: 3_600_000, cacheScope: 'public' },
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: VIEWER_MIME_TYPE,
          text: viewerHtml(),
          // No csp: the view fetches nothing, so the host's default (no network) is right.
          _meta: { ui: { prefersBorder: true } },
        },
      ],
    }),
  );

  return server;
}
