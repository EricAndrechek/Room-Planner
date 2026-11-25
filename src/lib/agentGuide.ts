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
  `Room Planner opens a whole plan from a link, saved in the user's browser and ready to edit; no account. ALWAYS give the link as markdown link text, such as [Open your bedroom in Room Planner](link), never as a bare URL: links get long, and the link text hides them (browsers accept very long links; the plan stays in the part after #, which never reaches a server). Pick the first way you can:

1. **With Room Planner's tools** (${tools}, or WebMCP in Chrome): use them. \`create_plan\` checks the layout and returns the link.
2. **If you can make HTTP requests** (agentic tools, custom agents, ChatGPT Custom GPT Actions): the REST API does the same as the tools, described by ${url('openapi.json')}. \`POST /api/plan/check\` returns the issues; \`POST /api/plan/link\` returns the plan, its issues and the \`url\`; \`GET /api/plan?url=<link>\` reads a plan from a link. No key. (ChatGPT's and Claude.ai's code sandboxes usually have no internet: use 3 there.)

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

4. **No tools, no HTTP and no code**: write the plan in this readable form after ${url('')}#p= . Best for small plans (a room or two, rectangles, round and L-shaped pieces); for bigger or odd-shaped floors, use 2 or 3.
${READABLE_SYNTAX.map((l) => `   - ${l}`).join('\n')}

   Examples:
   - ${readableMarkdown(url(''), READABLE_EXAMPLES.bedroom, 'the bedroom')}
   - ${readableMarkdown(url(''), READABLE_EXAMPLES.flat, 'the flat')}`;
