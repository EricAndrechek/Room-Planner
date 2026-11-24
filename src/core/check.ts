/**
 * Every problem with a plan's layout, as issues an agent or the canvas can act on (docs/design/
 * plan-format.md, section 7): pieces that overlap or are outside the rooms, pieces in a door's
 * swing or doorway, openings that overlap or leave their wall, rooms that overlap, and tight
 * clearances. Pieces in the inventory and hidden pieces never take part.
 */
import {
  GEOMETRY_EPSILON,
  pointInPolygon,
  polygonsOverlap,
  shrinkPolygon,
  type Point,
} from './geometry';
import { openingDoorGeometry, type DoorGeometry } from './geometry/doors';
import { itemParts, partsBounds } from './geometry/shapes';
import { isRectangle, openingInFrame, roomBounds, wallFrame } from './geometry/walls';
import type { Item, Opening, Plan, Room } from './schema';
import type { UnitSystem } from './types';
import { feetToDisplay } from './units';

export type IssueCode =
  | 'item_overlap'
  | 'item_outside_room'
  | 'door_blocked'
  | 'doorway_blocked'
  | 'opening_overlap'
  | 'opening_off_wall'
  | 'room_overlap'
  | 'tight_clearance'
  | 'unknown_field';

export interface Issue {
  code: IssueCode;
  severity: 'error' | 'warning' | 'info';
  /** A full sentence, with names and distances in the display unit. */
  message: string;
  /** The ids of the entities concerned: the piece first, then what it collides with. */
  ids: string[];
}

export interface CheckOptions {
  /** Gaps above zero and below this (feet) are reported as `tight_clearance`. Default 2 (24 in). */
  minClearance?: number;
  /** Units of the distances in messages. Default: the plan's display setting, else ft-in. */
  unitSystem?: UnitSystem;
  /** Only these kinds of issue (the others are not computed). Default: all. */
  codes?: IssueCode[];
}

/** Below this (feet, about 1/16 in) a gap is flush, not tight. */
const MIN_GAP = 0.005;
const WALL_NAMES = ['top', 'right', 'bottom', 'left'];

// --- Shapes ----------------------------------------------------------------------------------

/** Every edge normal of a convex polygon (the separating axes). */
const axes = (poly: Point[]): Point[] => {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const nx = -(q.y - p.y);
    const ny = q.x - p.x;
    const len = Math.hypot(nx, ny);
    if (len > 0) out.push({ x: nx / len, y: ny / len });
  }
  return out;
};

const project = (poly: Point[], axis: Point) => {
  let min = Infinity;
  let max = -Infinity;
  for (const c of poly) {
    const p = c.x * axis.x + c.y * axis.y;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
};

/**
 * How deep two convex polygons overlap (the smallest push that separates them), or 0 when they
 * only touch within GEOMETRY_EPSILON or are apart: the separating-axis test.
 */
export const convexOverlap = (a: Point[], b: Point[]): number => {
  let depth = Infinity;
  for (const axis of [...axes(a), ...axes(b)]) {
    const pa = project(a, axis);
    const pb = project(b, axis);
    if (pa.max <= pb.min + GEOMETRY_EPSILON || pb.max <= pa.min + GEOMETRY_EPSILON) return 0;
    depth = Math.min(depth, Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min));
  }
  return depth;
};

type Bounds = ReturnType<typeof partsBounds>;
const boundsApart = (a: Bounds, b: Bounds) =>
  a.right <= b.left + GEOMETRY_EPSILON ||
  b.right <= a.left + GEOMETRY_EPSILON ||
  a.bottom <= b.top + GEOMETRY_EPSILON ||
  b.bottom <= a.top + GEOMETRY_EPSILON;

/** How deep two pieces (lists of convex parts) overlap; 0 when they do not. */
export const partsOverlap = (a: Point[][], b: Point[][]): number => {
  if (boundsApart(partsBounds(a), partsBounds(b))) return 0;
  let depth = 0;
  for (const pa of a) for (const pb of b) depth = Math.max(depth, convexOverlap(pa, pb));
  return depth;
};

const segmentsCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const cross = (o: Point, p: Point, q: Point) =>
    (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
};

/** Distance from `p` to segment ab. */
const segmentDistance = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const onOutline = (p: Point, outline: Point[]) =>
  outline.some(
    (a, i) => segmentDistance(p, a, outline[(i + 1) % outline.length]!) <= GEOMETRY_EPSILON,
  );

