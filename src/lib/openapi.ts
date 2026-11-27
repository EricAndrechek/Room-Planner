/**
 * /openapi.json (src/pages/openapi.json.ts): the REST API (worker/api.ts) as OpenAPI 3.1, for
 * agents with HTTP but no MCP client, and for ChatGPT Custom GPT Actions. Built at build time from
 * the plan's Zod schema (src/lib/planSchema.ts), so it never drifts from what the API accepts.
 */
import registry from '../../server.json';
import { publishedPlanSchema } from './planSchema';
import { SITE_NAME } from './site';

/** A small plan, the example for every request. */
export const API_EXAMPLE_PLAN = {
  version: 4,
  name: 'Bedroom',
  unit: 'ft',
  rooms: [
    {
      id: 'bedroom',
      name: 'Bedroom',
      outline: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 11 },
        { x: 0, y: 11 },
      ],
      openings: [
        { id: 'door-1', kind: 'door', wall: 2, offset: 1, width: 3 },
        { id: 'window-1', kind: 'window', wall: 0, offset: 4, width: 4 },
      ],
    },
  ],
  items: [
    { id: 'bed', label: 'Queen bed', width: 5, depth: 6.7, placement: { x: 6, y: 3.35 } },
    { id: 'dresser', label: 'Dresser', width: 5, depth: 1.5, placement: { x: 4.5, y: 10.25 } },
  ],
};

const issue = {
  type: 'object',
  required: ['code', 'severity', 'message', 'ids'],
  properties: {
    code: {
      type: 'string',
      enum: [
        'item_overlap',
        'item_outside_room',
        'door_blocked',
        'doorway_blocked',
        'opening_overlap',
        'opening_off_wall',
        'room_overlap',
        'window_between_rooms',
        'tight_clearance',
        'unknown_field',
      ],
    },
    severity: { type: 'string', enum: ['error', 'warning', 'info'] },
    message: { type: 'string', description: 'A full sentence, with names and distances.' },
    ids: {
      type: 'array',
      items: { type: 'string' },
      description: 'The entities concerned: the piece first, then what it collides with.',
    },
  },
};

const planResult = {
  type: 'object',
  required: ['plan', 'issues', 'summary', 'url'],
  properties: {
    plan: {
      $ref: '#/components/schemas/Plan',
      description: 'The plan, normalised (ids and defaults filled), in the unit you sent.',
    },
    issues: { type: 'array', items: { $ref: '#/components/schemas/Issue' } },
    summary: { type: 'string', description: 'One paragraph describing the plan.' },
    url: {
      type: 'string',
      format: 'uri',
      description:
        "The link that opens the plan in Room Planner, saved in the user's browser. Show it as Markdown link text, e.g. [Open your bedroom in Room Planner](url); it holds the whole plan, so pass it on whole.",
    },
    editable: { type: 'boolean', description: 'Always true.' },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description:
        'readPlanLink only, when there are any: what the link said that the planner could not use or changed (a statement it did not understand, a door clamped onto its wall). Fix them in the link.',
    },
  },
};

const problem = {
  type: 'object',
  description: 'RFC 9457 problem details.',
  required: ['title', 'status', 'detail', 'error_kind'],
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'integer' },
    detail: { type: 'string', description: 'What went wrong and how to fix it.' },
    error_kind: { type: 'string' },
    errors: {
      type: 'array',
      items: { type: 'string' },
      description: 'For an invalid plan: one line per problem, `plan.path: message`.',
    },
  },
};

const problemResponse = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
});

const errors = {
  '400': problemResponse('The request could not be read: not JSON, no plan, or a bad parameter.'),
  '422': problemResponse('The plan is not valid (see `errors`), or the link is damaged.'),
  '429': problemResponse('Too many requests from this address (120 a minute); wait and retry.'),
};

const planBody = {
  required: true,
  description:
    'A plan (version 4), or `{"plan": <plan>}`. Lengths are in `unit`; x grows right, y grows down. See /llms.txt for the format in a few lines.',
  content: {
    'application/json': {
      schema: {
        oneOf: [
          { $ref: '#/components/schemas/Plan' },
          {
            type: 'object',
            required: ['plan'],
            properties: { plan: { $ref: '#/components/schemas/Plan' } },
          },
        ],
      },
      example: API_EXAMPLE_PLAN,
    },
  },
};

