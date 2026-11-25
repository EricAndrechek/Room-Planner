import type { APIRoute } from 'astro';
import registry from '../../server.json';
import { GUIDES, guidePath } from '../lib/guides';
import { planLinkGuide } from '../lib/agentGuide';
import { DEFAULT_DESCRIPTION, FEATURES, MCP_PATH, MCP_PRIVACY, SITE_NAME } from '../lib/site';
import { PLAN_SCHEMA_PATH } from '../lib/planSchema';
import { PATHS, markdownPath } from '../../scripts/discovery.mjs';

/**
 * llms.txt (https://llmstxt.org): what the site is and where its content lives, for AI assistants
 * and answer engines. Built from the same constants as the pages; the full text of the help, FAQ
 * and guides is in /llms-full.txt (scripts/llms-full.mjs).
 */
export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const url = (path: string) =>
    new URL(`${base}/${path.replace(/^\/+/, '')}`, site ?? 'http://localhost').toString();
  /** ` ([Markdown](…))` for a page with a Markdown twin. */
  const md = (path: string) => {
    const m = markdownPath(path);
    return m ? ` ([Markdown](${url(m)}))` : '';
  };

  const body = `# ${SITE_NAME}

> ${SITE_NAME} (${url('')}) is a free online room layout and furniture planner. It runs entirely in the web browser: no sign-up, no account, and floor plans are stored on the user's own device; the app never uploads them.

${DEFAULT_DESCRIPTION}

Key facts:

- Price: free. No account, trial or paid version.
- Platform: any modern web browser on desktop, tablet or phone. Installable as a progressive web app; works offline after the first visit.
- Privacy: plans live in the browser's local storage, and the app never uploads them. A plan reaches the MCP server only when an AI assistant is asked to use it. Anonymous usage analytics (never layouts or plan names) can be turned off on the help page.
- Share links: a link carries the whole layout in the URL fragment (\`#s=\` followed by base64url-encoded, deflate-compressed JSON), so the layout is never sent to a server. Opening a link adds a copy of the layout as a new plan in the recipient's browser; the link is a snapshot.
- Scope: one floor per plan, with any number of connected rooms (each a rectangle, an L-shape or any outline with straight walls), drawn in 2D from above. Rooms share walls with zero thickness, so a plan is a little narrower than the real building. Furniture pieces are rectangles, L-shapes or ellipses with a name, size, color and rotation.
- Doors between rooms: a door on a wall two rooms share connects them and can swing into either room; furniture in its way is flagged in both rooms.
- Set aside: a piece can be taken out of the plan without deleting it. It keeps its name, size, color and shape, never raises warnings, and is listed under the drawing in exports. It can be dragged back onto the plan, or placed by tapping where it goes.
- Plan data: in the plan's JSON, \`rooms\` may hold several rooms in one floor coordinate space, a door on a shared wall connects two rooms, and an item without \`placement\` is set aside.

Features:

${FEATURES.map((f) => `- ${f}`).join('\n')}

## Use Room Planner from an agent

- [MCP server](${url(MCP_PATH)}): free remote MCP server (Streamable HTTP, no authentication): ${url(MCP_PATH)} with \`create_plan\`, \`check_layout\` and \`read_plan\`, and an MCP Apps viewer. [Server card](${url(PATHS.serverCard)}); MCP Registry name \`${registry.name}\`.
- [REST API](${url(PATHS.openapi)}): the same operations over plain HTTP (OpenAPI 3.1): \`POST /api/plan/check\`, \`POST /api/plan/link\`, \`GET /api/plan?url=\`. No key.
- [Plan JSON Schema](${url(PLAN_SCHEMA_PATH)}): the plan format the tools, the API and \`#s=\` links take.
- [Plan links](${url('agents/')}#plan-links): give the user a ready-made plan as a link, with tools, HTTP, code or none (below).
- [Agent skill](${url(PATHS.skill)}): how to make a plan for the user (the section below, the plan format and examples) as an Agent Skill, listed in the [Agent Skills index](${url(PATHS.agentSkills)}).
- [API catalog](${url(PATHS.apiCatalog)}) (RFC 9727) and [AI catalog](${url(PATHS.aiCatalog)}) (also at ${url(PATHS.ard)}): the same, for discovery. No authentication anywhere, so there is no OAuth metadata.
- Search: \`GET ${url(PATHS.search)}?q=<words>\` returns the best sections of this site's pages, in Markdown.
- WebMCP: in Chrome with WebMCP, the planner page registers editing tools for the browser's own agent (below).

## Pages

- [Planner](${url('')}): the app itself (needs JavaScript).${md('')}
- [Help](${url('help/')}): how to use every feature, step by step, and keyboard shortcuts.${md('help/')}
- [FAQ](${url('faq/')}): short answers: price, accounts, data storage, phones, sharing, export, units, offline use, door types.${md('faq/')}
- [Room layout guides](${url('guides/')}): furniture sizes, clearances and example floor plans.${md('guides/')}
- [For AI assistants](${url('agents/')}): connecting Claude, ChatGPT, VS Code, Cursor or Claude Code to the MCP server; the REST API; plan links.${md('agents/')}
- [Privacy](${url('privacy/')}): what the planner, the MCP server and the API collect.${md('privacy/')}
- [Support](${url('support/')}) and [Terms](${url('terms/')}).

## Give the user a ready-made plan

${planLinkGuide(url, 'the MCP server below')}

## MCP tools

- \`create_plan\`: a plan (one room or a floor of connected rooms, doors, windows, furniture of any shape, pieces set aside; in ft, in, m or cm) checked for layout problems, and a link that opens it in the planner. Clients with MCP Apps show the drawing.
- \`check_layout\`: overlapping pieces, pieces outside every room, blocked doors and doorways (on both sides of a door between rooms), overlapping rooms and tight clearances, without a link.
- \`read_plan\`: the plan in a Room Planner link, to edit and send back to create_plan.

The same operations over plain HTTP: ${url('openapi.json')} (OpenAPI 3.1).

In Chrome with WebMCP (\`chrome://flags/#enable-webmcp-testing\`, or the origin trial), the planner page itself registers tools on \`document.modelContext\` for the browser's agent: \`get_plan\`, \`check_layout\`, \`add_item\`, \`update_item\`, \`set_aside_item\`, \`place_item\`, \`remove_item\`, \`add_opening\`, \`update_opening\`, \`remove_opening\`, \`add_room\`, \`update_room\`, \`remove_room\` and \`replace_plan\` (which asks the user first). Each edit is one undo step on the user's open plan, in its display unit; nothing is sent anywhere.

${MCP_PRIVACY}

## Guides

${GUIDES.map((g) => `- [${g.heading}](${url(guidePath(g.slug))}): ${g.description}${md(guidePath(g.slug))}`).join('\n')}

## Optional

- [Full text of the help, FAQ, AI assistants page, privacy policy and guides](${url('llms-full.txt')}): the pages above as Markdown, in one file.
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
