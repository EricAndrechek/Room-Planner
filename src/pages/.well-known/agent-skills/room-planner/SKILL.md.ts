import type { APIRoute } from 'astro';
import { planLinkGuide } from '../../../../lib/agentGuide';
import {
  API_CURL,
  MCP_PATH,
  READABLE_EXAMPLES,
  SITE_NAME,
  readableMarkdown,
} from '../../../../lib/site';
import { PLAN_SCHEMA_PATH } from '../../../../lib/planSchema';
import { PATHS, SKILL } from '../../../../../scripts/discovery.mjs';
import { FORMAT } from '../../../../../worker/descriptions';

/**
 * The `room-planner` Agent Skill (agentskills.io format; listed in
 * /.well-known/agent-skills/index.json with its SHA-256, written by scripts/llms-full.mjs after the
 * build). Its core is the same text as llms.txt's "Give the user a ready-made plan"
 * (src/lib/agentGuide.ts), the plan format is the MCP tools' own (worker/descriptions.ts), and its
 * examples are the tested ones (src/lib/site.ts), so it can't drift from the docs.
 */
export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const url = (path: string) =>
    new URL(`${base}/${path.replace(/^\/+/, '')}`, site ?? 'http://localhost').toString();
  const mcp = url(MCP_PATH);

  const body = `---
name: ${SKILL.name}
description: ${JSON.stringify(SKILL.description)}
---

# ${SITE_NAME}

${SITE_NAME} (${url('')}) is a free room layout and furniture planner that runs in the browser, with no account. You give the user a plan as a link; it opens in the planner, saved in their browser, ready to drag, rotate and edit.

## Give the user a ready-made plan

${planLinkGuide(url, `the MCP server at ${mcp}, which needs no sign-in`)}

## The plan, in full

The format the tools, the REST API and \`#s=\` links take (the readable \`#p=\` form above is a shorthand for it):

${FORMAT}

Check before you hand a plan over: the tools and \`POST /api/plan/check\` report overlapping pieces, pieces outside every room, blocked doors and doorways and tight clearances. Fix what they report and check again. If the user's sizes can't fit (a bed longer than the room), say so rather than shrinking things.

## Examples

**"Lay out my 12×11 bedroom with a queen bed"**, with HTTP (the same plan works with \`create_plan\`):

\`\`\`sh
${API_CURL}
\`\`\`

The answer has \`issues\` and \`url\`. Reply with the link as text: [Open your bedroom in Room Planner](url).

**"Sketch my flat: a 14×12 living room next to a 10×12 bedroom"**, with no tools at all (the readable form):

${readableMarkdown(url(''), READABLE_EXAMPLES.flat, 'your flat')}

## More

- Plan format: ${url(PLAN_SCHEMA_PATH)} (JSON Schema). REST API: ${url(PATHS.openapi)} (OpenAPI 3.1).
- MCP server card: ${url(PATHS.serverCard)}. Setup for Claude, ChatGPT, VS Code and others: ${url(PATHS.agents)}.
- Everything for agents in one place: ${url(PATHS.llms)}.
`;
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
