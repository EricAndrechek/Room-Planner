import { describe, expect, it } from 'vitest';
import { CHECK_LAYOUT, CREATE_PLAN, FORMAT_DETAILS, INSTRUCTIONS, READ_PLAN } from './descriptions';
import { DINING } from './fixtures';
import { checkPlan, createPlan, planMarkdown, readPlan } from './tools';

const ORIGIN = 'https://room-planner.andrechek.com';

/** Claude's directory policy: tool text describes the tool, it does not tell the model what to do. */
const DIRECTIVE =
  /\b(give the user|never|always|you must|must not|do not|don't|ask the user|ask at most|prefer these tools|present it|fix (every|these|errors)|call again)\b/i;

describe('tool text states facts, not instructions to the model', () => {
  it('in the descriptions and the server instructions', () => {
    for (const [name, text] of Object.entries({
      CREATE_PLAN,
      CHECK_LAYOUT,
      READ_PLAN,
      INSTRUCTIONS,
      FORMAT_DETAILS,
    })) {
      expect(text.match(DIRECTIVE)?.[0], name).toBeUndefined();
    }
  });

  it('in sample tool results and the Markdown for browsing agents', async () => {
    const [first, second, ...rest] = DINING.items;
    const broken = {
      ...DINING,
      items: [first, { ...second, placement: first.placement }, ...rest],
    };
    const created = await createPlan({ plan: broken }, ORIGIN);
    const checked = checkPlan({ plan: broken });
    const invalid = await createPlan({ plan: { version: 4, rooms: 'x' } }, ORIGIN);
    const damaged = await readPlan({ url: `${ORIGIN}/#s=AAAA` }, ORIGIN);
    const none = await readPlan({ url: `${ORIGIN}/help/` }, ORIGIN);
    const texts = [
      created.text,
      checked.text,
      invalid.text,
      damaged.text,
      none.text,
      planMarkdown(created, ORIGIN),
      planMarkdown(damaged, ORIGIN),
    ];
    expect(created.text).toContain('error');
    for (const text of texts) expect(text.match(DIRECTIVE)?.[0], text).toBeUndefined();
  });
});
