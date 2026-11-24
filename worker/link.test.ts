import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { wallFrame } from '../src/core/geometry/walls';
import { loadPlan } from '../src/core/load';
import type { Plan } from '../src/core/schema';
import { readPlanLink } from '../src/core/share/plan';
import { editablePlan } from '../src/lib/plans';
import { planLink } from './link';

const ORIGIN = 'https://room-planner.andrechek.com';

const load = (doc: unknown): Plan => {
  const r = loadPlan(doc, 'strict');
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};

const rect = (x: number, y: number, w: number, d: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + d },
  { x, y: y + d },
];

/** Each opening as floor geometry relative to the room's corner: ends and hinge point. */
const openingsInFloor = (plan: Plan) => {
  const room = plan.rooms[0]!;
  const left = Math.min(...room.outline.map((p) => p.x));
  const top = Math.min(...room.outline.map((p) => p.y));
  return room.openings
    .map((o) => {
      const f = wallFrame(room, o.wall);
      const at = (t: number) => ({
        x: f.origin.x + f.along.x * t - left,
        y: f.origin.y + f.along.y * t - top,
      });
      const a = at(o.offset);
      const b = at(o.offset + o.width);
      return {
        kind: o.kind,
        ends: [a, b].sort((p, q) => p.x - q.x || p.y - q.y),
        hinge: o.kind === 'door' ? (o.hinge === 'start' ? a : b) : null,
        type: o.kind === 'door' ? o.type : null,
      };
    })
    .sort((p, q) => p.kind.localeCompare(q.kind) || p.ends[0]!.x - q.ends[0]!.x);
};

const itemsInFloor = (plan: Plan) => {
  const room = plan.rooms[0]!;
  const left = Math.min(...room.outline.map((p) => p.x));
  const top = Math.min(...room.outline.map((p) => p.y));
  return plan.items.map((i) => ({
    label: i.label,
    notes: i.notes ?? null,
    width: i.width,
    depth: i.depth,
    x: i.placement!.x - left,
    y: i.placement!.y - top,
    rotation: i.placement!.rotation,
    hidden: !!i.hidden,
  }));
};

/** `a` and `b` agree, numbers within the link's rounding (4 decimals of a foot). */
const same = (a: unknown, b: unknown): void => {
  if (typeof a === 'number' && typeof b === 'number') {
    expect(Math.abs(a - b)).toBeLessThan(2e-4);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    expect(a.length).toBe(b.length);
    a.forEach((v, i) => same(v, b[i]));
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    for (const k of Object.keys(a))
      same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]);
  } else {
    expect(a).toEqual(b);
  }
};

const opened = async (plan: Plan): Promise<Plan> => {
  const link = await planLink(plan, ORIGIN);
  if (!link.url) throw new Error('no link');
  const r = await readPlanLink(link.url);
  if (!r.ok) throw new Error('unreadable link');
  return r.plan;
};