/**
 * Whether a convex part lies inside a room: every corner inside or on the outline, no edge
 * properly crossing a wall, and no concave room corner strictly inside the part. A rectangle
 * room takes the same corner test the v3 app did, within GEOMETRY_EPSILON of each wall.
 */
export const partInRoom = (part: Point[], room: Pick<Room, 'outline'>): boolean => {
  if (isRectangle(room)) {
    const b = roomBounds(room);
    return part.every(
      (c) =>
        c.x >= b.left - GEOMETRY_EPSILON &&
        c.y >= b.top - GEOMETRY_EPSILON &&
        c.x <= b.right + GEOMETRY_EPSILON &&
        c.y <= b.bottom + GEOMETRY_EPSILON,
    );
  }
  const o = room.outline;
  if (!part.every((c) => pointInPolygon(c, o) || onOutline(c, o))) return false;
  for (let i = 0; i < part.length; i++) {
    const a = part[i]!;
    const b = part[(i + 1) % part.length]!;
    for (let j = 0; j < o.length; j++)
      if (segmentsCross(a, b, o[j]!, o[(j + 1) % o.length]!)) return false;
  }
  const shrunk = shrinkPolygon(part, GEOMETRY_EPSILON);
  return !o.some((c) => pointInPolygon(c, shrunk));
};

/** The room a piece is in (every part inside it), or null. */
export const roomOf = (parts: Point[][], plan: Pick<Plan, 'rooms'>): Room | null =>
  parts.length === 0
    ? null
    : (plan.rooms.find((r) => parts.every((p) => partInRoom(p, r))) ?? null);

// --- The check ---------------------------------------------------------------------------------

/** The pieces that take part in checks (placed and not hidden), with their parts. */
export const activePieces = (plan: Pick<Plan, 'items'>) =>
  plan.items
    .filter((i) => i.placement && !i.hidden)
    .map((item) => ({ item, parts: itemParts(item) }));

/** Every door with its shape, in plan order (rooms, then the room's openings). */
export const planDoors = (plan: Pick<Plan, 'rooms'>) =>
  plan.rooms.flatMap((room) =>
    room.openings
      .filter((o) => o.kind === 'door')
      .map((door) => ({ room, door, geometry: openingDoorGeometry(room, door) as DoorGeometry })),
  );

const nameOf = (item: Item) => item.label.trim() || 'A piece';

const wallName = (room: Room, wall: number) =>
  isRectangle(room) ? `the ${WALL_NAMES[wall]} wall` : `wall ${wall}`;

const doorName = (plan: Plan, room: Room, door: Opening) =>
  `the door on ${wallName(room, door.wall)}${plan.rooms.length > 1 ? ` of ${room.name || room.id}` : ''}`;

