import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { checkIntegrity, formatIssues, loadPlan, type LoadResult } from './load';
import { PLAN_VERSION, Plan, type PlanInput } from './schema';
import { fromFeet, toFeet } from './units';
import { detectVersion } from './version';

const rect = (w: number, h: number, x = 0, y = 0) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const base = (): PlanInput => ({
  version: 4,
  name: 'Test',
  unit: 'ft',
  rooms: [
    {
      id: 'room-1',
      outline: rect(12, 10),
      openings: [{ id: 'door-1', kind: 'door', wall: 2, offset: 2, width: 3 }],
    },
  ],
  items: [
    { id: 'item-1', label: 'Bed', width: 5, depth: 6.5, placement: { x: 6, y: 4 } },
    { id: 'item-2', label: 'Lamp', width: 1, depth: 1 },
  ],
});

const ok = (r: LoadResult) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
};
const issuesOf = (r: LoadResult) => (r.ok || r.reason !== 'invalid' ? [] : formatIssues(r.issues));

describe('detectVersion', () => {
  it('tells every format apart by its shape', () => {
    expect(detectVersion({ roomDims: {}, door: {}, items: [] })).toBe(2);
    expect(detectVersion({ roomDims: {}, doors: [], door: {}, items: [] })).toBe(3);
    expect(detectVersion({ roomDims: {}, items: [] })).toBe(3);
    expect(detectVersion({ version: 4 })).toBe(4);
    expect(detectVersion([4, 'x'])).toBe(4);
    expect(detectVersion([7])).toBe(7);
    for (const v of [
      null,
      1,
      'x',
      [],
      {},
      { version: '4' },
      { version: 4.5 },
      ['4'],
      { items: [] },
    ]) {
      expect(detectVersion(v)).toBeNull();
    }
  });
});