describe('edit links', () => {
  it('are compact v4 links on the given site that open as the same plan', async () => {
    const plan = load({
      version: 4,
      name: 'Café ☕',
      unit: 'cm',
      rooms: [
        {
          id: 'den',
          name: 'Den',
          outline: rect(0, 0, 400, 300),
          openings: [
            { id: 'd1', kind: 'door', wall: 2, offset: 30, width: 80, hinge: 'end' },
            { id: 'w1', kind: 'window', wall: 0, offset: 100, width: 120 },
          ],
        },
      ],
      items: [
        {
          id: 'sofa',
          label: 'Sofa',
          width: 213,
          depth: 91,
          notes: 'grey',
          placement: { x: 200, y: 250 },
        },
        {
          id: 'tv',
          label: 'TV',
          width: 150,
          depth: 40,
          placement: { x: 200, y: 20, rotation: 180 },
        },
      ],
    });
    const link = await planLink(plan, 'https://preview.example.dev');
    expect(link.url).toMatch(/^https:\/\/preview\.example\.dev\/#s=[A-Za-z0-9_-]+$/);
    const back = await opened(plan);
    expect(back.name).toBe('Café ☕');
    expect(back.rooms[0]!.name).toBe('Den');
    expect(back.settings?.unitSystem).toBe('cm');
    same(openingsInFloor(back), openingsInFloor(plan));
    same(itemsInFloor(back), itemsInFloor(plan));
  });

  it('turn a rectangle that starts at another corner, away from the origin, into the editor form', async () => {
    const plan = load({
      version: 4,
      unit: 'ft',
      rooms: [
        {
          id: 'r',
          outline: [
            { x: 17, y: 12 },
            { x: 5, y: 12 },
            { x: 5, y: 2 },
            { x: 17, y: 2 },
          ],
          openings: [{ id: 'd', kind: 'door', wall: 0, offset: 2, width: 3 }],
        },
      ],
      items: [{ id: 'bed', label: 'Bed', width: 5, depth: 6.5, placement: { x: 11, y: 5.25 } }],
    });
    const back = await opened(plan);
    expect(back.rooms[0]!.outline[0]).toEqual({ x: 0, y: 0 });
    same(openingsInFloor(back), openingsInFloor(plan));
    same(itemsInFloor(back), itemsInFloor(plan));
  });

  it('round-trip any rectangular plan (property)', async () => {
    const arb = fc
      .record({
        unit: fc.constantFrom('ft', 'in', 'm', 'cm'),
        w: fc.integer({ min: 40, max: 400 }),
        d: fc.integer({ min: 40, max: 400 }),
        start: fc.integer({ min: 0, max: 3 }),
        openings: fc.array(
          fc.record({
            kind: fc.constantFrom('door', 'window'),
            wall: fc.integer({ min: 0, max: 3 }),
            t: fc.double({ min: 0, max: 0.5, noNaN: true }),
            width: fc.integer({ min: 5, max: 20 }),
            hinge: fc.constantFrom('start', 'end'),
          }),
          { maxLength: 4 },
        ),
        items: fc.array(
          fc.record({
            u: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
            v: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
            width: fc.integer({ min: 2, max: 30 }),
            depth: fc.integer({ min: 2, max: 30 }),
            rotation: fc.constantFrom(0, 45, 90, 270),
          }),
          { maxLength: 5 },
        ),
      })
      .map(({ unit, w, d, start, openings, items }) => {
        const corners = rect(0, 0, w, d);
        const len = (wall: number) => ((wall + start) % 2 === 0 ? w : d);
        return {
          version: 4,
          unit,
          rooms: [
            {
              id: 'r',
              outline: [...corners.slice(start), ...corners.slice(0, start)],
              openings: openings.map((o, i) => ({
                id: `o${i}`,
                kind: o.kind,
                wall: o.wall,
                offset: Math.round(o.t * (len(o.wall) - o.width)),
                width: o.width,
                ...(o.kind === 'door' ? { hinge: o.hinge } : {}),
              })),
            },
          ],
          items: items.map((it, i) => ({
            id: `i${i}`,
            label: `Piece ${i}`,
            width: it.width,
            depth: it.depth,
            placement: { x: Math.round(it.u * w), y: Math.round(it.v * d), rotation: it.rotation },
          })),
        };
      });
    await fc.assert(
      fc.asyncProperty(arb, async (doc) => {
        const plan = load(doc);
        const back = await opened(plan);
        same(openingsInFloor(back), openingsInFloor(plan));
        same(itemsInFloor(back), itemsInFloor(plan));
      }),
      { numRuns: 100 },
    );
  });

  it('are withheld, with the reasons, exactly when the editor cannot open the plan', async () => {
    const lShaped = load({
      version: 4,
      unit: 'ft',
      rooms: [
        {
          id: 'l',
          outline: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 5 },
            { x: 5, y: 5 },
            { x: 5, y: 10 },
            { x: 0, y: 10 },
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
          placement: { x: 2, y: 2 },
        },
        { id: 's', label: 'Spare chair', width: 2, depth: 2 },
      ],
    });
    const twoRooms = load({
      version: 4,
      unit: 'ft',
      rooms: [
        { id: 'a', outline: rect(0, 0, 5, 5) },
        { id: 'b', outline: rect(5, 0, 5, 5) },
      ],
    });
    for (const plan of [lShaped, twoRooms]) {
      const link = await planLink(plan, ORIGIN);
      const verdict = editablePlan(plan);
      expect(verdict.ok).toBe(false);
      expect(link).toEqual({ url: null, blockers: !verdict.ok ? verdict.why : [] });
      expect(link.url === null && link.blockers.length).toBeGreaterThan(0);
    }
  });
});
