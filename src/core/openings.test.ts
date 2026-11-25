import { describe, expect, it } from 'vitest';
import type {
  Door,
  DoorType,
  FurnitureItem,
  Hinge,
  Layout,
  RoomDims,
  Wall,
} from './testing/v3/types';
import { PIXELS_PER_UNIT as P } from '../lib/constants';
import type { Point } from './geometry';
import {
  DOORWAY_DEPTH,
  SLIDING_DEPTH,
  doorSwingAngle,
  hasHingeSide,
  isSwingDoor,
  openingDoorGeometry,
  sweptArea,
} from './geometry/doors';
import { loadPlan } from './load';
import { defaultLayout } from './testing/v3/layout';
import { doorSvg } from '../components/planner/openingStyles';
import { doorBlockText, itemWarnings, mainRoom, openingPlace, wallIndex } from '../lib/plans';
import { resizeRoom } from '../lib/edits';

/** The plan the app holds for a v3 layout (what the storage migration makes of it). */
const toPlan = (layout: Layout) => {
  const r = loadPlan(layout, 'strict', { lengthsInFeet: true });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};

/** A room holding just `door`, and the door as the plan holds it. */
const withDoor = (door: Door, dims: RoomDims, items: FurnitureItem[] = []) => {
  const plan = toPlan({ roomDims: dims, doors: [door], windows: [], items });
  const room = mainRoom(plan);
  return { plan, room, opening: room.openings[0]! };
};

/** What the door looks like in the room: its shapes (leaves, panels, doorway) in room feet. */
const doorGeometry = (door: Door, dims: RoomDims, faceOffset = 0) => {
  const { room, opening } = withDoor(door, dims);
  return openingDoorGeometry(room, opening, faceOffset);
};

/** A single-leaf swing door's leaf and arc, as the v3 swing geometry named them; null if none. */
const doorSwingGeometry = (door: Door, dims: RoomDims, faceOffset = 0) => {
  const g = doorGeometry(door, dims, faceOffset);
  if (door.type !== 'swing-in' && door.type !== 'swing-out') return null;
  const l = g.leaves[0]!;
  const pts = sweptArea(l, 15);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    side: g.side,
    radius: l.radius,
    hinge: l.hinge,
    closedEnd: l.closedEnd,
    openEnd: l.openEnd,
    sweep: l.sweep,
    normal: l.v,
    box: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
  };
};

const room: RoomDims = { width: 14, height: 10 };
const WIDTH = 3;
const POSITION = 4;

/**
 * Independent oracle: where a wall's start/end of the opening sit, and which
 * way is "into the room", written out per wall rather than derived.
 */
const expected: Record<Wall, { start: Point; end: Point; inward: Point }> = {
  top: { start: { x: 4, y: 0 }, end: { x: 7, y: 0 }, inward: { x: 0, y: 1 } },
  bottom: { start: { x: 4, y: 10 }, end: { x: 7, y: 10 }, inward: { x: 0, y: -1 } },
  left: { start: { x: 0, y: 4 }, end: { x: 0, y: 7 }, inward: { x: 1, y: 0 } },
  right: { start: { x: 14, y: 4 }, end: { x: 14, y: 7 }, inward: { x: -1, y: 0 } },
};

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const len = (a: Point) => Math.hypot(a.x, a.y);

/** Center of the SVG arc from `a` to `b` (radius r, small-arc, given sweep-flag). */
const svgArcCenter = (a: Point, b: Point, r: number, sweep: 0 | 1): Point => {
  const d = sub(b, a);
  const half = len(d) / 2;
  const h = Math.sqrt(Math.max(0, r * r - half * half));
  const perp = { x: -d.y / len(d), y: d.x / len(d) };
  const sign = sweep === 1 ? 1 : -1;
  return { x: (a.x + b.x) / 2 + sign * perp.x * h, y: (a.y + b.y) / 2 + sign * perp.y * h };
};

const cases: [Wall, DoorType, Hinge][] = [];
for (const wall of ['top', 'right', 'bottom', 'left'] as Wall[]) {
  for (const type of ['swing-in', 'swing-out'] as DoorType[]) {
    for (const hinge of ['left', 'right'] as Hinge[]) cases.push([wall, type, hinge]);
  }
}