/** Every issue with the plan's layout, in a stable order. */
export function checkLayout(plan: Plan, options: CheckOptions = {}): Issue[] {
  const unitSystem = options.unitSystem ?? plan.settings?.unitSystem ?? 'ft-in';
  const minClearance = options.minClearance ?? 2;
  const len = (feet: number) => feetToDisplay(feet, unitSystem);
  const want = (code: IssueCode) => !options.codes || options.codes.includes(code);
  const issues: Issue[] = [];
  const pieces = activePieces(plan);
  const doors = want('door_blocked') || want('doorway_blocked') ? planDoors(plan) : [];

  pieces.forEach(({ item, parts }, i) => {
    if (want('item_outside_room') && !roomOf(parts, plan)) {
      issues.push({
        code: 'item_outside_room',
        severity: 'error',
        message: `${nameOf(item)} is outside ${plan.rooms.length > 1 ? 'every room' : 'the room'}.`,
        ids: [item.id],
      });
    }
    for (let j = i + 1; want('item_overlap') && j < pieces.length; j++) {
      const other = pieces[j]!;
      const depth = partsOverlap(parts, other.parts);
      if (depth > 0) {
        issues.push({
          code: 'item_overlap',
          severity: 'error',
          message: `${nameOf(item)} overlaps ${nameOf(other.item)} by ${len(depth)}.`,
          ids: [item.id, other.item.id],
        });
      }
    }
  });

  // Doors: a piece in a door's swing, fold or track (inside the room), or else in its doorway.
  for (const { item, parts } of pieces) {
    const shapes = parts.map((p) => shrinkPolygon(p, GEOMETRY_EPSILON));
    const hits = (zone: Point[]) => shapes.some((sh) => polygonsOverlap(sh, zone));
    for (const { room, door, geometry } of doors) {
      if (geometry.clearance.some(hits)) {
        if (!want('door_blocked')) continue;
        issues.push({
          code: 'door_blocked',
          severity: 'warning',
          message: `${nameOf(item)} is in the way of ${doorName(plan, room, door)}.`,
          ids: [item.id, door.id],
        });
      } else if (want('doorway_blocked') && hits(geometry.doorway)) {
        issues.push({
          code: 'doorway_blocked',
          severity: 'warning',
          message: `${nameOf(item)} stands in the doorway of ${doorName(plan, room, door)}.`,
          ids: [item.id, door.id],
        });
      }
    }
  }

  // Openings: off their wall, or overlapping another on the same wall.
  for (const room of want('opening_off_wall') || want('opening_overlap') ? plan.rooms : []) {
    const spans = room.openings.map((o) => {
      const f = wallFrame(room, o.wall);
      const off =
        o.wall >= room.outline.length || o.offset < 0 || o.offset + o.width > f.length + 1e-3;
      if (want('opening_off_wall') && off) {
        issues.push({
          code: 'opening_off_wall',
          severity: 'error',
          message: `The ${o.kind} ${o.id} does not fit on ${wallName(room, o.wall)}.`,
          ids: [o.id],
        });
      }
      const { position, width } = openingInFrame(room, o);
      return { o, from: position, to: position + width };
    });
    spans.forEach((a, i) => {
      for (const b of want('opening_overlap') ? spans.slice(i + 1) : []) {
        if (
          a.o.wall === b.o.wall &&
          a.from < b.to - GEOMETRY_EPSILON &&
          b.from < a.to - GEOMETRY_EPSILON
        ) {
          issues.push({
            code: 'opening_overlap',
            severity: 'warning',
            message: `The ${a.o.kind} ${a.o.id} and the ${b.o.kind} ${b.o.id} overlap on ${wallName(room, a.o.wall)}.`,
            ids: [a.o.id, b.o.id],
          });
        }
      }
    });
  }

  // Rooms that overlap (rooms that share a wall only touch).
  plan.rooms.forEach((a, i) => {
    for (const b of want('room_overlap') ? plan.rooms.slice(i + 1) : []) {
      const sa = shrinkPolygon(a.outline, GEOMETRY_EPSILON);
      const sb = shrinkPolygon(b.outline, GEOMETRY_EPSILON);
      if (polygonsOverlap(sa, sb)) {
        issues.push({
          code: 'room_overlap',
          severity: 'warning',
          message: `${a.name || a.id} overlaps ${b.name || b.id}.`,
          ids: [a.id, b.id],
        });
      }
    }
  });

  // Tight clearances: straight gaps between pieces, and to the walls of a rectangular room.
  const bounds = pieces.map((p) => partsBounds(p.parts));
  (want('tight_clearance') ? pieces : []).forEach(({ item, parts }, i) => {
    const b = bounds[i]!;
    const room = roomOf(parts, plan);
    if (room && isRectangle(room)) {
      const r = roomBounds(room);
      const gaps: [string, number][] = [
        ['top', b.top - r.top],
        ['right', r.right - b.right],
        ['bottom', r.bottom - b.bottom],
        ['left', b.left - r.left],
      ];
      for (const [side, gap] of gaps) {
        if (gap > MIN_GAP && gap < minClearance) {
          issues.push({
            code: 'tight_clearance',
            severity: 'info',
            message: `${nameOf(item)} is ${len(gap)} from the ${side} wall.`,
            ids: [item.id],
          });
        }
      }
    }
    for (let j = i + 1; j < pieces.length; j++) {
      const o = bounds[j]!;
      const across = Math.min(b.bottom, o.bottom) - Math.max(b.top, o.top);
      const along = Math.min(b.right, o.right) - Math.max(b.left, o.left);
      const gap =
        across > 1e-6
          ? Math.max(o.left - b.right, b.left - o.right)
          : along > 1e-6
            ? Math.max(o.top - b.bottom, b.top - o.bottom)
            : -1;
      if (gap > MIN_GAP && gap < minClearance) {
        issues.push({
          code: 'tight_clearance',
          severity: 'info',
          message: `Only ${len(gap)} between ${nameOf(item)} and ${nameOf(pieces[j]!.item)}.`,
          ids: [item.id, pieces[j]!.item.id],
        });
      }
    }
  });
  return issues;
}