describe('loadPlan', () => {
  it('loads a valid plan and fills the defaults', () => {
    const r = ok(loadPlan(base(), 'strict'));
    expect(r.from).toBe(4);
    expect(r.repairs).toEqual([]);
    expect(r.plan.rooms[0]!.openings[0]).toMatchObject({ type: 'swing-in', hinge: 'start' });
    expect(r.plan.items[0]).toMatchObject({ color: '#93c5fd', shape: 'rect' });
    expect(r.plan.items[0]!.placement!.rotation).toBe(0);
    expect(r.plan.items[1]!.placement).toBeUndefined(); // in the inventory
  });

  it('never loads a newer document, in any form', () => {
    for (const input of [
      { version: PLAN_VERSION + 1, rooms: 'anything' },
      [PLAN_VERSION + 1, 'x'],
    ]) {
      expect(loadPlan(input, 'lenient')).toEqual({
        ok: false,
        reason: 'newer',
        version: PLAN_VERSION + 1,
      });
    }
  });

  it('does not touch its input', () => {
    const input = base();
    const before = structuredClone(input);
    loadPlan(input, 'lenient');
    expect(input).toEqual(before);
  });

  it('rejects what is not a plan', () => {
    for (const input of [null, 'plan', 42, {}, [], { version: 1 }, { items: [] }]) {
      expect(loadPlan(input, 'lenient')).toMatchObject({ ok: false, reason: 'invalid' });
    }
  });

  it('strict mode reports schema errors with their path', () => {
    const p = base() as Record<string, unknown>;
    p.unit = 'yd';
    expect(issuesOf(loadPlan(p, 'strict'))).toEqual([expect.stringMatching(/^unit: /)]);
  });

  it('strict mode reports integrity errors with their path', () => {
    const p = base();
    p.rooms[0]!.openings![0]!.wall = 4;
    p.items![1]!.id = 'item-1';
    p.items![0]!.shape = 'l';
    expect(issuesOf(loadPlan(p, 'strict'))).toEqual([
      'rooms.0.openings.0.wall: Wall 4 does not exist: the room has walls 0 to 3.',
      'items.0.cut: An L-shaped piece needs a "cut".',
      'items.1.id: The id "item-1" is already used by items.0.',
    ]);
  });

  it('strict mode rejects openings off their wall, crossed and counter-clockwise outlines', () => {
    const off = base();
    off.rooms[0]!.openings![0]!.offset = 10;
    expect(issuesOf(loadPlan(off, 'strict'))[0]).toMatch(/does not fit its wall/);
    const ccw = base();
    ccw.rooms[0]!.outline = rect(12, 10).reverse();
    expect(issuesOf(loadPlan(ccw, 'strict'))[0]).toMatch(/clockwise/);
    const bow = base();
    bow.rooms[0]!.outline = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(issuesOf(loadPlan(bow, 'strict'))[0]).toMatch(/simple polygon/);
  });

  it('lenient mode repairs instead, and says what it did', () => {
    const p = base() as unknown as {
      rooms: Record<string, unknown>[];
      items: Record<string, unknown>[];
    };
    const door = (p.rooms[0]!.openings as Record<string, unknown>[])[0]!;
    door.offset = 10; // off the 12 ft wall: moved onto it
    door.type = 'revolving'; // unknown: the default
    (p.rooms[0]!.openings as unknown[]).push('junk', {
      kind: 'door',
      wall: 9,
      offset: 0,
      width: 3,
    });
    p.items[1]!.id = 'item-1'; // duplicate: a new id
    p.items[0]!.color = 'red'; // not hex: the default
    p.items.push({ label: 'Ghost', width: 0, depth: 1 }); // no size: dropped
    p.items.push({ id: 'x y', label: 'Rug', width: 5, depth: 8, placement: { x: 'a', y: 2 } });
    const r = ok(loadPlan(p, 'lenient'));
    expect(r.plan.rooms[0]!.openings).toHaveLength(1);
    expect(r.plan.rooms[0]!.openings[0]).toMatchObject({ offset: 9, type: 'swing-in' });
    expect(r.plan.items.map((i) => i.id)).toEqual(['item-1', 'item-2', 'item-3']);
    expect(r.plan.items[0]!.color).toBe('#93c5fd');
    expect(r.plan.items[2]!.placement).toBeUndefined();
    expect(r.repairs).toEqual([
      'rooms.0.openings.1: removed (not an object)',
      'rooms.0.openings.0: moved onto its wall',
      'rooms.0.openings.0: reset "type" to its default',
      'rooms.0.openings.2: removed (wall 9 does not exist)',
      'items.0: reset "color" to its default',
      'items.2: removed (no valid width and depth)',
      'items.3: moved to the inventory (no valid position)',
      'items.1: id changed to "item-2"',
      'items.3: id changed to "item-3"',
    ]);
  });

  it('lenient mode reverses a counter-clockwise outline without moving its openings', () => {
    const cw = base();
    cw.rooms[0]!.openings = [
      { id: 'door-1', kind: 'door', wall: 2, offset: 2, width: 3, hinge: 'start' },
      { id: 'window-1', kind: 'window', wall: 1, offset: 1, width: 4 },
    ];
    const ccw = structuredClone(cw);
    // The same room listed the other way: corners 0, 3, 2, 1. Old wall 2 (from (12,10) to
    // (0,10)) is the new wall 1, running from (0,10) to (12,10).
    ccw.rooms[0]!.outline = [rect(12, 10)[0]!, ...rect(12, 10).slice(1).reverse()];
    ccw.rooms[0]!.openings = [
      { id: 'door-1', kind: 'door', wall: 1, offset: 7, width: 3, hinge: 'end' },
      { id: 'window-1', kind: 'window', wall: 2, offset: 5, width: 4 },
    ];
    const fixed = ok(loadPlan(ccw, 'lenient'));
    expect(fixed.repairs).toEqual(['rooms.0.outline: reversed to run clockwise']);
    const want = ok(loadPlan(cw, 'strict')).plan.rooms[0]!;
    const got = fixed.plan.rooms[0]!;
    // Same corners from another start, the same openings on the same walls.
    const rot = got.outline.findIndex(
      (p) => p.x === want.outline[0]!.x && p.y === want.outline[0]!.y,
    );
    expect([...got.outline.slice(rot), ...got.outline.slice(0, rot)]).toEqual(want.outline);
    const shift = (o: (typeof got.openings)[number]) => ({ ...o, wall: (o.wall - rot + 4) % 4 });
    expect(got.openings.map(shift)).toEqual(want.openings);
  });

  it('converts any unit to feet, keeping the unit as the display preference', () => {
    const p = base();
    p.unit = 'in';
    p.rooms[0]!.outline = rect(144, 120);
    p.rooms[0]!.openings![0] = { id: 'door-1', kind: 'door', wall: 2, offset: 24, width: 36 };
    p.items = [{ id: 'item-1', label: 'Bed', width: 60, depth: 80, placement: { x: 72, y: 48 } }];
    const r = ok(loadPlan(p, 'strict'));
    expect(r.plan.unit).toBe('ft');
    expect(r.plan.settings?.unitSystem).toBe('in');
    expect(r.plan.rooms[0]!.outline[2]).toEqual({ x: 12, y: 10 });
    expect(r.plan.rooms[0]!.openings[0]).toMatchObject({ offset: 2, width: 3 });
    expect(r.plan.items[0]).toMatchObject({ width: 5, depth: 80 / 12, placement: { x: 6, y: 4 } });
    expect(fromFeet(r.plan, 'in').items[0]).toMatchObject({ width: 60, depth: 80 });
  });
});