describe('doorSwingGeometry', () => {
  it.each(cases)('%s wall, %s, hinge %s', (wall, type, hinge) => {
    const door: Door = { id: 1, width: WIDTH, position: POSITION, wall, hinge, type };
    const g = doorSwingGeometry(door, room)!;
    const e = expected[wall];
    const swingIn = type === 'swing-in';

    const placed = withDoor(door, room);
    expect(openingPlace(placed.room, placed.opening).wall).toBe(wallIndex(wall));
    expect(g.side).toBe(swingIn ? 'inside' : 'outside');
    expect(g.radius).toBe(WIDTH);

    // Hinge at the named end of the opening (left = wall start), closed leaf ending at the other.
    expect(g.hinge).toEqual(hinge === 'left' ? e.start : e.end);
    expect(g.closedEnd).toEqual(hinge === 'left' ? e.end : e.start);

    // The open leaf is perpendicular to the wall, into the room for swing-in, outside for swing-out.
    const n = swingIn ? e.inward : { x: -e.inward.x, y: -e.inward.y };
    expect(g.normal).toEqual({ x: n.x + 0, y: n.y + 0 });
    expect(g.openEnd).toEqual({ x: g.hinge.x + n.x * WIDTH + 0, y: g.hinge.y + n.y * WIDTH + 0 });

    // The arc (closedEnd -> openEnd, sweep-flag) is the quarter circle centered on the hinge...
    const c = svgArcCenter(g.closedEnd, g.openEnd, g.radius, g.sweep);
    expect(c.x).toBeCloseTo(g.hinge.x, 9);
    expect(c.y).toBeCloseTo(g.hinge.y, 9);
    // ...and bulges to the swing side of the wall.
    const mid = sub(
      { x: (g.closedEnd.x + g.openEnd.x) / 2, y: (g.closedEnd.y + g.openEnd.y) / 2 },
      g.hinge,
    );
    expect(Math.sign(dot(mid, e.inward))).toBe(swingIn ? 1 : -1);

    // The swept square is the quarter circle's bounding box, on the swing side.
    expect(g.box.width).toBe(WIDTH);
    expect(g.box.height).toBe(WIDTH);
    const boxCenter = { x: g.box.x + WIDTH / 2, y: g.box.y + WIDTH / 2 };
    expect(Math.sign(dot(sub(boxCenter, e.start), e.inward))).toBe(swingIn ? 1 : -1);
  });

  it('hinges swing-out doors on the exterior face when given a wall thickness', () => {
    const door: Door = {
      id: 1,
      width: 3,
      position: 2,
      wall: 'top',
      hinge: 'left',
      type: 'swing-out',
    };
    const g = doorSwingGeometry(door, room, 0.5)!;
    expect(g.hinge).toEqual({ x: 2, y: -0.5 });
    expect(g.openEnd).toEqual({ x: 2, y: -3.5 });
    // Swing-in doors ignore it: they hinge on the interior face.
    expect(doorSwingGeometry({ ...door, type: 'swing-in' }, room, 0.5)!.hinge).toEqual({
      x: 2,
      y: 0,
    });
  });

  it('keeps the door on its wall when the room shrank, and has no swing for sliding doors', () => {
    // The plan cannot hold a door that overhangs its wall: shrinking the room clamps it.
    const door: Door = {
      id: 1,
      width: 3,
      position: 12,
      wall: 'left',
      hinge: 'right',
      type: 'swing-in',
    };
    const tall = withDoor(door, { width: 14, height: 16 });
    const shrunk = mainRoom(resizeRoom(tall.plan, room));
    const g = openingDoorGeometry(shrunk, shrunk.openings[0]!);
    expect(g.leaves[0]!.hinge).toEqual({ x: 0, y: 10 }); // position clamped to 7, hinge at 7 + 3
    expect(doorSwingGeometry({ ...door, type: 'sliding', position: 7 }, room)).toBeNull();
  });
});

