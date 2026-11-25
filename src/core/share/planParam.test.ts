import { describe, expect, it } from 'vitest';
import { readSharedPlan } from '../../lib/boot';
import { hasShareLink, readSharePayload, stripShareLink } from './link';
import { PLAN_PARAM_MAX_CHARS, readPlanParam } from './planParam';

const SITE = 'https://room-planner.andrechek.com/';

/** As a model writes it: spaces, no version, no ids, no unit. */
const BEDROOM = `{"name": "Bedroom", "rooms": [{"name": "Bedroom", "outline": [{"x": 0, "y": 0}, {"x": 12, "y": 0}, {"x": 12, "y": 11}, {"x": 0, "y": 11}], "openings": [{"kind": "door", "wall": 2, "offset": 1, "width": 3}]}], "items": [{"label": "Queen bed", "width": 5, "depth": 6.7, "placement": {"x": 6, "y": 3.35}}, {"label": "Desk", "width": 4, "depth": 2, "color": "#6ee7b7", "placement": {"x": 9.5, "y": 10}}]}`;

/** What the editor would open from `href`. */
async function opened(href: string) {
  const payload = await readSharePayload(href);
  if (payload.status !== 'ok') throw new Error(`payload ${payload.status}`);
  const read = readSharedPlan(payload.data);
  if (!read.ok) throw new Error(`not opened: ${read.problem}`);
  return { ...read, source: payload.source };
}

describe('plan links (#plan=)', () => {
  it('open a plan written raw, with spaces, no version, no ids and no unit', async () => {
    const r = await opened(`${SITE}#plan=${BEDROOM}`);
    expect(r.source).toBe('plan_param');
    expect(r.name).toBe('Bedroom');
    expect(r.plan.rooms).toHaveLength(1);
    expect(r.plan.rooms[0]!.name).toBe('Bedroom');
    expect(r.plan.rooms[0]!.openings.map((o) => o.kind)).toEqual(['door']);
    expect(r.plan.items.map((i) => [i.label, i.width, i.depth, i.color])).toEqual([
      ['Queen bed', 5, 6.7, expect.any(String)],
      ['Desk', 4, 2, '#6ee7b7'],
    ]);
    // Ids were made up; they are unique.
    const ids = [...r.plan.rooms.map((x) => x.id), ...r.plan.items.map((i) => i.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('open the same plan percent-encoded, and through ?plan= (where a colour has a #)', async () => {
    const raw = await opened(`${SITE}#plan=${BEDROOM}`);
    const encoded = await opened(`${SITE}#plan=${encodeURIComponent(BEDROOM)}`);
    const query = await opened(`${SITE}?plan=${BEDROOM}`);
    expect(encoded.plan).toEqual(raw.plan);
    expect(query.plan).toEqual(raw.plan);
  });

  it('survive what chat apps do: typographic quotes, trailing punctuation, a stray %', async () => {
    const smart = BEDROOM.replace(/"/g, (_, i: number) => (i % 2 ? '“' : '”'));
    const raw = await opened(`${SITE}#plan=${BEDROOM}`);
    expect((await opened(`${SITE}#plan=${smart}`)).plan).toEqual(raw.plan);
    expect((await opened(`${SITE}#plan=${BEDROOM}).`)).plan).toEqual(raw.plan);
    const percent = BEDROOM.replace('"Desk"', '"Desk 100% oak"');
    expect((await opened(`${SITE}#plan=${percent}`)).plan.items[1]!.label).toBe('Desk 100% oak');
  });

  it('take a room given as width and depth, in another unit', async () => {
    const r = await opened(
      `${SITE}#plan={"unit":"cm","rooms":[{"name":"Studio","width":500,"depth":400}],"items":[]}`,
    );
    expect(r.plan.rooms[0]!.outline).toHaveLength(4);
    // Feet in the editor: 500 cm is about 16.4 ft.
    const xs = r.plan.rooms[0]!.outline.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(500 / 30.48, 3);
  });

  it('are damaged when the JSON cannot be read or is too long', () => {
    expect(readPlanParam(`${SITE}#plan={"rooms": [`).status).toBe('damaged');
    expect(readPlanParam(`${SITE}#plan=`).status).toBe('damaged');
    const long = `{"name":"${'x'.repeat(PLAN_PARAM_MAX_CHARS)}","rooms":[]}`;
    expect(readPlanParam(`${SITE}#plan=${long}`).status).toBe('damaged');
    expect(readPlanParam(SITE).status).toBe('none');
  });

  it('are found, and removed from the URL once opened', () => {
    expect(hasShareLink(`${SITE}#plan=${BEDROOM}`)).toBe(true);
    expect(hasShareLink(`${SITE}?plan=${BEDROOM}`)).toBe(true);
    expect(stripShareLink(`${SITE}#plan=${BEDROOM}`)).toBe(SITE);
    expect(stripShareLink(`${SITE}?plan=${BEDROOM}`)).toBe(SITE);
    expect(stripShareLink(`${SITE}?utm_source=chat&plan=${BEDROOM}`)).toBe(
      `${SITE}?utm_source=chat`,
    );
  });
});
