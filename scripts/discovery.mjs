// Discovery for agents (docs/DEPLOY.md, "Discovery for agents"): the one place that decides which
// pages have a Markdown twin, and what /.well-known/api-catalog and /.well-known/security.txt say.
// Used by the build (scripts/llms-full.mjs), the page head (src/layouts/Base.astro), robots.txt,
// IndexNow and the discovery e2e, so the URLs and versions in every file come from the same place:
// the site origin (astro.config.mjs SITE_URL) and server.json.
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
  openapi: '/openapi.json',
  planSchema: '/plan.schema.json',
  api: '/api/',
  apiCatalog: '/.well-known/api-catalog',
  aiCatalog: '/.well-known/ai-catalog.json',
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
 * catalog, the documentation, llms.txt and, unless `twin: false`, the page's Markdown twin (the
 * Worker leaves that one to the Markdown router, which adds it to every page).
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
  ].join(', ');
}

/** Pages whose head and `Link` header carry the API pointers. */
export const API_POINTER_PAGES = ['', 'agents/'];