describe('doorSvg (canvas) draws from the shared geometry', () => {
  it.each(cases)('%s wall, %s, hinge %s', (wall, type, hinge) => {
    const door: Door = { id: 1, width: WIDTH, position: POSITION, wall, hinge, type };
    const g = doorSwingGeometry(door, room)!;
    const { room: planRoom, opening } = withDoor(door, room);
    const d = doorSvg(opening, planRoom);
    expect(d.arcs).toHaveLength(1);
    const nums = d.arcs[0]!.match(/-?\d+(\.\d+)?/g)!.map(Number);
    // "M x0 y0 A r r 0 0 sweep x1 y1", in canvas pixels.
    const [x0, y0, rx, , , , sweep, x1, y1] = nums;
    expect([x0, y0]).toEqual([g.closedEnd.x * P, g.closedEnd.y * P]);
    expect([x1, y1]).toEqual([g.openEnd.x * P, g.openEnd.y * P]);
    expect(rx).toBe(WIDTH * P);
    expect(sweep).toBe(g.sweep);
    // The leaf runs from the hinge to the open end, 4px thick.
    const pts = d.panels[0]!.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = pts.filter((_, i) => i % 2 === 0);
    const ys = pts.filter((_, i) => i % 2 === 1);
    for (const pt of [g.hinge, g.openEnd]) {
      expect(xs).toContain(pt.x * P);
      expect(ys).toContain(pt.y * P);
    }
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(Math.max(w, h)).toBeCloseTo(WIDTH * P, 6);
    expect(Math.min(w, h)).toBeCloseTo(4, 6);
  });

  it('draws two panels and no arc for sliding doors, a pocket line for pocket doors', () => {
    const base: Door = {
      id: 1,
      width: 3,
      position: 2,
      wall: 'top',
      hinge: 'left',
      type: 'sliding',
    };
    const svg = (door: Door) => {
      const { room: planRoom, opening } = withDoor(door, room);
      return doorSvg(opening, planRoom);
    };
    const sliding = svg(base);
    expect(sliding.arcs).toEqual([]);
    expect(sliding.panels).toHaveLength(2);
    const pocket = svg({ ...base, type: 'pocket' });
    expect(pocket.arcs).toEqual([]);
    expect(pocket.panels).toEqual([]);
    expect(pocket.pocket).toMatch(/^M /);
    const opening = svg({ ...base, type: 'opening' });
    expect([opening.arcs, opening.panels, opening.pocket]).toEqual([[], [], null]);
  });
});

