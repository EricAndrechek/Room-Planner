import type { APIRoute } from 'astro';
import { GUIDES, guidePath } from '../lib/guides';
import { DEFAULT_DESCRIPTION, FEATURES, SITE_NAME } from '../lib/site';

/**
 * llms.txt (https://llmstxt.org): what the site is and where its content lives, for AI assistants
 * and answer engines. Built from the same constants as the pages; the full text of the help, FAQ
 * and guides is in /llms-full.txt (scripts/llms-full.mjs).
 */
export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const url = (path: string) => new URL(`${base}/${path}`, site ?? 'http://localhost').toString();

  const body = `# ${SITE_NAME}

> ${SITE_NAME} (${url('')}) is a free online room layout and furniture planner. It runs entirely in the web browser: no sign-up, no account, and floor plans are stored on the user's own device, never uploaded.

${DEFAULT_DESCRIPTION}

Key facts:

- Price: free. No account, trial or paid version.
- Platform: any modern web browser on desktop, tablet or phone. Installable as a progressive web app; works offline after the first visit.
- Privacy: plans live in the browser's local storage. Anonymous usage analytics (never layouts or plan names) can be turned off on the help page.
- Share links: a link carries the whole layout in the URL fragment (\`#s=\` followed by base64url-encoded, deflate-compressed JSON), so the layout is never sent to a server. Opening a link adds a copy of the layout as a new plan in the recipient's browser; the link is a snapshot.
- Scope: one rectangular room per plan, drawn in 2D from above; furniture pieces are rectangles with a name, size, color and rotation. For a whole home, make one plan per room.

Features:

${FEATURES.map((f) => `- ${f}`).join('\n')}

## Pages

- [Planner](${url('')}): the app itself (needs JavaScript).
- [Help](${url('help/')}): how to use every feature, step by step, and keyboard shortcuts.
- [FAQ](${url('faq/')}): short answers: price, accounts, data storage, phones, sharing, export, units, offline use, door types.
- [Room layout guides](${url('guides/')}): furniture sizes, clearances and example floor plans.

## Guides

${GUIDES.map((g) => `- [${g.heading}](${url(guidePath(g.slug))}): ${g.description}`).join('\n')}

## Optional

- [Full text of the help, FAQ and guides](${url('llms-full.txt')}): the pages above as Markdown, in one file.
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
