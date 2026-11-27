import { PLAN_SCHEMA_PATH } from './planSchema';
import {
  API_CURL,
  COMPRESS_JS,
  COMPRESS_PYTHON,
  PLAN_JSON_SUMMARY,
  READABLE_EXAMPLES,
  READABLE_SYNTAX,
  readableMarkdown,
} from './site';

/** Where an assistant that browses checks a link it wrote (worker/api.ts, `GET /api/plan`). */
export const CHECK = (url: (path: string) => string): string =>
  `${url('api/plan')}?url=<the link, URL-encoded> (or ?p=<the text after #p=>)`;

/**
 * How to work, for every agent: the same words in llms.txt, the Agent Skill and /agents/ (the MCP
 * server's instructions say it for its tools, worker/descriptions.ts).
 */
export const WORKFLOW = `Work in four steps: **create** the plan, **check** it, **fix** every error and warning (overlaps, pieces outside the room, pieces in a door's swing or doorway), then **present** it in a sentence or two with the link. Ask at most ONE clarifying question, and only when the answer changes the layout; otherwise assume sensible defaults (standard furniture sizes; a door centred on the wall the user names, 3 ft / 90 cm wide, swinging in), say what you assumed, and tell the user they can drag things in the planner. Requests it is good at: "fit as many seats as possible around these two tables in my 20x12 dining room", "can I fit a king bed and two nightstands in an 11x12 bedroom?", "arrange my living room around this sofa and TV".`;

/**
 * "Give the user a ready-made plan" in Markdown: the four ways an assistant hands a user a plan
 * (tools, the REST API, a `#s=` link made in code, a readable `#p=` link), with the link-text rule.
 * One text for /llms.txt and the `room-planner` Agent Skill
 * (/.well-known/agent-skills/room-planner/SKILL.md), so the two can't drift.
 *
 * @param url makes an absolute URL on this site from a site path (`''` is the planner)
 * @param tools where the tools are, as the first way names them (e.g. "the MCP server below")
 */
export const planLinkGuide = (url: (path: string) => string, tools: string): string =>
  `Room Planner opens a whole plan from a link, saved in the user's browser and ready to edit; no account. ALWAYS give the link as markdown link text, such as [Open your bedroom in Room Planner](link), never as a bare URL: links get long, and the link text hides them (browsers accept very long links; the plan stays in the part after #, which never reaches a server).

${WORKFLOW}

Pick the first way you can:

1. **With Room Planner's tools** (${tools}, or WebMCP in Chrome): use them. \`create_plan\` checks the layout and returns the link.
2. **If you can make HTTP requests or open web pages** (agentic tools, custom agents, ChatGPT Custom GPT Actions, and chat assistants that browse, such as ChatGPT, Claude or Perplexity searching the web): the REST API does the same as the tools, described by ${url('openapi.json')}. \`POST /api/plan/check\` returns the issues; \`POST /api/plan/link\` returns the plan, its issues and the \`url\`; \`GET /api/plan?url=<link>\` reads and checks the plan in a link. No key. If you can only open pages (GET), make the link with 3 or 4 and check it with the GET below: it answers in Markdown. (Code sandboxes in ChatGPT and Claude.ai usually have no internet, but their web browsing does.)

\`\`\`sh
${API_CURL}
\`\`\`

3. **If you can run code** (offline is fine): write the plan as JSON (JSON Schema: ${url(PLAN_SCHEMA_PATH)}; the same format as the MCP tools), compress it with raw deflate, base64url-encode it without padding, and append it to ${url('')}#s= . Any size and shape.
${PLAN_JSON_SUMMARY.map((l) => `   - ${l}`).join('\n')}

   Python:

\`\`\`python
${COMPRESS_PYTHON}
\`\`\`

   JavaScript:

\`\`\`js
${COMPRESS_JS}
\`\`\`

4. **No tools and no code**: write the plan in this readable form after ${url('')}#p= . Best for small plans (a room or two, rectangles, round and L-shaped pieces); for bigger or odd-shaped floors, use 2 or 3.
${READABLE_SYNTAX.map((l) => `   - ${l}`).join('\n')}

   Examples:
   - ${readableMarkdown(url(''), READABLE_EXAMPLES.bedroom, 'the bedroom')}
   - ${readableMarkdown(url(''), READABLE_EXAMPLES.flat, 'the flat')}

**Check a link before you give it to the user** (any link you made without Room Planner's tools, if you can open web pages): open ${CHECK(url)}, fix every error and warning it lists yourself (it names each piece and where it is: move it, keep door swings and doorways clear), and open the check again with the new link until it lists none. Then give the user the link.`;