describe('doorGeometry: every door type', () => {
  const door = (patch: Partial<Door>): Door => ({
    id: 1,
    width: 3,
    position: 2,
    wall: 'bottom',
    hinge: 'left',
    type: 'swing-in',
    ...patch,
  });
  const room12 = { width: 12, height: 12 };
  const close = (a: Point, b: Point) => {
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
  };

  it('a 90deg swing opens perpendicular to the wall; 180deg folds back flat along it', () => {
    const at90 = doorGeometry(door({}), room12);
    expect(at90.leaves).toHaveLength(1);
    close(at90.leaves[0]!.openEnd, { x: 2, y: 9 });
    const at180 = doorGeometry(door({ swingAngle: 180 }), room12);
    close(at180.leaves[0]!.openEnd, { x: -1, y: 12 }); // past the hinge, flat on the wall
    expect(at180.leaves[0]!.angle).toBe(180);
    // The 180deg sweep is a half disc: it reaches the far side of the hinge.
    const xs = at180.clearance[0]!.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-1, 6);
    expect(Math.max(...xs)).toBeCloseTo(5, 6);
    // Missing or anything but 180 means 90; non-swing types ignore it.
    expect(doorSwingAngle({ type: 'swing-in' })).toBe(90);
    expect(doorSwingAngle({ type: 'sliding', swingAngle: 180 })).toBe(90);
    expect(doorSwingAngle({ type: 'double-out', swingAngle: 180 })).toBe(180);
  });

  it('double doors have two half-width leaves hinged at both jambs', () => {
    const g = doorGeometry(door({ type: 'double-in' }), room12);
    expect(g.leaves.map((l) => l.radius)).toEqual([1.5, 1.5]);
    close(g.leaves[0]!.hinge, { x: 2, y: 12 });
    close(g.leaves[1]!.hinge, { x: 5, y: 12 });
    close(g.leaves[0]!.openEnd, { x: 2, y: 10.5 });
    close(g.leaves[1]!.openEnd, { x: 5, y: 10.5 });
    expect(g.clearance).toHaveLength(2);
    expect(doorGeometry(door({ type: 'double-out' }), room12).clearance).toEqual([]);
  });

  it('outward swings need no room inside, but every type keeps a doorway', () => {
    for (const type of ['swing-out', 'double-out', 'pocket', 'opening'] as const) {
      const g = doorGeometry(door({ type }), room12);
      expect(g.clearance).toEqual([]);
      expect(g.doorway).toEqual([
        { x: 2, y: 12 },
        { x: 5, y: 12 },
        { x: 5, y: 12 - DOORWAY_DEPTH },
        { x: 2, y: 12 - DOORWAY_DEPTH },
      ]);
    }
  });

  it('a bi-fold folds towards its hinge side, needing half its width at the jamb', () => {
    const g = doorGeometry(door({ type: 'bifold', width: 3 }), room12);
    expect(g.bifold).not.toBeNull();
    const zone = g.clearance[0]!;
    const depth = (p: Point) => 12 - p.y;
    expect(Math.max(...zone.map(depth))).toBeCloseTo(1.5, 6); // half the width, at the jamb
    // Near the far jamb it needs (almost) nothing.
    const farPts = zone.filter((p) => p.x > 4.9);
    expect(Math.max(...farPts.map(depth))).toBeLessThan(0.2);
    const right = doorGeometry(door({ type: 'bifold', hinge: 'right' }), room12);
    close(right.bifold!.hinge, { x: 5, y: 12 });
  });

  it('sliding panels run in a strip along the inside face; pockets sit in the wall', () => {
    const sl = doorGeometry(door({ type: 'sliding' }), room12);
    expect(sl.slidingPanels).toHaveLength(2);
    const ys = sl.clearance[0]!.map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(12 - SLIDING_DEPTH, 9);
    const pk = doorGeometry(door({ type: 'pocket' }), room12, 0.4);
    expect(pk.pocket).toEqual({ from: { x: 0, y: 12.2 }, to: { x: 2, y: 12.2 } }); // clamped
    const pkRight = doorGeometry(door({ type: 'pocket', hinge: 'right' }), room12, 0.4);
    expect(pkRight.pocket).toEqual({ from: { x: 5, y: 12.2 }, to: { x: 8, y: 12.2 } });
  });

  it('hinge sides and swing types are classified for the door card', () => {
    expect(
      ['swing-in', 'swing-out', 'double-in', 'double-out'].every((t) => isSwingDoor(t as DoorType)),
    ).toBe(true);
    expect(['sliding', 'pocket', 'bifold', 'opening'].some((t) => isSwingDoor(t as DoorType))).toBe(
      false,
    );
    expect(
      ['swing-in', 'swing-out', 'bifold', 'pocket'].every((t) => hasHingeSide(t as DoorType)),
    ).toBe(true);
    expect(
      ['double-in', 'double-out', 'sliding', 'opening'].some((t) => hasHingeSide(t as DoorType)),
    ).toBe(false);
  });
});

