import { readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { checkLayout } from '../core/check';
import { loadPlan } from '../core/load';
import { readSharePayload } from '../core/share/link';
import { readSharedPlan } from './boot';
import { publishedPlanSchema } from './planSchema';
import { READABLE_EXAMPLES } from './site';
import { parseReadable } from '../core/share/readable';

// The plan an assistant with code builds (llms.txt, "Can run code"), and the link it makes with
// Python's zlib.compressobj(9, zlib.DEFLATED, -15) and base64url: written here, by the same
// algorithm, never by hand. UPDATE_AGENT_EXAMPLE=1 rewrites the committed link.

const FILE = new URL('./agentExample.json', import.meta.url);
const SITE = 'https://room-planner.andrechek.com/';

const example = JSON.parse(readFileSync(FILE, 'utf8')) as { plan: unknown; link: string };

/** The link as the documented Python snippet makes it. */
const pythonLink = (plan: unknown) =>
  `${SITE}#s=${deflateRawSync(Buffer.from(JSON.stringify(plan)), { level: 9 })
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}`;

describe('the assistant-made link example', () => {
  it('is the committed link, made the documented way', () => {
    const link = pythonLink(example.plan);
    if (process.env.UPDATE_AGENT_EXAMPLE) {
      writeFileSync(FILE, `${JSON.stringify({ ...example, link }, null, 2)}\n`);
    }
    expect(JSON.parse(readFileSync(FILE, 'utf8')).link).toBe(link);
  });

  it('opens as the three-room plan, with no error', async () => {
    const payload = await readSharePayload(example.link);
    if (payload.status !== 'ok') throw new Error(payload.status);
    const read = readSharedPlan(payload.data);
    if (!read.ok) throw new Error(read.problem);
    expect(read.name).toBe('Three-room flat');
    expect(payload.data).toEqual(example.plan);
    expect(read.plan.rooms.map((r) => r.name)).toEqual(['Living room', 'Bedroom', 'Bathroom']);
    expect(read.plan.items.map((i) => [i.label, i.shape, Boolean(i.placement)])).toEqual([
      ['L sectional', 'l', true],
      ['Round table', 'ellipse', true],
      ['Full bed', 'rect', true],
      ['Vanity', 'rect', true],
      ['Spare chair', 'rect', false],
    ]);
    expect(checkLayout(read.plan).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('validates against the published JSON Schema, as do the readable examples once read', () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(publishedPlanSchema(SITE));
    expect(validate(example.plan), JSON.stringify(validate.errors)).toBe(true);
    for (const text of Object.values(READABLE_EXAMPLES)) {
      const r = parseReadable(text);
      const loaded = r.status === 'ok' ? loadPlan(r.data, 'lenient') : null;
      if (!loaded?.ok) throw new Error('unreadable');
      expect(validate(loaded.plan), JSON.stringify(validate.errors)).toBe(true);
    }
  });
});
