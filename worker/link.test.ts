import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { wallFrame } from '../src/core/geometry/walls';
import { loadPlan } from '../src/core/load';
import type { Plan } from '../src/core/schema';
import { readPlanLink } from '../src/core/share/plan';
import { WRITES_V3_LINKS, linkBlockers, linkOmissions, planLink, planToShareConfig } from './link';

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

/** Each opening as floor geometry: its two ends and its hinge point, relative to the room's corner. */
const openingsInFloor = (plan: Plan) => {
  const room = plan.rooms[0]!;
  const left = Math.min(...room.outline.map((p) => p.x));
  const top = Math.min(...room.outline.map((p) => p.y));
  return room.openings
    .map((o) => {
      const f = wallFrame(room, o.wall);
      const at = (t: number) => ({
        x: +(f.origin.x + f.along.x * t - left).toFixed(4),
        y: +(f.origin.y + f.along.y * t - top).toFixed(4),
      });
      const a = at(o.offset);
      const b = at(o.offset + o.width);
      return {
        kind: o.kind,
        ends: [a, b].sort((p, q) => p.x - q.x || p.y - q.y),
        hinge: o.kind === 'door' ? (o.hinge === 'start' ? a : b) : null,
        type: o.kind === 'door' ? o.type : null,
        swingAngle: o.swingAngle ?? null,
      };
    })
    .sort((p, q) => p.kind.localeCompare(q.kind));
};

const itemsInFloor = (plan: Plan) => {
  const room = plan.rooms[0]!;
  const left = Math.min(...room.outline.map((p) => p.x));
  const top = Math.min(...room.outline.map((p) => p.y));
  return plan.items.map((i) => ({
    label: i.label,
    width: +i.width.toFixed(4),
    depth: +i.depth.toFixed(4),
    x: +(i.placement!.x - left).toFixed(4),
    y: +(i.placement!.y - top).toFixed(4),
    rotation: i.placement!.rotation,
    color: i.color,
    hidden: !!i.hidden,
    locked: !!i.locked,
  }));
};

/** What the app opens: the v3 link payload, read the way every link is read. */
const opened = (plan: Plan): Plan => load(planToShareConfig(plan));

