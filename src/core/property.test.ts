/**
 * Property tests for the format (docs/design/plan-format.md, section 4, "Guarantees"):
 * arbitrary valid v3 layouts migrate to valid plans that draw the same; arbitrary valid plans
 * round-trip through the compact share form, through a share link and through other units; and
 * lenient loading never throws, whatever it is given.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COLOR_PRESETS } from './colors';
import { loadPlan, type LoadResult } from './load';
import { DOOR_TYPES, Plan, UNITS, type PlanInput } from './schema';
import { compact, roundLength, roundRotation } from './share/compact';
import { buildPlanUrl, readPlanLink } from './share/plan';
import { drawingDifferences } from './testing/equivalence';
import { fromFeet, toFeet } from './units';
import type { Layout } from './testing/v3/types';

const RUNS = { numRuns: 300 };

const ok = (r: LoadResult | { ok: false }): Plan => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};

const len = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const frac = len(0, 1);
const hex = fc
  .tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  )
  .map((c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
const color = fc.oneof(fc.constantFrom(...COLOR_PRESETS.map((p) => p.hex)), hex);

// --- v3 layouts --------------------------------------------------------------------------------

const v3Walls = ['top', 'right', 'bottom', 'left'] as const;

const v3Layout: fc.Arbitrary<Layout> = fc
  .record({ width: len(1, 60), height: len(1, 60) })
  .chain((room) => {
    const opening = fc.record({
      wall: fc.constantFrom(...v3Walls),
      w: frac,
      t: frac,
    });
    const place = (o: { wall: (typeof v3Walls)[number]; w: number; t: number }) => {
      const l = o.wall === 'top' || o.wall === 'bottom' ? room.width : room.height;
      const width = Math.max(0.1, o.w * l);
      return { wall: o.wall, width, position: o.t * Math.max(0, l - width) };
    };
    return fc
      .record({
        roomDims: fc.constant(room),
        doors: fc.array(
          fc.record({
            o: opening,
            type: fc.constantFrom(...DOOR_TYPES),
            hinge: fc.constantFrom('left' as const, 'right' as const),
            swingAngle: fc.option(fc.constantFrom(90 as const, 180 as const), { nil: undefined }),
          }),
          { maxLength: 5 },
        ),
        windows: fc.array(opening, { maxLength: 4 }),
        items: fc.array(
          fc.record({
            label: fc.string({ maxLength: 30 }),
            width: len(0.1, 20),
            height: len(0.1, 20),
            x: len(-10, 70),
            y: len(-10, 70),
            rotation: fc.oneof(fc.integer({ min: 0, max: 359 }), len(0, 359.99)),
            color,
            visible: fc.option(fc.boolean(), { nil: undefined }),
            locked: fc.option(fc.boolean(), { nil: undefined }),
          }),
          { maxLength: 8 },
        ),
      })
      .map(({ roomDims, doors, windows, items }) => ({
        roomDims,
        doors: doors.map((d, i) => {
          const door = { id: i + 1, ...place(d.o), hinge: d.hinge, type: d.type };
          return d.swingAngle ? { ...door, swingAngle: d.swingAngle } : door;
        }),
        windows: windows.map((w, i) => ({ id: 100 + i, ...place(w) })),
        items: items.map((it, i) => {
          const { visible, locked, ...rest } = it;
          return {
            id: i + 1,
            ...rest,
            ...(visible === undefined ? {} : { visible }),
            ...(locked === undefined ? {} : { locked }),
          };
        }),
      }));
  });

describe('3 -> 4', () => {
  it('turns every valid v3 layout into a valid plan that draws the same', () => {
    fc.assert(
      fc.property(v3Layout, (layout) => {
        const plan = ok(loadPlan(layout, 'strict', { lengthsInFeet: true }));
        expect(drawingDifferences(layout, plan)).toEqual([]);
        // Idempotent: loading the result again changes nothing.
        expect(ok(loadPlan(plan, 'strict'))).toEqual(plan);
      }),
      RUNS,
    );
  });
});

// --- v4 plans ------------------------------------------------------------------------------------

type Pt = { x: number; y: number };
/** A clockwise rectangle, or an L (a rectangle without one corner), at an offset. */
const outline: fc.Arbitrary<Pt[]> = fc
  .record({
    x: len(-50, 50),
    y: len(-50, 50),
    w: len(2, 40),
    h: len(2, 40),
    l: fc.boolean(),
    cw: frac,
    ch: frac,
  })
  .map(({ x, y, w, h, l, cw, ch }) => {
    if (!l) {
      return [
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
      ];
    }
    const a = w * (0.2 + 0.6 * cw);
    const b = h * (0.2 + 0.6 * ch);
    return [
      { x, y },
      { x: x + a, y },
      { x: x + a, y: y + b },
      { x: x + w, y: y + b },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
  });

const idOr = (fallback: string) =>
  fc.oneof(fc.constant(fallback), fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/));