describe('door blocks (itemWarnings)', () => {
  const room12 = { width: 12, height: 12 };
  const piece = (patch: Partial<FurnitureItem>): FurnitureItem => ({
    id: 'p',
    label: 'Piece',
    width: 1,
    height: 1,
    x: 0,
    y: 0,
    rotation: 0,
    color: '#93c5fd',
    visible: true,
    ...patch,
  });
  const door = (patch: Partial<Door> = {}): Door => ({
    id: 'd',
    width: 3,
    position: 2,
    wall: 'bottom',
    hinge: 'left',
    type: 'swing-in',
    ...patch,
  });
  /** The pieces that block a door or doorway, keyed by their v3 ids, as v3 `computeDoorBlocks`. */
  const blocks = (items: FurnitureItem[], doors: Door[]) =>
    Object.fromEntries(
      [...itemWarnings(toPlan({ roomDims: room12, doors, windows: [], items }))]
        .filter(([, w]) => w.blocksDoor || w.blocksDoorway)
        .map(([id, w]) => [
          id.replace(/^item-/, ''),
          {
            door: w.blocksDoor,
            doorway: w.blocksDoorway,
            doorIds: w.doorIds!.map((d) => d.replace(/^door-/, '')),
          },
        ]),
    );

  // In a 3ft swing-in door's swing (2.4 ft from the wall), but outside its 1.5 ft doorway.
  const inSwing = piece({ id: 'swing', x: 2.2, y: 9.3, width: 1, height: 1 });
  // In the doorway, in front of the opening.
  const inDoorway = piece({ id: 'way', x: 3, y: 11, width: 1, height: 0.8 });

  it('flags a piece in an inward swing (door) or in the doorway, softer than overlap', () => {
    expect(blocks([inSwing, inDoorway], [door()])).toEqual({
      swing: { door: true, doorway: false, doorIds: ['d'] },
      way: { door: true, doorway: false, doorIds: ['d'] }, // the doorway is inside the swing too
    });
  });

  it('outward swings flag only the doorway', () => {
    expect(blocks([inSwing, inDoorway], [door({ type: 'swing-out' })])).toEqual({
      way: { door: false, doorway: true, doorIds: ['d'] },
    });
  });

  it('openings and pocket doors flag their doorway', () => {
    for (const type of ['opening', 'pocket'] as const) {
      expect(blocks([inSwing, inDoorway], [door({ type })])).toEqual({
        way: { door: false, doorway: true, doorIds: ['d'] },
      });
    }
  });

  it('respects the opening angle: a 180deg swing also sweeps past the hinge', () => {
    const beside = piece({ id: 'beside', x: 0.3, y: 10.6, width: 1, height: 1 });
    expect(blocks([beside], [door()])).toEqual({});
    expect(blocks([beside], [door({ swingAngle: 180 })])).toEqual({
      beside: { door: true, doorway: false, doorIds: ['d'] },
    });
  });

  it('checks both leaves of a double door, a bi-fold fold and a sliding track', () => {
    const nearRightJamb = piece({ id: 'r', x: 4.2, y: 10.7, width: 0.6, height: 0.6 });
    expect(blocks([nearRightJamb], [door({ type: 'double-in' })]).r!.door).toBe(true);
    const atFold = piece({ id: 'f', x: 2.2, y: 10.9, width: 0.5, height: 0.5 });
    expect(blocks([atFold], [door({ type: 'bifold' })]).f!.door).toBe(true);
    const onTrack = piece({ id: 't', x: 3, y: 11.8, width: 0.5, height: 0.5 });
    expect(blocks([onTrack], [door({ type: 'sliding' })]).t!.door).toBe(true);
    const behindTrack = piece({ id: 'b', x: 3, y: 11, width: 0.5, height: 0.5 });
    expect(blocks([behindTrack], [door({ type: 'sliding' })]).b).toEqual({
      door: false,
      doorway: true,
      doorIds: ['d'],
    });
  });

  it('ignores hidden pieces, pieces that only touch, rotated pieces clear of it', () => {
    expect(blocks([{ ...inSwing, visible: false }], [door()])).toEqual({});
    // Flush against the side of the doorway / the edge of the swing: touching is fine.
    const flush = piece({ id: 'flush', x: 5, y: 10.5, width: 1, height: 1.5 });
    expect(blocks([flush], [door({ type: 'opening' })])).toEqual({});
    const rotatedAway = piece({ id: 'rot', x: 6, y: 9, width: 2, height: 0.5, rotation: 30 });
    expect(blocks([rotatedAway], [door()])).toEqual({});
  });

  it('merges into the layout warnings; the starter room has none', () => {
    const w = itemWarnings(
      toPlan({ roomDims: room12, doors: [door()], windows: [], items: [inSwing] }),
    );
    expect(w.get('item-swing')).toMatchObject({
      outOfBounds: false,
      collision: false,
      blocksDoor: true,
      blocksDoorway: false,
    });
    const starter = defaultLayout();
    for (const warning of itemWarnings(toPlan(starter)).values()) {
      expect(warning).toEqual({ outOfBounds: false, collision: false });
    }
    expect(doorBlockText({ door: true, doorway: true })).toBe('Blocks door');
    expect(doorBlockText({ door: false, doorway: true })).toBe('Blocks doorway');
  });
});
