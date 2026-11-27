import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHECK_LAYOUT, CREATE_PLAN, FORMAT, INSTRUCTIONS } from '../../worker/descriptions';
import { planLinkGuide } from './agentGuide';

const url = (path: string) => `https://room-planner.andrechek.com/${path}`;

// What every agent reads (llms.txt and the Agent Skill share planLinkGuide; /agents/ says it in
// its own words; the MCP server in its instructions and tool descriptions) says the same things.
describe('what agents are told', () => {
  const guide = planLinkGuide(url, 'the MCP server');
  const agentsPage = readFileSync(new URL('../pages/agents.astro', import.meta.url), 'utf8');

  it('to check a link they wrote with the GET that browsing assistants can make', () => {
    expect(guide).toContain(
      'open https://room-planner.andrechek.com/api/plan?url=<the link, URL-encoded> (or ?p=<the text after #p=>)',
    );
    expect(guide).toMatch(/chat assistants that browse/);
    expect(agentsPage).toContain("{abs('api/plan')}?url=&lt;the link, URL-encoded&gt;");
  });

  it('to create, check, fix and present, asking at most one question', () => {
    for (const text of [guide]) {
      expect(text).toMatch(/at most ONE clarifying question/);
      expect(text).toMatch(/create.*check.*fix.*present/is);
      expect(text).toContain('they can drag things in the planner');
    }
    expect(agentsPage).toMatch(/at most one clarifying question/);
  });

  it('to give the link as Markdown link text, never the bare URL', () => {
    expect(guide).toMatch(/markdown link text/i);
    expect(guide).toMatch(/never (as )?(a |the )?bare URL/i);
    expect(guide).not.toMatch(/exactly as (returned|it is)/);
    // The tool text only states the facts: what the link is and the Markdown line.
    expect(INSTRUCTIONS).toContain('[Open <name> in Room Planner](url)');
    expect(CREATE_PLAN).toContain('encodes the whole plan');
  });

  it('what a tight gap is, how to seat a table, and how to measure a door from either end', () => {
    expect(CHECK_LAYOUT).toContain('from 6 in / 15 cm up to minClearance');
    expect(FORMAT).toContain('24 in (60 cm) of table edge per seat');
    expect(FORMAT).toContain('{wall:1, offset:2, from:"bottom"}');
    expect(guide).toContain('`door:right:end-2:3`');
  });
});