export function openApiSpec(site: string): Record<string, unknown> {
  const origin = new URL('/', site).toString().replace(/\/$/, '');
  const { $schema: _s, $id: _i, ...plan } = publishedPlanSchema(site);
  return {
    openapi: '3.1.0',
    info: {
      title: `${SITE_NAME} API`,
      // The MCP server's version (server.json): one version for every description of the service.
      version: registry.version,
      summary: 'Lay out rooms and furniture, check the layout, and get a link that opens the plan.',
      description:
        `Free, no account and no key. The same operations as ${SITE_NAME}'s MCP server (${origin}/mcp). ` +
        'Write a plan, call checkLayout and fix every error and warning (move the pieces it names) until there are none, then createPlanLink, and give the user the link as Markdown link text, never the bare URL. ' +
        'An assistant that can only open web pages checks a link it wrote with GET /api/plan?url=<the link, URL-encoded> (or ?p=<the text after #p=>), which answers it in Markdown. ' +
        'Nothing is stored: every call takes the whole plan. Limit: 120 requests a minute per address. ' +
        `Privacy: ${origin}/privacy/.`,
      contact: {
        name: 'Room Planner on GitHub',
        url: 'https://github.com/EricAndrechek/Room-Planner/issues',
      },
      license: { name: 'MIT', identifier: 'MIT' },
    },
    servers: [{ url: origin }],
    externalDocs: { description: 'For AI assistants', url: `${origin}/agents/` },
    paths: {
      '/api/plan/check': {
        post: {
          operationId: 'checkLayout',
          summary: 'Check a plan for layout problems',
          description:
            "Overlapping pieces, pieces outside every room, furniture in a door's swing or doorway, overlapping rooms, windows between rooms, and gaps from 6 in up to minClearance (info: too narrow to walk through). Cheap: call it while arranging. ok is true when nothing is an error or a warning.",
          requestBody: {
            ...planBody,
            content: {
              'application/json': {
                ...planBody.content['application/json'],
                schema: {
                  oneOf: [
                    { $ref: '#/components/schemas/Plan' },
                    {
                      type: 'object',
                      required: ['plan'],
                      properties: {
                        plan: { $ref: '#/components/schemas/Plan' },
                        minClearance: {
                          type: 'number',
                          minimum: 0,
                          description:
                            "Report gaps from 6 in (15 cm) up to this as tight_clearance, in the plan's unit. Default 24 in.",
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'The issues.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['ok', 'issues', 'summary'],
                    properties: {
                      ok: { type: 'boolean' },
                      issues: { type: 'array', items: { $ref: '#/components/schemas/Issue' } },
                      summary: { type: 'string' },
                    },
                  },
                },
              },
            },
            ...errors,
          },
        },
      },
      '/api/plan/link': {
        post: {
          operationId: 'createPlanLink',
          summary: 'Check a plan and make the link that opens it in Room Planner',
          description:
            'Returns the normalised plan, its issues, a summary and the url. The url opens the plan in the browser, where the user can drag, rotate, measure, export and share it. Several rooms, any room shape, L-shaped and round pieces, and pieces set aside (no placement) are all supported.',
          requestBody: planBody,
          responses: {
            '200': {
              description: 'The plan and its link.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/PlanResult' } },
              },
            },
            ...errors,
          },
        },
      },
      '/api/plan': {
        get: {
          operationId: 'readPlanLink',
          summary: 'Read and check the plan in a Room Planner link',
          description:
            'Give url (any Room Planner link, URL-encoded), or the part after #s= or #p= of one. Returns the plan in the unit it is shown in, its issues, what the link said that could not be used (notes), and a fresh link, ready to change and send to createPlanLink. ' +
            'An assistant that can only open web pages checks a link it wrote here before giving it to the user: with Accept: text/markdown, or from an assistant fetcher (ChatGPT-User, Claude-User, Perplexity-User), the answer is Markdown: the issues by severity, naming pieces and where they are, and the link once nothing is wrong.',
          parameters: [
            {
              name: 'url',
              in: 'query',
              schema: { type: 'string' },
              description: 'The whole Room Planner link.',
            },
            {
              name: 's',
              in: 'query',
              schema: { type: 'string' },
              description: 'The text after #s= in a link.',
            },
            {
              name: 'p',
              in: 'query',
              schema: { type: 'string' },
              description: 'The text after #p= in a link.',
            },
          ],
          responses: {
            '200': {
              description: 'The plan in the link.',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/PlanResult' } },
                // For Accept: text/markdown and assistant fetchers.
                'text/markdown': { schema: { type: 'string' } },
              },
            },
            ...errors,
          },
        },
      },
    },
    components: {
      schemas: { Plan: plan, Issue: issue, PlanResult: planResult, Problem: problem },
    },
  };
}