const room = (r: number) =>
  outline.chain((pts) =>
    fc.record({
      id: idOr(`room-${r + 1}`),
      name: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
      outline: fc.constant(pts),
      openings: fc.array(
        fc
          .record({
            kind: fc.constantFrom('door' as const, 'window' as const),
            wall: fc.integer({ min: 0, max: pts.length - 1 }),
            w: frac,
            t: frac,
            type: fc.constantFrom(...DOOR_TYPES),
            hinge: fc.constantFrom('start' as const, 'end' as const),
            swingAngle: fc.option(fc.constantFrom(90 as const, 180 as const), { nil: undefined }),
          })
          .map(({ wall, w, t, ...o }) => {
            const a = pts[wall]!;
            const b = pts[(wall + 1) % pts.length]!;
            const l = Math.hypot(b.x - a.x, b.y - a.y);
            const width = Math.max(0.1, w * l * 0.9);
            return { ...o, wall, width, offset: t * (l - width) };
          }),
        { maxLength: 4 },
      ),
    }),
  );

const item = fc
  .record({
    label: fc.string({ maxLength: 30 }),
    color,
    shape: fc.constantFrom('rect' as const, 'l' as const, 'ellipse' as const),
    width: len(0.2, 20),
    depth: len(0.2, 20),
    corner: fc.constantFrom('tl' as const, 'tr' as const, 'br' as const, 'bl' as const),
    cw: len(0.05, 0.95),
    cd: len(0.05, 0.95),
    placement: fc.option(
      fc.record({ x: len(-100, 100), y: len(-100, 100), rotation: len(0, 359.99) }),
      { nil: undefined },
    ),
    locked: fc.option(fc.boolean(), { nil: undefined }),
    hidden: fc.option(fc.boolean(), { nil: undefined }),
    notes: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
  })
  .map(({ corner, cw, cd, ...it }) => {
    const out: Record<string, unknown> = { ...it };
    if (it.shape === 'l') out.cut = { corner, width: it.width * cw, depth: it.depth * cd };
    for (const k of ['placement', 'locked', 'hidden', 'notes'])
      if (out[k] === undefined) delete out[k];
    return out;
  });

const planArb: fc.Arbitrary<Plan> = fc
  .record({
    name: fc.string({ maxLength: 40 }),
    unitSystem: fc.option(fc.constantFrom('ft-in', 'ft', 'in', 'm', 'cm'), { nil: undefined }),
    rooms: fc
      .integer({ min: 1, max: 3 })
      .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => room(i)))),
    items: fc.array(item, { maxLength: 8 }),
    itemIds: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
  })
  .map(({ name, unitSystem, rooms, items, itemIds }) => {
    let door = 0;
    let win = 0;
    const input = {
      version: 4,
      name,
      unit: 'ft',
      ...(unitSystem ? { settings: { unitSystem } } : {}),
      rooms: rooms.map((r) => {
        const { name: roomName, ...rest } = r;
        return {
          ...rest,
          ...(roomName === undefined ? {} : { name: roomName }),
          openings: r.openings.map((o) => ({
            ...o,
            id: o.kind === 'door' ? `door-${++door}` : `window-${++win}`,
          })),
        };
      }),
      items: items.map((it, i) => ({ ...it, id: itemIds[i] ? `item-${i + 1}` : `piece${i}` })),
    };
    // Unique ids: the generators can collide (two rooms named alike); lenient loading fixes that.
    return ok(loadPlan(input, 'lenient'));
  });

/** What the compact form keeps of a plan: known fields only, rounded, default flags dropped. */
const canonical = (p: Plan): PlanInput => ({
  version: 4,
  name: p.name,
  unit: p.unit,
  ...(p.settings?.unitSystem ? { settings: { unitSystem: p.settings.unitSystem } } : {}),
  rooms: p.rooms.map((r) => ({
    id: r.id,
    ...(r.name === undefined ? {} : { name: r.name }),
    outline: r.outline.map((q) => ({ x: roundLength(q.x), y: roundLength(q.y) })),
    openings: r.openings.map((o) => ({
      id: o.id,
      kind: o.kind,
      wall: o.wall,
      offset: roundLength(o.offset),
      width: roundLength(o.width),
      type: o.type,
      hinge: o.hinge,
      ...(o.swingAngle === 180 ? { swingAngle: 180 as const } : {}),
    })),
  })),
  items: p.items.map((i) => ({
    id: i.id,
    label: i.label,
    color: i.color,
    shape: i.shape,
    width: roundLength(i.width),
    depth: roundLength(i.depth),
    ...(i.cut
      ? { cut: { ...i.cut, width: roundLength(i.cut.width), depth: roundLength(i.cut.depth) } }
      : {}),
    ...(i.placement
      ? {
          placement: {
            x: roundLength(i.placement.x),
            y: roundLength(i.placement.y),
            rotation: roundRotation(i.placement.rotation),
          },
        }
      : {}),
    ...(i.locked ? { locked: true } : {}),
    ...(i.hidden ? { hidden: true } : {}),
    ...(i.notes === undefined ? {} : { notes: i.notes }),
  })),
});

