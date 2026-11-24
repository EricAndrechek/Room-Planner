/**
 * Walls of a room (docs/design/plan-format.md, section 3): wall `i` runs from `outline[i]` to
 * `outline[i + 1]`, clockwise, and is never stored.
 */
import type { Opening, Room } from '../schema';
import type { Point } from './index';

/**
 * A wall's frame: `origin` is its start corner, `along` the unit vector towards its end, `inward`
 * the unit normal into the room (the right-hand side of a clockwise outline, y down).
 */
export interface WallFrame {
  origin: Point;
  along: Point;
  inward: Point;
  length: number;
}

type Outline = Pick<Room, 'outline'>;

export const wallCount = (room: Outline): number => room.outline.length;

/** The frame of wall `i`. */
export function wallFrame(room: Outline, i: number): WallFrame {
  const n = room.outline.length;
  const a = room.outline[((i % n) + n) % n]!;
  const b = room.outline[(((i + 1) % n) + n) % n]!;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const along = length > 0 ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : { x: 1, y: 0 };
  return { origin: { x: a.x, y: a.y }, along, inward: { x: -along.y + 0, y: along.x + 0 }, length };
}

export const wallLength = (room: Outline, i: number): number => wallFrame(room, i).length;

/**
 * The frame openings are drawn and placed in: the same wall, but always running left to right
 * (top to bottom for a vertical wall), with the same inward side. `reversed` says it runs against
 * the outline. For a rectangle these are exactly the four frames of the v3 app (where `position`
 * was measured from the left or the top), which keeps drawings and placement unchanged.
 */
export function drawingFrame(room: Outline, i: number): WallFrame & { reversed: boolean } {
  const f = wallFrame(room, i);
  const reversed = f.along.x < 0 || (f.along.x === 0 && f.along.y < 0);
  if (!reversed) return { ...f, reversed };
  return {
    origin: {
      x: f.origin.x + f.along.x * f.length + 0,
      y: f.origin.y + f.along.y * f.length + 0,
    },
    along: { x: -f.along.x + 0, y: -f.along.y + 0 },
    inward: f.inward,
    length: f.length,
    reversed,
  };
}

/** A point `a` along and `d` into the room in a frame. `+ 0` turns -0 into 0. */
export const frameAt = (f: WallFrame, a: number, d: number): Point => ({
  x: f.origin.x + f.along.x * a + f.inward.x * d + 0,
  y: f.origin.y + f.along.y * a + f.inward.y * d + 0,
});

/**
 * An opening in its wall's drawing frame: `position` from the drawing start, its width, both
 * kept on the wall (no wider than it, not past either end), and whether its hinge is at the far
 * end of the drawing frame (the v3 app's `hinge: 'right'`).
 */
export function openingInFrame(
  room: Outline,
  o: Pick<Opening, 'wall' | 'offset' | 'width'> & { hinge?: Opening['hinge'] },
): {
  frame: WallFrame & { reversed: boolean };
  position: number;
  width: number;
  hingeAtEnd: boolean;
} {
  const frame = drawingFrame(room, o.wall);
  const width = Math.min(o.width, frame.length);
  const max = Math.max(0, frame.length - width);
  const offset = Math.min(Math.max(o.offset, 0), max);
  const position = frame.reversed
    ? Math.min(Math.max(frame.length - offset - width, 0), max)
    : offset;
  const atEnd = o.hinge === 'end';
  return { frame, position, width, hingeAtEnd: frame.reversed ? !atEnd : atEnd };
}

/** The offset (from the wall's start corner) of an opening at `position` in its drawing frame. */
export const offsetFromPosition = (
  room: Outline,
  wall: number,
  position: number,
  width: number,
): number => {
  const f = drawingFrame(room, wall);
  return f.reversed ? Math.max(0, f.length - position - width) : position;
};

/** A rectangle with axis-aligned walls, listed clockwise from its top-left corner. */
export const isRectangle = (room: Outline): boolean => {
  const o = room.outline;
  if (o.length !== 4) return false;
  const [a, b, c, d] = o as [Point, Point, Point, Point];
  return a.y === b.y && b.x === c.x && c.y === d.y && d.x === a.x && b.x > a.x && c.y > b.y;
};

/** The bounding box of a room's outline. */
export const roomBounds = (room: Outline) => {
  const xs = room.outline.map((p) => p.x);
  const ys = room.outline.map((p) => p.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
};

/** Twice the signed area: positive for a clockwise outline (y down). */
export const outlineArea = (room: Outline): number => {
  let a = 0;
  const o = room.outline;
  for (let i = 0; i < o.length; i++) {
    const p = o[i]!;
    const q = o[(i + 1) % o.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};
