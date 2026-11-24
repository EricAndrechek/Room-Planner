import type { FurnitureItem, Id, RoomDims, Wall } from '../types';
import { FIT_MIN_ZOOM, MAX_ZOOM, MIN_ZOOM } from './constants';
import { clamp } from './units';

export interface Point {
  x: number;
  y: number;
}

type Box = Pick<FurnitureItem, 'x' | 'y' | 'width' | 'height'> & { rotation?: number };

/**
 * Tolerance (feet) used for both collision and bounds checks, so that pieces
 * placed exactly flush against each other or against a wall are not flagged.
 */
export const GEOMETRY_EPSILON = 0.001;

/**
 * Corners of a rotated rectangle, in room coordinates.
 *
 * Matches how items are drawn: CSS `translate(x, y) rotate(deg)` with the
 * default (center) transform-origin, i.e. the box rotates about its center.
 * Order: top-left, top-right, bottom-right, bottom-left (pre-rotation).
 */
export const getRotatedCorners = (item: Box): Point[] => {
  const { x, y, width, height, rotation = 0 } = item;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const offsets = [
    { dx: -width / 2, dy: -height / 2 },
    { dx: width / 2, dy: -height / 2 },
    { dx: width / 2, dy: height / 2 },
    { dx: -width / 2, dy: height / 2 },
  ];
  return offsets.map(({ dx, dy }) => ({
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos,
  }));
};

/** The two unique edge normals of a rectangle (Separating Axis Theorem). */
const getAxes = (corners: Point[]): Point[] => {
  const axes: Point[] = [];
  for (let i = 0; i < 2; i++) {
    const p1 = corners[i]!;
    const p2 = corners[i + 1]!;
    const nx = -(p2.y - p1.y);
    const ny = p2.x - p1.x;
    const len = Math.hypot(nx, ny);
    if (len > 0) axes.push({ x: nx / len, y: ny / len });
  }
  return axes;
};

const project = (corners: Point[], axis: Point) => {
  let min = Infinity;
  let max = -Infinity;
  for (const c of corners) {
    const p = c.x * axis.x + c.y * axis.y;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
};

/**
 * Whether two (possibly rotated) items overlap, via SAT. Pieces that merely
 * touch (within {@link GEOMETRY_EPSILON}) do not count as overlapping.
 */
export const checkItemsCollision = (a: Box, b: Box): boolean => {
  const ca = getRotatedCorners(a);
  const cb = getRotatedCorners(b);
  for (const axis of [...getAxes(ca), ...getAxes(cb)]) {
    const pa = project(ca, axis);
    const pb = project(cb, axis);
    if (pa.max <= pb.min + GEOMETRY_EPSILON || pb.max <= pa.min + GEOMETRY_EPSILON) {
      return false; // separating axis found
    }
  }
  return true;
};

/** Whether every corner of the (rotated) item lies inside the room. */
export const isItemInBounds = (item: Box, room: RoomDims): boolean =>
  getRotatedCorners(item).every(
    (c) =>
      c.x >= -GEOMETRY_EPSILON &&
      c.y >= -GEOMETRY_EPSILON &&
      c.x <= room.width + GEOMETRY_EPSILON &&
      c.y <= room.height + GEOMETRY_EPSILON,
  );

// --- Polygons -------------------------------------------------------------------------------

/** Move every vertex `by` towards the centroid (so shapes that only touch do not overlap). */
export const shrinkPolygon = (pts: Point[], by: number): Point[] => {
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  return pts.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, d - by) / d;
    return { x: cx + dx * k, y: cy + dy * k };
  });
};

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Whether segments ab and cd cross at a point inside both (not merely touching). */
const segmentsCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
};

/** Even-odd point-in-polygon test (any simple polygon, convex or not). */
export const pointInPolygon = (p: Point, poly: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
};

/**
 * Whether two simple polygons (convex or not, e.g. a rotated piece and a door's swing) overlap:
 * an edge of one crosses an edge of the other, or one has a vertex inside the other.
 */
export const polygonsOverlap = (a: Point[], b: Point[]): boolean => {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a1, a2, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a));
};

export interface ItemWarning {
  outOfBounds: boolean;
  collision: boolean;
  /** In a door's swing, fold or sliding track (softer warning; see `computeLayoutWarnings`). */
  blocksDoor?: boolean;
  /** Standing in a doorway (softer warning). */
  blocksDoorway?: boolean;
  /** The doors it blocks. */
  doorIds?: Id[];
}

/**
 * Collision / out-of-bounds state for every visible item. Hidden items are
 * ignored entirely (they neither warn nor cause warnings).
 */
export const computeItemWarnings = (
  items: FurnitureItem[],
  room: RoomDims,
): Map<Id, ItemWarning> => {
  const visible = items.filter((i) => i.visible !== false);
  const result = new Map<Id, ItemWarning>();
  for (const item of visible) {
    result.set(item.id, {
      outOfBounds: !isItemInBounds(item, room),
      collision: visible.some((other) => other.id !== item.id && checkItemsCollision(item, other)),
    });
  }
  return result;
};

