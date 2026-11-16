import { describe, expect, it } from 'vitest';
import type { Door, DoorType, Hinge, RoomDims, Wall } from '../types';
import { PIXELS_PER_UNIT as P } from './constants';
import type { Point } from './geometry';
import { doorSwingGeometry, doorStyles } from './openings';

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

    expect(g.wall).toBe(wall);
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
    const door: Door = {
      id: 1,
      width: 3,
      position: 12,
      wall: 'left',
      hinge: 'right',
      type: 'swing-in',
    };
    const g = doorSwingGeometry(door, room)!;
    expect(g.hinge).toEqual({ x: 0, y: 10 }); // position clamped to 7, hinge at 7 + 3
    expect(doorSwingGeometry({ ...door, type: 'sliding' }, room)).toBeNull();
  });
});

describe('doorStyles (canvas) draws from the shared geometry', () => {
  it.each(cases)('%s wall, %s, hinge %s', (wall, type, hinge) => {
    const door: Door = { id: 1, width: WIDTH, position: POSITION, wall, hinge, type };
    const g = doorSwingGeometry(door, room)!;
    const s = doorStyles(door, room);
    const left = s.arc.left as number;
    const top = s.arc.top as number;
    const nums = s.arcPath.match(/-?\d+(\.\d+)?/g)!.map(Number);
    // "M x0 y0 A r r 0 0 sweep x1 y1", in the arc box's local pixels.
    const [x0, y0, rx, , , , sweep, x1, y1] = nums;
    expect([left + x0!, top + y0!]).toEqual([g.closedEnd.x * P, g.closedEnd.y * P]);
    expect([left + x1!, top + y1!]).toEqual([g.openEnd.x * P, g.openEnd.y * P]);
    expect(rx).toBe(WIDTH * P);
    expect(sweep).toBe(g.sweep);

    // The leaf runs from the hinge to the open end.
    const p = s.panel as { left: number; top: number; width: number; height: number };
    for (const pt of [g.hinge, g.openEnd]) {
      expect(pt.x * P).toBeGreaterThanOrEqual(p.left);
      expect(pt.x * P).toBeLessThanOrEqual(p.left + p.width);
      expect(pt.y * P).toBeGreaterThanOrEqual(p.top);
      expect(pt.y * P).toBeLessThanOrEqual(p.top + p.height);
    }
    expect(Math.max(p.width, p.height)).toBe(WIDTH * P);
    expect(Math.min(p.width, p.height)).toBe(4);
  });

  it('draws a track and no arc for sliding doors', () => {
    const door: Door = {
      id: 1,
      width: 3,
      position: 2,
      wall: 'top',
      hinge: 'left',
      type: 'sliding',
    };
    const s = doorStyles(door, room);
    expect(s.sliding).toBe(true);
    expect(s.arcPath).toBe('');
    expect(s.track).toMatchObject({ left: 2 * P, width: 3 * P });
  });
});
