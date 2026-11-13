import type { FurnitureItem, Id, RoomDims, Wall } from '../types';
import { MAX_ZOOM, MIN_ZOOM } from './constants';
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

export interface ItemWarning {
  outOfBounds: boolean;
  collision: boolean;
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

/** Snap increment and capture window used when a rotation drag ends. */
export const ROTATION_SNAP_STEP = 15;
export const ROTATION_SNAP_THRESHOLD = 5;

/**
 * Normalize to [0, 360) and snap to the nearest 15° (so also every 45°/90°)
 * when within 5° of it - the behavior of the original rotation handle.
 */
export const snapRotation = (
  deg: number,
  step = ROTATION_SNAP_STEP,
  threshold = ROTATION_SNAP_THRESHOLD,
): number => {
  const norm = normalizeDegrees(deg);
  const nearest = Math.round(norm / step) * step;
  return Math.abs(norm - nearest) < threshold ? nearest % 360 : norm;
};

// --- Viewport ---------------------------------------------------------------

export const clampZoom = (zoom: number): number => clamp(zoom, MIN_ZOOM, MAX_ZOOM);

/** Zoom that fits the whole room into the available area, clamped to [0.25, 2]. */
export const computeFitZoom = (
  available: { width: number; height: number },
  room: RoomDims,
  pixelsPerUnit: number,
): number => {
  const zoomX = available.width / (room.width * pixelsPerUnit);
  const zoomY = available.height / (room.height * pixelsPerUnit);
  const fit = Math.min(zoomX, zoomY);
  if (!Number.isFinite(fit)) return 1;
  return Math.max(MIN_ZOOM, Math.min(2, fit));
};
