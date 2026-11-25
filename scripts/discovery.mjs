// Discovery for agents (docs/DEPLOY.md, "Discovery for agents"): the one place that decides which
// pages have a Markdown twin, and what the discovery files say: /.well-known/api-catalog,
// security.txt, the AI catalog (ai-catalog.json and ard.json), the MCP server card, the Agent
// Skills index, poppy.json and the Search for Agents pointers. Used by the build
// (scripts/llms-full.mjs), the page head (src/layouts/Base.astro), robots.txt, the Worker, IndexNow
// and the discovery e2e, so the URLs and versions in every file come from the same place: the site
// origin (astro.config.mjs SITE_URL) and server.json.
import serverJson from '../server.json' with { type: 'json' };

/** server.json: the MCP server's name, version and repository, everywhere they are shown. */
export const registry = serverJson;

/** Pages with a Markdown twin (besides each guide, /guides/<slug>/). */
export const MARKDOWN_PAGES = [
  '',
  'faq/',
  'help/',
  'agents/',
  'privacy/',
  'support/',
  'terms/',
  'guides/',
];

const GUIDE = /^guides\/[^/]+\/$/;

/**
 * The Markdown twin of a page path (no leading slash: `faq/`), or null: `/faq/` -> `/faq.md`, `/`
 * -> `/index.md`, `/guides/bedroom-layout/` -> `/guides/bedroom-layout.md`.
 * @param {string} path
 */
export function markdownPath(path) {
  const p = path.replace(/^\/+/, '');
  if (!MARKDOWN_PAGES.includes(p) && !GUIDE.test(p)) return null;
  return p === '' ? '/index.md' : `/${p.replace(/\/$/, '')}.md`;
}

/** Discovery URLs relative to the site (without the origin). */
export const PATHS = {
  mcp: '/mcp',
  serverCard: '/mcp/server-card',
  serverCardWellKnown: '/.well-known/mcp/server-card.json',
  openapi: '/openapi.json',
  planSchema: '/plan.schema.json',
  api: '/api/',
  apiCatalog: '/.well-known/api-catalog',
  aiCatalog: '/.well-known/ai-catalog.json',
  ard: '/.well-known/ard.json',
  agentSkills: '/.well-known/agent-skills/index.json',
  skill: '/.well-known/agent-skills/room-planner/SKILL.md',
  search: '/.well-known/search',
  searchIndex: '/search-index.json',
  poppy: '/.well-known/poppy.json',
  security: '/.well-known/security.txt',
  agents: '/agents/',
  llms: '/llms.txt',
  llmsFull: '/llms-full.txt',
  privacy: '/privacy/',
  terms: '/terms/',
  support: '/support/',
};

/**
 * RFC 9727 API catalog (an RFC 9264 linkset): the REST API and the MCP server, each with its
 * description and documentation.
 * @param {string} origin e.g. `https://room-planner.andrechek.com`
 */
export function apiCatalog(origin) {
  const u = (p) => `${origin}${p}`;
  const doc = [
    { href: u(PATHS.agents), type: 'text/html' },
    { href: u('/agents.md'), type: 'text/markdown' },
  ];
  return {
    linkset: [
      {
        anchor: u(PATHS.apiCatalog),
        item: [{ href: u(PATHS.api) }, { href: u(PATHS.mcp) }],
      },
      {
        anchor: u(PATHS.api),
        'service-desc': [{ href: u(PATHS.openapi), type: 'application/openapi+json' }],
        'service-doc': doc,
        describedby: [{ href: u(PATHS.planSchema), type: 'application/schema+json' }],
        'terms-of-service': [{ href: u(PATHS.terms) }],
        'privacy-policy': [{ href: u(PATHS.privacy) }],
      },
      {
        anchor: u(PATHS.mcp),
        'service-desc': [{ href: u(PATHS.serverCard), type: 'application/mcp-server-card+json' }],
        'service-doc': doc,
        'terms-of-service': [{ href: u(PATHS.terms) }],
        'privacy-policy': [{ href: u(PATHS.privacy) }],
      },
    ],
  };
}

/**
 * RFC 9116 security.txt. Expires a year after the build (each deploy renews it).
 * @param {string} origin
 * @param {Date} now
 */
