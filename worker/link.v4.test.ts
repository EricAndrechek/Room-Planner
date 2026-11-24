/**
 * The switch to v4 links: once the app opens v4 plans (PR 5 raises `APP_PLAN_VERSION` to
 * `PLAN_VERSION`), every plan gets a compact v4 link and nothing is blocked.
 */
import { describe, expect, it, vi } from 'vitest';
import { loadPlan } from '../src/core/load';
import { readPlanLink } from '../src/core/share/plan';

vi.mock('../src/lib/planVersion', () => ({ APP_PLAN_VERSION: 4 }));

describe('v4 links (the app after PR 5)', () => {
  it('links every plan in the compact form', async () => {
    const { WRITES_V3_LINKS, linkBlockers, linkOmissions, planLink } = await import('./link');
    expect(WRITES_V3_LINKS).toBe(false);
    const r = loadPlan(
      {
        version: 4,
        name: 'Flat',
        unit: 'ft',
        rooms: [
          {
            id: 'a',
            name: 'Living',
            outline: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
          {
            id: 'b',
            outline: [
              { x: 10, y: 0 },
              { x: 14, y: 0 },
              { x: 14, y: 6 },
              { x: 10, y: 6 },
            ],
          },
        ],
        items: [
          {
            id: 't',
            label: 'Table',
            shape: 'ellipse',
            width: 3,
            depth: 3,
            placement: { x: 5, y: 5 },
          },
          { id: 's', label: 'Spare chair', width: 2, depth: 2, notes: 'in storage' },
        ],
      },
      'strict',
    );
    if (!r.ok) throw new Error('invalid');
    expect(linkBlockers(r.plan)).toEqual([]);
    expect(linkOmissions(r.plan)).toEqual([]);
    const link = await planLink(r.plan, 'https://room-planner.andrechek.com');
    const back = await readPlanLink(link.url!);
    expect(back.ok && back.from).toBe(4);
    expect(back.ok && back.plan.rooms.map((x) => x.id)).toEqual(['a', 'b']);
    expect(back.ok && back.plan.items[1]!.notes).toBe('in storage');
  });
});
