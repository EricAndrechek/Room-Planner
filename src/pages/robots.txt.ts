import type { APIRoute } from 'astro';
import { PATHS } from '../../scripts/discovery.mjs';

/**
 * robots.txt: every crawler, AI crawlers included, may read everything (the owner's choice;
 * docs/DEPLOY.md, "Discovery for agents"), with Cloudflare's Content Signals saying the same for
 * search, AI answers and AI training. Nothing is disallowed: not /mcp, /api/, /openapi.json or
 * /.well-known/. Previews are kept out of indexes by Cloudflare's own `X-Robots-Tag: noindex`.
 * `Agentmap` points agents at the AI catalog (ARD v0.91, section 5.1); crawlers ignore the line.
 */
export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const url = (path: string) => new URL(`${base}/${path}`, site ?? 'http://localhost').toString();
  const body = [
    '# Content signals (https://contentsignals.org): search = building a search index and linking',
    '# to results; ai-input = using the content as input to AI answers; ai-train = training or',
    '# fine-tuning AI models. All allowed.',
    'User-agent: *',
    'Content-Signal: search=yes, ai-input=yes, ai-train=yes',
    'Allow: /',
    '',
    `Sitemap: ${url('sitemap-index.xml')}`,
    `Agentmap: ${url(PATHS.ard.slice(1))}`,
    '',
    `# For AI agents: ${url('llms.txt')} (MCP server, REST API ${url('openapi.json')}, plan links).`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