describe('v3 links (the app before PR 5)', () => {
  it('is the mode while the app is on v3', () => {
    expect(WRITES_V3_LINKS).toBe(true);
  });

  it('writes a plan the app opens as the same room, openings and pieces', () => {
    const plan = load({
      version: 4,
      name: 'Den',
      unit: 'cm',
      rooms: [
        {
          id: 'den',
          outline: rect(0, 0, 400, 300),
          openings: [
            { id: 'd1', kind: 'door', wall: 2, offset: 30, width: 80, hinge: 'end' },
            { id: 'd2', kind: 'door', wall: 3, offset: 50, width: 90, type: 'double-out' },
            { id: 'd3', kind: 'door', wall: 1, offset: 20, width: 80, swingAngle: 180 },
            { id: 'w1', kind: 'window', wall: 0, offset: 100, width: 120 },
          ],
        },
      ],
      items: [
        { id: 'sofa', label: 'Sofa', width: 213, depth: 91, placement: { x: 200, y: 250 } },
        {
          id: 'tv',
          label: 'TV',
          color: '#fecaca',
          width: 150,
          depth: 40,
          placement: { x: 200, y: 20, rotation: 180 },
          locked: true,
        },
        {
          id: 'lamp',
          label: 'Lamp',
          width: 30,
          depth: 30,
          placement: { x: 30, y: 30 },
          hidden: true,
        },
      ],
    });
    const config = planToShareConfig(plan);
    expect(config.unitSystem).toBe('cm');
    expect(config.roomDims).toEqual({ width: 400, height: 300 });
    const back = opened(plan);
    expect(back.unit).toBe('ft');
    expect(back.settings?.unitSystem).toBe('cm');
    expect(openingsInFloor(back)).toEqual(openingsInFloor(plan));
    expect(itemsInFloor(back)).toEqual(itemsInFloor(plan));
  });

  it('moves the room to the origin and accepts an outline that starts at another corner', () => {
    const plan = load({
      version: 4,
      unit: 'ft',
      rooms: [
        {
          id: 'r',
          // Clockwise from the bottom-right corner of a room at (5, 2).
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
    expect(linkBlockers(plan)).toEqual([]);
    const config = planToShareConfig(plan);
    expect(config.roomDims).toEqual({ width: 12, height: 10 });
    expect(config.doors[0]).toMatchObject({ wall: 'bottom', position: 7, width: 3 });
    expect(config.items[0]).toMatchObject({ x: 3.5, y: 0 });
    const back = opened(plan);
    expect(openingsInFloor(back)).toEqual(openingsInFloor(plan));
    expect(itemsInFloor(back)).toEqual(itemsInFloor(plan));
  });

  it('round-trips any rectangular plan (property)', () => {
    const units = ['ft', 'in', 'm', 'cm'] as const;
    const arb = fc
      .record({
        unit: fc.constantFrom(...units),
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
            type: fc.constantFrom('swing-in', 'swing-out', 'sliding', 'bifold'),
          }),
          { maxLength: 5 },
        ),
        items: fc.array(
          fc.record({
            u: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
            v: fc.double({ min: 0.1, max: 0.9, noNaN: true }),
            width: fc.integer({ min: 2, max: 30 }),
            depth: fc.integer({ min: 2, max: 30 }),
            rotation: fc.constantFrom(0, 45, 90, 270),
            hidden: fc.boolean(),
          }),
          { maxLength: 6 },
        ),
      })
      .map(({ unit, w, d, start, openings, items }) => {
        const corners = rect(0, 0, w, d);
        const outline = [...corners.slice(start), ...corners.slice(0, start)];
        const len = (wall: number) => ((wall + start) % 2 === 0 ? w : d);
        return {
          version: 4,
          unit,
          rooms: [
            {
              id: 'r',
              outline,
              openings: openings.map((o, i) => ({
                id: `o${i}`,
                kind: o.kind,
                wall: o.wall,
                offset: Math.round(o.t * (len(o.wall) - o.width)),
                width: o.width,
                ...(o.kind === 'door' ? { hinge: o.hinge, type: o.type } : {}),
              })),
            },
          ],
          items: items.map((it, i) => ({
            id: `i${i}`,
            label: `Piece ${i}`,
            width: it.width,
            depth: it.depth,
            placement: { x: Math.round(it.u * w), y: Math.round(it.v * d), rotation: it.rotation },
            ...(it.hidden ? { hidden: true } : {}),
          })),
        };
      });
    fc.assert(
      fc.property(arb, (doc) => {
        const plan = load(doc);
        const back = opened(plan);
        expect(openingsInFloor(back)).toEqual(openingsInFloor(plan));
        expect(itemsInFloor(back)).toEqual(itemsInFloor(plan));
      }),
      { numRuns: 150 },
    );
  });

  it('names what the app cannot show yet, and makes no link for it', async () => {
    const plan = load({
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
    expect(linkBlockers(plan)).toEqual([
      'the room is not a rectangle with axis-aligned walls',
      'not rectangular: Table',
      'no placement (inventory): Spare chair',
    ]);
    expect(await planLink(plan, 'https://x.test')).toEqual({
      url: null,
      blockers: linkBlockers(plan),
    });
    const two = load({
      version: 4,
      unit: 'ft',
      rooms: [
        { id: 'a', outline: rect(0, 0, 5, 5) },
        { id: 'b', outline: rect(5, 0, 5, 5) },
      ],
    });
    expect(linkBlockers(two)).toEqual(['it has 2 rooms (the app shows one)']);
  });

  it('says what a link leaves out', () => {
    const plan = load({
      version: 4,
      unit: 'ft',
      rooms: [{ id: 'r', name: 'Office', outline: rect(0, 0, 10, 10) }],
      items: [
        { id: 'd', label: 'Desk', width: 4, depth: 2, notes: 'IKEA', placement: { x: 5, y: 1 } },
      ],
    });
    expect(linkOmissions(plan)).toEqual(['the room name', 'item notes']);
  });

  it('makes a #s= link on the given site that opens as the plan', async () => {
    const plan = load({
      version: 4,
      name: 'Café ☕',
      unit: 'in',
      rooms: [{ id: 'r', outline: rect(0, 0, 120, 96) }],
      items: [{ id: 'd', label: 'Desk', width: 48, depth: 24, placement: { x: 24, y: 12 } }],
    });
    const link = await planLink(plan, 'https://preview.example.dev');
    expect(link.url).toMatch(/^https:\/\/preview\.example\.dev\/#s=[A-Za-z0-9_-]+$/);
    const back = await readPlanLink(link.url!);
    expect(back.ok && back.plan.name).toBe('Café ☕');
    expect(back.ok && itemsInFloor(back.plan)).toEqual(itemsInFloor(plan));
  });
});
