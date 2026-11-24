import { describe, expect, it } from 'vitest';
import { defaultLayout, toShareConfig } from '../testing/v3/layout';
import { loadPlan } from '../load';
import { CORNERS, DOOR_TYPES, HINGES, OPENING_KINDS, SHAPES, type Plan } from '../schema';
import { CORNER_ORDER, HINGE_ORDER, KINDS, SHAPE_ORDER, TYPES, compact, expand } from './compact';
import { buildShareUrl } from './link';
import { buildPlanUrl, readPlanLink } from './plan';

const starter = (): Plan => {
  const r = loadPlan({ ...defaultLayout(), name: 'Bedroom' }, 'strict', { lengthsInFeet: true });
  if (!r.ok) throw new Error('starter');
  return r.plan;
};

describe('compact', () => {
  it("keeps its own copies of the schema's enums in the same order", () => {
    expect(KINDS).toEqual(OPENING_KINDS);
    expect(TYPES).toEqual(DOOR_TYPES);
    expect(HINGE_ORDER).toEqual(HINGES);
    expect(SHAPE_ORDER).toEqual(SHAPES);
    expect(CORNER_ORDER).toEqual(CORNERS);
  });

  it('writes the starter room as positional arrays with defaults trimmed', () => {
    // The door is on the bottom wall, hinged at its left end: the end of the clockwise wall.
    expect(compact(starter())).toEqual([
      4,
      'Bedroom',
      'ft',
      0,
      [
        [
          [0, 0, 12, 0, 12, 12, 0, 12],
          [
            [0, 2, 3, 3, 0, 1],
            [1, 0, 4, 4],
          ],
        ],
      ],
      [
        ['Bed', 5, 6.5, 0, [6, 3.25]],
        ['Nightstand', 1.5, 1.5, 2, [2.75, 0.75]],
        ['Nightstand', 1.5, 1.5, 2, [9.25, 0.75]],
        ['Dresser', 1.5, 4, 6, [0.75, 9]],
        ['Desk', 2, 4, 1, [11, 8.5]],
        ['Chair', 1.5, 1.5, 7, [9.05, 7.85]],
      ],
    ]);
  });

  it('omits ids that equal their positional default, and writes the rest', () => {
    const p = starter();
    p.items[2]!.id = 'lamp';
    p.rooms[0]!.id = 'bedroom';
    const c = compact(p);
    expect(JSON.stringify(c)).not.toContain('item-');
    expect(JSON.stringify(c)).toContain('"bedroom"');
    expect(JSON.stringify(c)).toContain('"lamp"');
    const back = loadPlan(c, 'strict');
    expect(back.ok && back.plan.items.map((i) => i.id)).toEqual(p.items.map((i) => i.id));
  });

  it('writes custom colours as hex digits and every flag', () => {
    const p = starter();
    p.items[0] = { ...p.items[0]!, color: '#123ABC', locked: true, hidden: true, notes: 'n' };
    p.items[1] = { ...p.items[1]!, shape: 'l', cut: { corner: 'br', width: 0.5, depth: 0.5 } };
    const c = compact(p) as unknown[][][];
    expect(c[5]![0]).toEqual(['Bed', 5, 6.5, '123ABC', [6, 3.25], 0, 0, 3, 'n']);
    expect(c[5]![1]).toEqual(['Nightstand', 1.5, 1.5, 2, [2.75, 0.75], 1, [2, 0.5, 0.5]]);
    expect((expand(c).items as unknown[]).slice(0, 2)).toMatchObject([
      { color: '#123ABC', locked: true, hidden: true, notes: 'n' },
      { shape: 'l', cut: { corner: 'br', width: 0.5, depth: 0.5 } },
    ]);
  });

  it('reads a compact link of a later version as newer, never as a plan', async () => {
    const url = await buildShareUrl('https://room-planner.andrechek.com/', [5, 'From the future']);
    expect(await readPlanLink(url)).toEqual({ ok: false, reason: 'newer', version: 5 });
  });

  it('makes the starter room link far shorter than the v3 link', async () => {
    const base = 'https://room-planner.andrechek.com/';
    const v3 = await buildShareUrl(base, toShareConfig(defaultLayout(), 'Bedroom', 'ft-in'));
    const v4 = await buildPlanUrl(base, starter());
    expect(v4.length).toBeLessThan(v3.length * 0.7);
  });
});
