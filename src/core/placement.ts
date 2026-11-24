/**
 * Placing things in a plan: where a new piece goes (the free spot nearest the middle of a room),
 * where a new door or window goes, and moving pieces back inside a room that changed.
 *
 * Positions along a wall are scanned in the wall's drawing frame (left to right, top to bottom),
 * which for a rectangle is the order the v3 app always used.
 */
import { GEOMETRY_EPSILON, polygonsOverlap, shrinkPolygon, type Point } from './geometry';
import { activePieces, partInRoom, partsOverlap, planDoors, roomOf } from './check';
import { doorGeometry, type DoorType, type SwingAngle } from './geometry/doors';
import { itemParts, partsBounds } from './geometry/shapes';
import {
  drawingFrame,
  isRectangle,
  offsetFromPosition,
  openingInFrame,
  roomBounds,
  type WallFrame,
} from './geometry/walls';
import type { Item, Opening, Plan, Room } from './schema';

/** Clear space (feet) kept between a new door/window and the openings next to it. */
export const OPENING_GAP = 0.5;
/** Distance (feet) a new opening keeps from the wall's ends (the room's corners), when it can. */
export const CORNER_MARGIN = 0.5;
/** Spacing (feet) of the positions tried along each wall, and of the grid for new pieces. */
export const PLACEMENT_STEP = 0.5;

const round = (n: number) => Math.round(n * 1e6) / 1e6;

// --- Doors and windows ----------------------------------------------------------------------------

export interface OpeningSpotOptions {
  /** For a door: its type, hinge and angle, so its swing and doorway can be kept clear of furniture. */
  swing?: { type?: DoorType; hinge?: Opening['hinge']; swingAngle?: SwingAngle };
  /** An opening to leave out (the one being moved). */
  exclude?: string;
  gap?: number;
  margin?: number;
  step?: number;
}

export interface WallSpot {
  wall: number;
  /** Position in the wall's drawing frame. */
  position: number;
  inMargin: boolean;
  clear: boolean;
}

/**
 * Every free spot for an opening of `width` on `walls` of `room`, in preference order, with what
 * it is good for: `preferred` first on each wall (a drawing-frame position), then from the start
 * of the drawing frame in `step` increments plus the spots just past each opening. A spot must not
 * overlap another opening (`gap` apart). `hingeAtEnd` gives a door's hinge in a wall's frame.
 */
export function wallSpots(
  plan: Pick<Plan, 'items' | 'rooms'>,
  room: Room,
  width: number,
  walls: number[],
  preferred: (wall: number) => number,
  {
    swing,
    hingeAtEnd,
    exclude,
    gap = OPENING_GAP,
    margin = CORNER_MARGIN,
    step = PLACEMENT_STEP,
  }: Omit<OpeningSpotOptions, 'swing'> & {
    swing?: { type?: DoorType; swingAngle?: SwingAngle };
    hingeAtEnd?: (frame: WallFrame & { reversed: boolean }) => boolean;
  },
): WallSpot[] {
  const eps = 1e-9;
  const shapes = activePieces(plan).flatMap(({ parts }) =>
    parts.map((p) => shrinkPolygon(p, GEOMETRY_EPSILON)),
  );
  const spots: WallSpot[] = [];
  for (const wall of walls) {
    const frame = drawingFrame(room, wall);
    const len = frame.length;
    if (width > len + eps) continue;
    const taken = room.openings
      .filter((o) => o.wall === wall && o.id !== exclude)
      .map((o) => {
        const { position, width: w } = openingInFrame(room, o);
        return [position, position + w] as const;
      });
    const free = (p: number) =>
      p >= -eps &&
      p + width <= len + eps &&
      taken.every(([a, b]) => p + width + gap <= a + eps || p >= b + gap - eps);
    const scan: number[] = [len - width, len - width - margin, margin];
    for (let p = 0; p <= len - width + eps; p += step) scan.push(p);
    for (const [, b] of taken) scan.push(b + gap);
    const candidates = [
      Math.min(Math.max(preferred(wall), 0), Math.max(0, len - width)),
      ...scan.map(round).sort((x, y) => x - y),
    ];
    const seen = new Set<number>();
    for (const position of candidates) {
      if (seen.has(position) || !free(position)) continue;
      seen.add(position);
      // A door's own swing or track and its doorway must miss the furniture to count as clear.
      let zones: Point[][] = [];
      if (swing) {
        const g = doorGeometry(
          {
            type: swing.type,
            width,
            position,
            hingeAtEnd: hingeAtEnd?.(frame) ?? false,
            swingAngle: swing.swingAngle,
          },
          frame,
        );
        zones = [...g.clearance, g.doorway];
      }
      spots.push({
        wall,
        position,
        inMargin: position >= margin - eps && position + width <= len - margin + eps,
        clear: !zones.some((z) => shapes.some((sh) => polygonsOverlap(sh, z))),
      });
    }
  }
  return spots;
}