export function securityTxt(origin, now = new Date()) {
  const expires = new Date(now.getTime() + 365 * 24 * 3600 * 1000);
  expires.setUTCHours(0, 0, 0, 0);
  const repo = registry.repository.url;
  return [
    `Contact: ${repo}/security/advisories/new`,
    `Contact: ${repo}/issues`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: en',
    `Canonical: ${origin}${PATHS.security}`,
    `Policy: ${origin}${PATHS.support}#report`,
    '',
  ].join('\n');
}

/**
 * The `Link` header for a page with API pointers (RFC 8288): the OpenAPI description, the API
 * catalog, the documentation, llms.txt, the AI catalog (as `ard` and as `ai-catalog`) and, unless
 * `twin: false`, the page's Markdown twin (the Worker leaves that one to the Markdown router, which
 * adds it to every page).
 * @param {string} path e.g. `` or `agents/`
 * @param {{ twin?: boolean }} [options]
 */
export function linkHeader(path, { twin = true } = {}) {
  const md = twin ? markdownPath(path) : null;
  return [
    `<${PATHS.openapi}>; rel="service-desc"; type="application/openapi+json"`,
    `<${PATHS.apiCatalog}>; rel="api-catalog"`,
    `<${PATHS.agents}>; rel="service-doc"`,
    ...(md ? [`<${md}>; rel="alternate"; type="text/markdown"`] : []),
    `<${PATHS.llms}>; rel="describedby"; type="text/plain"`,
    `<${PATHS.ard}>; rel="ard"; type="application/ai-catalog+json"`,
    `<${PATHS.aiCatalog}>; rel="ai-catalog"; type="application/ai-catalog+json"`,
  ].join(', ');
}

/** Pages whose head and `Link` header carry the API pointers. */
export const API_POINTER_PAGES = ['', 'agents/'];

/** The MCP protocol revision served per request (the SDK does not export its constant). */
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

/**
 * The MCP Server Card (SEP-2127, Final; the schema is modelcontextprotocol/ext-server-card's
 * schema.ts): who the server is and where to connect, from server.json. Served by the Worker at
 * `/mcp/server-card` (`<endpoint>/server-card`, the location the spec reserves) and copied, as a
 * static file, to `/.well-known/mcp/server-card.json` for scanners that look there. No `headers`
 * on the remote: the server takes no credentials (the card format has no explicit "no auth"
 * field; a remote without required headers is how it says so).
 * @param {string} origin
 * @param {readonly string[]} sdkVersions the SDK's SUPPORTED_PROTOCOL_VERSIONS (2025-era revisions)
 */
export function serverCard(origin, sdkVersions) {
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    name: registry.name,
    version: registry.version,
    title: registry.title,
    description: registry.description,
    websiteUrl: registry.websiteUrl,
    repository: registry.repository,
    icons: registry.icons,
    remotes: [
      {
        type: 'streamable-http',
        url: `${origin}${PATHS.mcp}`,
        // createMcpHandler serves the 2026-07-28 revision and every 2025-era one.
        supportedProtocolVersions: [MODERN_PROTOCOL_VERSION, ...sdkVersions],
      },
    ],
  };
}

/** The `room-planner` Agent Skill: its name and description, in SKILL.md and in the index. */
export const SKILL = {
  name: 'room-planner',
  description:
    'Make a room or floor plan the user can open and edit in Room Planner, a free web planner with no account: furniture to scale, doors, windows, clearances and blocked doors checked, handed back as a link. Use when the user wants to lay out, arrange or check a room, a furniture layout or a floor plan.',
};

/**
 * Agent Skills discovery index (Cloudflare's Agent Skills Discovery RFC v0.2.0): one skill, whose
 * digest is the SHA-256 of the SKILL.md bytes served.
 * @param {string} skillDigest `sha256:<hex>`
 */
export function agentSkillsIndex(skillDigest) {
  return {
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: [
      {
        name: SKILL.name,
        type: 'skill-md',
        description: SKILL.description,
        url: PATHS.skill,
        digest: skillDigest,
      },
    ],
  };
}

