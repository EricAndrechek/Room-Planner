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

// --- Room shapes (PR 7b) ------------------------------------------------------------------------

/** A wall's direction in degrees, clockwise from +x as drawn (y down), in [0, 360). */
export const wallAngle = (room: Outline, i: number): number => {
  const { along } = wallFrame(room, i);
  const deg = (Math.atan2(along.y, along.x) * 180) / Math.PI;
  return (Math.round((((deg % 360) + 360) % 360) * 1e6) / 1e6) % 360;
};

/** Which corner of the bounding box an L-shaped room is missing. */
export type CutCorner = 'tl' | 'tr' | 'br' | 'bl';

/** An L-shaped room: its bounding box, and the rectangle cut from one corner of it. */
export interface LShape {
  width: number;
  height: number;
  corner: CutCorner;
  cutWidth: number;
  cutHeight: number;
}

/**
 * The outline of an L-shaped room with its bounding box's top-left corner at `at`, clockwise from
 * its first corner along the top (the top-left one, unless that is the corner cut away), the same
 * rule a rectangle follows.
 */
export function lOutline(l: LShape, at: Point = { x: 0, y: 0 }): Point[] {
  const { width: W, height: H, cutWidth: cw, cutHeight: ch } = l;
  const pts: [number, number][] =
    l.corner === 'tr'
      ? [
          [0, 0],
          [W - cw, 0],
          [W - cw, ch],
          [W, ch],
          [W, H],
          [0, H],
        ]
      : l.corner === 'br'
        ? [
            [0, 0],
            [W, 0],
            [W, H - ch],
            [W - cw, H - ch],
            [W - cw, H],
            [0, H],
          ]
        : l.corner === 'bl'
          ? [
              [0, 0],
              [W, 0],
              [W, H],
              [cw, H],
              [cw, H - ch],
              [0, H - ch],
            ]
          : [
              [cw, 0],
              [W, 0],
              [W, H],
              [0, H],
              [0, ch],
              [cw, ch],
            ];
  return pts.map(([x, y]) => ({ x: at.x + x + 0, y: at.y + y + 0 }));
}

/**
 * The L-shape a room's outline is, or null: six corners, every wall horizontal or vertical, and
 * the outline exactly the bounding box minus one corner rectangle (listed from any corner).
 */
export function lShapeOf(room: Outline): LShape | null {
  const o = room.outline;
  if (o.length !== 6) return null;
  for (let i = 0; i < 6; i++) {
    const a = o[i]!;
    const b = o[(i + 1) % 6]!;
    if (a.x !== b.x && a.y !== b.y) return null;
    if (a.x === b.x && a.y === b.y) return null;
  }
  const b = roomBounds(room);
  const W = b.right - b.left;
  const H = b.bottom - b.top;
  const corners: [CutCorner, number, number][] = [
    ['tl', b.left, b.top],
    ['tr', b.right, b.top],
    ['br', b.right, b.bottom],
    ['bl', b.left, b.bottom],
  ];
  const missing = corners.filter(([, x, y]) => !o.some((p) => p.x === x && p.y === y));
  if (missing.length !== 1) return null;
  const corner = missing[0]![0];
  // The inner (reflex) corner: the one corner strictly inside the bounding box.
  const inner = o.filter((p) => p.x > b.left && p.x < b.right && p.y > b.top && p.y < b.bottom);
  if (inner.length !== 1) return null;
  const p = inner[0]!;
  const cutWidth = corner === 'tl' || corner === 'bl' ? p.x - b.left : b.right - p.x;
  const cutHeight = corner === 'tl' || corner === 'tr' ? p.y - b.top : b.bottom - p.y;
  const l = { width: W, height: H, corner, cutWidth, cutHeight };
  // The same six corners as the canonical outline (in any rotation), clockwise.
  const want = lOutline(l, { x: b.left, y: b.top });
  const key = (q: Point) => `${q.x},${q.y}`;
  const start = o.findIndex((q) => key(q) === key(want[0]!));
  if (start < 0) return null;
  for (let i = 0; i < 6; i++) if (key(o[(start + i) % 6]!) !== key(want[i]!)) return null;
  return l;
}

/** The kind of shape the editor offers for a room: a rectangle, an L, or any other outline. */
export type RoomShape = 'rect' | 'l' | 'custom';

export const roomShapeOf = (room: Outline): RoomShape =>
  isRectangle(room) ? 'rect' : lShapeOf(room) ? 'l' : 'custom';

/**
 * The index of the corner an outline is listed from in the editor: the top-most, then left-most
 * one (for a rectangle its top-left corner, so its walls are top, right, bottom, left).
 */
export const firstCorner = (outline: readonly Point[]): number => {
  let best = 0;
  for (let i = 1; i < outline.length; i++) {
    const p = outline[i]!;
    const q = outline[best]!;
    if (p.y < q.y || (p.y === q.y && p.x < q.x)) best = i;
  }
  return best;
};