describe('toFeet and fromFeet', () => {
  it('toFeet returns a plan already in feet unchanged', () => {
    const p = Plan.parse(base());
    expect(toFeet(p)).toBe(p);
  });
  it('fromFeet rounds like the export always has', () => {
    const p = Plan.parse(base());
    p.items[0]!.width = 1 / 3;
    expect(fromFeet(p, 'ft').items[0]!.width).toBe(0.333333);
    expect(fromFeet(p, 'in').items[0]!.width).toBe(4);
    expect(fromFeet(p, 'cm').items[0]!.width).toBe(10.16);
    expect(fromFeet(p, 'm').items[0]!.width).toBe(0.1016);
  });
});

describe('checkIntegrity', () => {
  it('passes the base plan', () => {
    expect(checkIntegrity(Plan.parse(base()))).toEqual([]);
  });
  it('allows an L-shaped piece with a smaller cut, and nothing else', () => {
    const p = Plan.parse(base());
    p.items[0]!.shape = 'l';
    p.items[0]!.cut = { corner: 'tr', width: 2, depth: 2 };
    expect(checkIntegrity(p)).toEqual([]);
    p.items[0]!.cut = { corner: 'tr', width: 5, depth: 2 };
    expect(checkIntegrity(p)[0]!.message).toMatch(/smaller/);
    p.items[0]!.shape = 'rect';
    expect(checkIntegrity(p)[0]!.message).toMatch(/Only an L-shaped/);
  });
});

describe('JSON Schema', () => {
  const schema = z.toJSONSchema(Plan, { io: 'input' }) as Record<string, unknown>;
  const text = JSON.stringify(schema);

  it('is draft 2020-12', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('carries every description an agent needs', () => {
    for (const phrase of [
      'Unique within the plan',
      'Wall index. Wall i runs from outline[i] to outline[i+1].',
      'Distance along the wall from its start corner',
      'Width along the wall.',
      'Doors only.',
      'facing the wall, \\"start\\" is on the left',
      'clockwise as drawn (y grows downward)',
      '0 = top, 1 = right, 2 = bottom, 3 = left',
      'Bounding-box size along x before rotation.',
      'Bounding-box size along y before rotation.',
      'Shape \\"l\\" only',
      'Centre of the piece in floor coordinates',
      'Omit it to set the piece aside: kept in the plan, not on the floor.',
      'Unit of every length in this document.',
    ]) {
      expect(text).toContain(phrase);
    }
  });

  it('uses no construct model APIs reject: no tuples, no oneOf; enums as enum', () => {
    expect(text).not.toContain('prefixItems');
    expect(text).not.toContain('oneOf');
    expect(text).toContain('"enum":["ft","in","m","cm"]');
  });

  it('makes defaulted fields optional for writers', () => {
    const props = schema.properties as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(['version', 'name', 'unit', 'rooms', 'items', 'settings']);
    expect(schema.required).toEqual(['version', 'unit', 'rooms']);
  });
});