/**
 * The AI Catalog (Agent-Card/ai-catalog v0.9) whose entries are also ARD entries (ARD v0.91: a
 * displayName and representative queries each). Served at /.well-known/ai-catalog.json (the AI
 * Catalog's well-known path, which MCP server-card discovery uses) and /.well-known/ard.json (ARD's
 * path since v0.91). Identifiers are `urn:air:<publisher>:<name>:<kind>`.
 * @param {string} origin
 * @param {{ skillDigest: string }} options
 */
export function aiCatalog(origin, { skillDigest }) {
  const host = new URL(origin).hostname;
  const id = (kind) => `urn:air:${host}:room-planner:${kind}`;
  const u = (p) => `${origin}${p}`;
  return {
    specVersion: '0.9',
    host: {
      displayName: registry.title,
      identifier: host,
      documentationUrl: u(PATHS.agents),
      logoUrl: u('/pwa-512x512.png'),
    },
    entries: [
      {
        identifier: id('mcp'),
        displayName: `${registry.title} MCP server`,
        type: 'application/mcp-server-card+json',
        url: u(PATHS.serverCard),
        description: `${registry.description} Free, no account, no authentication.`,
        tags: ['room-planning', 'floor-plan', 'furniture-layout', 'interior-design'],
        capabilities: ['create_plan', 'check_layout', 'read_plan'],
        representativeQueries: [
          'lay out my 12×11 bedroom with a queen bed',
          'will a 7 foot sofa fit in my 14 by 12 living room',
          'check whether my furniture blocks the door',
          'draw a floor plan of my flat that I can edit',
        ],
      },
      {
        identifier: id('api'),
        displayName: `${registry.title} REST API`,
        type: 'application/openapi+json',
        url: u(PATHS.openapi),
        description:
          'The MCP tools over plain HTTP, with no key: check a plan for layout problems, make a link that opens it in the planner, read a plan from a link.',
        tags: ['room-planning', 'floor-plan', 'furniture-layout'],
        capabilities: ['checkPlan', 'createPlanLink', 'readPlan'],
        representativeQueries: [
          'make an editable room layout link from this plan JSON',
          'check a furniture layout for overlaps and blocked doors over HTTP',
          'read the room plan in this Room Planner link',
        ],
      },
      {
        identifier: id('skill'),
        displayName: `${registry.title} skill`,
        type: 'application/agent-skills+md',
        url: u(PATHS.skill),
        description: SKILL.description,
        digest: skillDigest,
        tags: ['room-planning', 'floor-plan', 'furniture-layout'],
        representativeQueries: [
          'plan my bedroom layout and give me a link',
          'arrange furniture in a 10 by 12 foot room',
          'make a Room Planner link without any tools',
        ],
      },
    ],
  };
}

/**
 * Personal Agent Protocol (Poppy) 1.0 discovery: a Company with no OAuth issuer and no sign-in
 * (so /.well-known/oauth-protected-resource is a 404, which section 3.2 reads as "no issuer"), a
 * website agents browse as signed-out visitors, and the two APIs, which take no credentials.
 * @param {string} origin
 */
export function poppy(origin) {
  return {
    protocol_version: '1.0',
    organization: {
      name: registry.title,
      domain: new URL(origin).host,
      logo_uri: `${origin}/pwa-512x512.png`,
    },
    web: {},
    apis: [
      {
        type: 'mcp',
        url: `${origin}${PATHS.mcp}`,
        description: 'Make a room or floor plan, check it for layout problems, read a plan link',
      },
      {
        type: 'openapi',
        url: `${origin}${PATHS.openapi}`,
        description: 'The same operations over plain HTTP, with no key',
      },
    ],
  };
}

/**
 * Search for Agents (developers.cloudflare.com/ai-search/how-to/search-for-agents/): the pointers
 * every page carries, as `<meta name="agent:...">` in its HTML and an `agent:` block in its
 * Markdown twin's front matter. The endpoint is the Worker's (worker/search.ts).
 * @param {string} origin
 */
export function searchPointers(origin) {
  return {
    instructions:
      'Use this search API to find relevant content across this site with keywords or natural-language queries, instead of crawling individual pages. Results are returned in Markdown.',
    endpoint: `${origin}${PATHS.search}?q={query}`,
    method: 'GET',
    documentation: 'https://developers.cloudflare.com/ai-search/how-to/search-for-agents/',
  };
}