export const warningText = (w: ItemWarning, longCollision = false): string =>
  w.outOfBounds && w.collision
    ? 'Outside room & overlapping'
    : w.outOfBounds
      ? 'Outside room bounds'
      : longCollision
        ? 'Overlapping with other furniture'
        : 'Overlapping furniture';

// --- Walls / openings -------------------------------------------------------

export const isHorizontalWall = (wall: Wall): boolean => wall === 'top' || wall === 'bottom';

export const wallLength = (room: RoomDims, wall: Wall): number =>
  isHorizontalWall(wall) ? room.width : room.height;

/**
 * Apply an edit to a door/window, keeping it on its wall: width is clamped to
 * [minWidth, wall length] and position to [0, wall length - width].
 */
export const constrainOpening = <T extends { width: number; position: number; wall: Wall }>(
  opening: T,
  updates: Partial<T>,
  room: RoomDims,
  minWidth = 1,
): T => {
  const wall = updates.wall ?? opening.wall;
  const len = wallLength(room, wall);
  const width = clamp(updates.width ?? opening.width, minWidth, len);
  const position = clamp(updates.position ?? opening.position, 0, Math.max(0, len - width));
  return { ...opening, ...updates, width, position };
};

// --- Rotation ---------------------------------------------------------------

export const normalizeDegrees = (deg: number): number => ((deg % 360) + 360) % 360;

/** Screen angle (degrees, clockwise from +x, CSS convention) of `p` around `center`. */
export const angleAround = (center: Point, p: Point): number =>
  (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;

/** Smallest signed difference `to - from`, in (-180, 180]. */
export const angleDelta = (from: number, to: number): number => {
  const d = normalizeDegrees(to - from);
  return d > 180 ? d - 360 : d;
};

/** Rotation-handle snapping: magnetic capture (degrees) around the axes and the diagonals. */
export const ROTATION_SNAP_AXIS = 8;
export const ROTATION_SNAP_DIAGONAL = 5;
/** Step used while Shift is held during a rotation drag. */
export const ROTATION_STEP = 15;

/**
 * How a rotation drag treats the angle: `magnetic` (default) pulls onto 0/90/180/270 within 8deg
 * and onto the 45deg diagonals within 5deg; `step` moves in 15deg increments (Shift); `free`
 * (Alt/Option, or the Snap toggle off) follows the pointer in whole degrees.
 */
export type RotationSnapMode = 'magnetic' | 'step' | 'free';

export interface AngleSnap {
  /** Resulting rotation in [0, 360). */
  deg: number;
  /** The angle it locked onto (equal to `deg`), or null when it moved freely. */
  snapped: number | null;
}

/** Snap a rotation (degrees, any range) for the rotate handle. Angular, so zoom-independent. */
export const snapAngle = (raw: number, mode: RotationSnapMode = 'magnetic'): AngleSnap => {
  const norm = normalizeDegrees(raw);
  if (mode === 'step') {
    const deg = normalizeDegrees(Math.round(norm / ROTATION_STEP) * ROTATION_STEP);
    return { deg, snapped: deg };
  }
  if (mode === 'magnetic') {
    const axis = Math.round(norm / 90) * 90;
    if (Math.abs(norm - axis) <= ROTATION_SNAP_AXIS) {
      const deg = normalizeDegrees(axis);
      return { deg, snapped: deg };
    }
    const diagonal = Math.round((norm - 45) / 90) * 90 + 45;
    if (Math.abs(norm - diagonal) <= ROTATION_SNAP_DIAGONAL) {
      const deg = normalizeDegrees(diagonal);
      return { deg, snapped: deg };
    }
  }
  return { deg: normalizeDegrees(Math.round(norm)), snapped: null };
};

// --- Viewport ---------------------------------------------------------------

/** Zoom kept within [`min`, MAX_ZOOM]; `min` is MIN_ZOOM unless a fitted room needs less. */
export const clampZoom = (zoom: number, min: number = MIN_ZOOM): number =>
  clamp(zoom, Math.min(min, MIN_ZOOM), MAX_ZOOM);

/**
 * Zoom that fits the whole room into the available area, clamped to [FIT_MIN_ZOOM, 2]: below
 * MIN_ZOOM only when the room is too big to show at MIN_ZOOM.
 */
export const computeFitZoom = (
  available: { width: number; height: number },
  room: RoomDims,
  pixelsPerUnit: number,
): number => {
  const zoomX = available.width / (room.width * pixelsPerUnit);
  const zoomY = available.height / (room.height * pixelsPerUnit);
  const fit = Math.min(zoomX, zoomY);
  if (!Number.isFinite(fit)) return 1;
  return Math.max(FIT_MIN_ZOOM, Math.min(2, fit));
};
