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
import registry from '../server.json';
import { CHECK_LAYOUT, CREATE_PLAN, INSTRUCTIONS, READ_PLAN } from './descriptions';
import type { Activity } from './analytics';
import { checkPlan, createPlan, planSchema, readPlan, type ToolOutcome } from './tools';
import { VIEWER_MIME_TYPE, VIEWER_URI, viewerHtml } from './viewer';

export const SERVER_NAME = 'room-planner';
/**
 * Who the server is, from server.json (the MCP Registry entry), the one source for the name,
 * version, title, description, website and icons that `initialize`, the server card and the
 * registry all show. A release bumps `version` there (docs/DEPLOY.md).
 */
export const REGISTRY_NAME: string = registry.name;
export const SERVER_TITLE: string = registry.title;
export const SERVER_VERSION: string = registry.version;
export const SERVER_DESCRIPTION: string = registry.description;
export const WEBSITE_URL: string = registry.websiteUrl;
export const SERVER_ICONS = registry.icons.map((i) => ({ ...i, sizes: [...i.sizes] }));
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

/** The tool result: text for every client, structured data for agents and the viewer. */
const toResult = (o: ToolOutcome): CallToolResult => ({
  content: [{ type: 'text', text: o.text }],
  ...(o.structured ? { structuredContent: o.structured } : {}),
  ...(o.isError ? { isError: true } : {}),
});

/** `_meta` linking a tool to the viewer (the flat key is the deprecated form older hosts read). */
const withViewer = { ui: { resourceUri: VIEWER_URI }, 'ui/resourceUri': VIEWER_URI };

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * A fresh server for one request. `origin` is the site the links point at; `record` hears what
 * each call did, for usage analytics (analytics.ts).
 */
export function createServer(origin: string, record: (a: Activity) => void = () => {}): McpServer {
  /** A tool handler that also reports its outcome. */
  const tool =
    <A>(name: string, run: (args: A) => ToolOutcome | Promise<ToolOutcome>) =>
    async (args: A): Promise<CallToolResult> => {
      const start = Date.now();
      try {
        const outcome = await run(args);
        record({
          kind: 'tool',
          tool: name,
          ok: !outcome.isError,
          stats: outcome.stats,
          durationMs: Date.now() - start,
        });
        return toResult(outcome);
      } catch (error) {
        record({ kind: 'tool_failed', tool: name, durationMs: Date.now() - start });
        throw error;
      }
    };

  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: SERVER_TITLE,
      version: SERVER_VERSION,
      description: SERVER_DESCRIPTION,
      websiteUrl: WEBSITE_URL,
      icons: SERVER_ICONS,
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
    tool('create_plan', (args: Record<string, unknown>) => createPlan(args, origin)),
  );

  server.registerTool(
    'check_layout',
    {
      title: 'Check a room layout',
      description: CHECK_LAYOUT,
      inputSchema: inputSchema(checkArgs),
      annotations: { title: 'Check a room layout', ...READ_ONLY },
    },
    tool('check_layout', (args: Record<string, unknown>) => checkPlan(args)),
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
    tool('read_plan', (args: Record<string, unknown>) => readPlan(args, origin)),
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
    async (uri) => {
      record({ kind: 'resource', uri: uri.href });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: VIEWER_MIME_TYPE,
            text: viewerHtml(),
            // No csp: the view fetches nothing, so the host's default (no network) is right.
            _meta: { ui: { prefersBorder: true } },
          },
        ],
      };
    },
  );

  return server;
}