/** The best of `wallSpots`: clear and in the margin, else in the margin, else any. */
export const bestSpot = (spots: WallSpot[]): WallSpot | undefined =>
  spots.find((s) => s.inMargin && s.clear) ?? spots.find((s) => s.inMargin) ?? spots[0];

const hingeFor = (hinge: Opening['hinge'] | undefined) => (frame: { reversed: boolean }) =>
  (hinge === 'end') !== frame.reversed;

/**
 * Where a new door or window of `width` goes in `room`: walls are tried from `preferred.wall`,
 * then in order; the first spot that keeps `margin` from the corners and, for a door, whose swing
 * and doorway miss every piece wins; failing that, the first in the margin; then any free spot.
 * If nothing fits anywhere, `preferred` unchanged.
 */
export function findOpeningSpot(
  plan: Pick<Plan, 'items' | 'rooms'>,
  room: Room,
  width: number,
  preferred: { wall: number; offset: number },
  options: OpeningSpotOptions = {},
): { wall: number; offset: number } {
  const n = room.outline.length;
  const walls = [
    preferred.wall,
    ...Array.from({ length: n }, (_, i) => i).filter((w) => w !== preferred.wall),
  ];
  const prefPosition = openingInFrame(room, { ...preferred, width }).position;
  const best = bestSpot(
    wallSpots(plan, room, width, walls, () => prefPosition, {
      ...options,
      hingeAtEnd: hingeFor(options.swing?.hinge),
    }),
  );
  return best
    ? { wall: best.wall, offset: offsetFromPosition(room, best.wall, best.position, width) }
    : preferred;
}

/**
 * Where an opening goes when it moves to `wall` (its `offset` first), on that wall only; null if
 * it fits nowhere there without overlapping another opening. Pass the opening's id as `exclude`.
 */
export function findOpeningSpotOnWall(
  plan: Pick<Plan, 'items' | 'rooms'>,
  room: Room,
  width: number,
  wall: number,
  offset: number,
  options: OpeningSpotOptions = {},
): number | null {
  const prefPosition = openingInFrame(room, { wall, offset, width }).position;
  const best = bestSpot(
    wallSpots(plan, room, width, [wall], () => prefPosition, {
      ...options,
      hingeAtEnd: hingeFor(options.swing?.hinge),
    }),
  );
  return best ? offsetFromPosition(room, wall, best.position, width) : null;
}

// --- Furniture -----------------------------------------------------------------------------------

/**
 * Top-left corner of a new, unrotated `width` x `height` box in `room`. Positions on a `step` grid
 * centred on the middle of the room's bounding box are tried nearest-first; the first that is
 * inside the room, overlaps no piece (touching is fine) and stays out of every door's swing,
 * track and doorway wins. If nothing is free, the middle.
 */
export function furnitureSpotBox(
  plan: Pick<Plan, 'items' | 'rooms'>,
  room: Room,
  size: { width: number; height: number },
  step = PLACEMENT_STEP,
): { x: number; y: number } {
  const b = roomBounds(room);
  const roomW = b.right - b.left;
  const roomH = b.bottom - b.top;
  const { width, height } = size;
  const centre = { x: roomW / 2 - width / 2, y: roomH / 2 - height / 2 };
  const at = (p: { x: number; y: number }) => ({ x: b.left + p.x, y: b.top + p.y });
  const maxX = roomW - width;
  const maxY = roomH - height;
  if (maxX < -GEOMETRY_EPSILON || maxY < -GEOMETRY_EPSILON) return at(centre);

  // Grid lines through the centre position, plus flush against each wall.
  const axis = (mid: number, max: number): number[] => {
    const out = new Set<number>([0, Math.max(0, max)]);
    for (let p = mid; p >= 0; p -= step) out.add(round(p));
    for (let p = mid + step; p <= max + 1e-9; p += step) out.add(round(p));
    return [...out];
  };
  const xs = axis(centre.x, maxX);
  const ys = axis(centre.y, maxY);
  const candidates: { x: number; y: number; d: number }[] = [];
  for (const x of xs) {
    for (const y of ys) candidates.push({ x, y, d: Math.hypot(x - centre.x, y - centre.y) });
  }
  // Nearest the middle first; ties go to the upper, then the left spot (stable and predictable).
  candidates.sort((p, q) => p.d - q.d || p.y - q.y || p.x - q.x);

  const pieces = activePieces(plan).map((p) => p.parts);
  const doorZones: Point[][] = planDoors(plan).flatMap(({ geometry: g }) => [
    ...g.clearance,
    g.doorway,
  ]);
  const rect = isRectangle(room);
  for (const c of candidates) {
    const { x, y } = at(c);
    const parts = itemParts({
      shape: 'rect',
      width,
      depth: height,
      placement: { x: x + width / 2, y: y + height / 2, rotation: 0 },
    });
    if (!rect && !parts.every((p) => partInRoom(p, room))) continue;
    if (pieces.some((p) => partsOverlap(parts, p) > 0)) continue;
    const shape = shrinkPolygon(parts[0]!, GEOMETRY_EPSILON);
    if (doorZones.some((z) => polygonsOverlap(shape, z))) continue;
    return { x, y };
  }
  return at(centre);
}