describe('compact share form', () => {
  it('expand(compact(p)) is p after the same rounding', () => {
    fc.assert(
      fc.property(planArb, (p) => {
        expect(ok(loadPlan(compact(p), 'lenient'))).toEqual(ok(loadPlan(canonical(p), 'lenient')));
      }),
      RUNS,
    );
  });

  it('decode(encode(p)) through a share link, compressed or not', async () => {
    await fc.assert(
      fc.asyncProperty(planArb, fc.boolean(), async (p, compress) => {
        const url = await buildPlanUrl('https://room-planner.andrechek.com/', p, { compress });
        expect(url).toMatch(compress ? /#s=/ : /#j=/);
        expect(ok(await readPlanLink(url))).toEqual(ok(loadPlan(compact(p), 'lenient')));
      }),
      { numRuns: 100 },
    );
  });

  it('is stable: a plan read from a link compacts to the same link', () => {
    fc.assert(
      fc.property(planArb, (p) => {
        const once = compact(p);
        expect(compact(ok(loadPlan(once, 'lenient')))).toEqual(once);
      }),
      RUNS,
    );
  });
});

describe('units', () => {
  // Half the rounding step of fromFeet, in feet.
  const tolerance = { ft: 5e-7, in: 5e-5 / 12, m: 5e-7 * 3.28084, cm: 5e-5 * 0.0328084 };
  const lengths = (p: Plan): number[] => [
    ...p.rooms.flatMap((r) => [
      ...r.outline.flatMap((q) => [q.x, q.y]),
      ...r.openings.flatMap((o) => [o.offset, o.width]),
    ]),
    ...p.items.flatMap((i) => [
      i.width,
      i.depth,
      ...(i.cut ? [i.cut.width, i.cut.depth] : []),
      ...(i.placement ? [i.placement.x, i.placement.y] : []),
    ]),
  ];

  it('fromFeet then toFeet returns every length within the rounding', () => {
    fc.assert(
      fc.property(planArb, fc.constantFrom(...UNITS), (p, unit) => {
        const back = toFeet(fromFeet(p, unit));
        expect(back.unit).toBe('ft');
        const a = lengths(p);
        const b = lengths(back);
        expect(b).toHaveLength(a.length);
        a.forEach((v, i) =>
          expect(Math.abs(v - b[i]!)).toBeLessThanOrEqual(tolerance[unit] * 1.0001 + 1e-12),
        );
      }),
      RUNS,
    );
  });
});

describe('lenient loading never throws', () => {
  const tryAll = (input: unknown) => {
    for (const mode of ['lenient', 'strict'] as const) {
      const r = loadPlan(input, mode);
      expect(typeof r.ok).toBe('boolean');
      if (r.ok) expect(Plan.safeParse(r.plan).success).toBe(true);
    }
  };

  it('on any JSON', () => {
    fc.assert(fc.property(fc.jsonValue(), tryAll), { numRuns: 500 });
  });

  it('on anything shaped a little like a plan of any version', () => {
    const junk = fc.anything({ maxDepth: 3 });
    fc.assert(
      fc.property(
        fc.oneof(
          fc.record({ roomDims: junk, door: junk, items: junk }),
          fc.record({ roomDims: junk, doors: junk, windows: junk, items: junk, unitSystem: junk }),
          fc.record({ version: fc.constant(4), unit: junk, rooms: fc.array(junk), items: junk }),
          fc.record({
            version: fc.constant(4),
            unit: fc.constantFrom('ft', 'in'),
            rooms: fc.array(
              fc.record({
                id: junk,
                outline: fc.array(fc.record({ x: junk, y: junk })),
                openings: fc.array(junk),
              }),
            ),
            items: fc.array(
              fc.record({
                id: junk,
                label: junk,
                width: junk,
                depth: junk,
                placement: junk,
                shape: junk,
                cut: junk,
              }),
            ),
          }),
          fc.tuple(
            fc.constant(4),
            junk,
            junk,
            junk,
            fc.array(fc.array(junk)),
            fc.array(fc.array(junk)),
          ),
        ),
        tryAll,
      ),
      { numRuns: 1000 },
    );
  });
});