/** Where a new `width` x `depth` piece goes in `room`: its placement (centre, no rotation). */
export function findFurnitureSpot(
  plan: Pick<Plan, 'items' | 'rooms'>,
  room: Room,
  size: { width: number; depth: number },
  step = PLACEMENT_STEP,
): NonNullable<Item['placement']> {
  const { x, y } = furnitureSpotBox(plan, room, { width: size.width, height: size.depth }, step);
  return { x: x + size.width / 2, y: y + size.depth / 2, rotation: 0 };
}

/**
 * The shift (not a resize or turn) that puts a piece inside `room`'s bounding box by the least
 * amount; a piece wider or deeper than the room is aligned with its top or left wall. Zero for a
 * piece already inside, or in the inventory.
 */
export function insideShift(item: Item, room: Pick<Room, 'outline'>): { dx: number; dy: number } {
  const parts = itemParts(item);
  if (parts.length === 0) return { dx: 0, dy: 0 };
  const p = partsBounds(parts);
  const r = roomBounds(room);
  const shift = (lo: number, hi: number, min: number, size: number) =>
    lo < min || hi - lo > size ? min - lo : hi > min + size ? min + size - hi : 0;
  return {
    dx: shift(p.left, p.right, r.left, r.right - r.left),
    dy: shift(p.top, p.bottom, r.top, r.bottom - r.top),
  };
}

/**
 * The piece moved the least amount that puts it inside `room` (see `insideShift`). The same
 * object when it already is inside, or is in the inventory. In a room that is not a rectangle
 * (an L, an alcove) a piece still outside after that goes to the nearest spot on a `step` grid
 * that is inside the room and overlaps none of `others` (the other pieces' parts), else the
 * nearest one inside; with neither it stays put and the check reports it (section 3).
 */
export function moveInside(
  item: Item,
  room: Pick<Room, 'outline'>,
  others: readonly Point[][][] = [],
  step = PLACEMENT_STEP / 2,
): Item {
  if (!item.placement) return item;
  const { dx, dy } = insideShift(item, room);
  let at = { x: item.placement.x + dx, y: item.placement.y + dy };
  if (!isRectangle(room)) {
    const spot = nearestInside(item, room, at, others, step);
    if (spot) at = spot;
  }
  const mx = at.x - item.placement.x;
  const my = at.y - item.placement.y;
  if (Math.abs(mx) < GEOMETRY_EPSILON && Math.abs(my) < GEOMETRY_EPSILON) return item;
  return { ...item, placement: { ...item.placement, x: round(at.x), y: round(at.y) } };
}

/** The nearest centre to `from` (on a `step` grid around it) where the piece is in the room. */
function nearestInside(
  item: Item,
  room: Pick<Room, 'outline'>,
  from: { x: number; y: number },
  others: readonly Point[][][],
  step: number,
): { x: number; y: number } | null {
  const base = itemParts(item);
  if (base.length === 0 || !item.placement) return null;
  const ox = from.x - item.placement.x;
  const oy = from.y - item.placement.y;
  const shifted = (dx: number, dy: number) =>
    base.map((part) => part.map((p) => ({ x: p.x + ox + dx, y: p.y + oy + dy })));
  const inside = (parts: Point[][]) => parts.every((p) => partInRoom(p, room));
  if (inside(shifted(0, 0))) return null;
  const pb = partsBounds(shifted(0, 0));
  const rb = roomBounds(room);
  // A coarser grid in a very big room, so the search stays at about 25,000 spots at most.
  step = Math.max(step, Math.max(rb.right - rb.left, rb.bottom - rb.top) / 160);
  // Every shift that keeps the piece's box inside the room's box, nearest first.
  const range = (lo: number, hi: number) => {
    const out: number[] = [];
    for (let k = Math.ceil(lo / step); k * step <= hi + 1e-9; k++) out.push(k * step);
    return out;
  };
  const xs = range(rb.left - pb.left, rb.right - pb.right);
  const ys = range(rb.top - pb.top, rb.bottom - pb.bottom);
  const shifts: { dx: number; dy: number; d: number }[] = [];
  for (const dx of xs) for (const dy of ys) shifts.push({ dx, dy, d: Math.hypot(dx, dy) });
  shifts.sort((a, b) => a.d - b.d || a.dy - b.dy || a.dx - b.dx);
  let fallback: { x: number; y: number } | null = null;
  for (const { dx, dy } of shifts) {
    const parts = shifted(dx, dy);
    if (!inside(parts)) continue;
    const at = { x: from.x + dx, y: from.y + dy };
    if (!others.some((o) => partsOverlap(parts, o) > 0)) return at;
    fallback ??= at;
  }
  return fallback;
}

/** Placed, visible pieces that are (partly) outside every room. */
export const piecesOutside = (plan: Pick<Plan, 'items' | 'rooms'>): Item[] =>
  activePieces(plan)
    .filter(({ parts }) => !roomOf(parts, plan))
    .map(({ item }) => item);
