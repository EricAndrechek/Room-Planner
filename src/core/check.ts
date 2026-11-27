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
import { DOORWAY_DEPTH, openingDoorGeometry, sweptArea, type DoorGeometry } from './geometry/doors';
import { neighbourOf, outlinesOverlap, roomName, sharedLength } from './floor';
import { itemParts, partsBounds } from './geometry/shapes';
import { frameAt, isRectangle, openingInFrame, roomBounds, wallFrame } from './geometry/walls';
import type { Item, Opening, Plan, Room } from './schema';
import type { UnitSystem } from './types';
import { FEET_PER_CM, FEET_PER_INCH, FEET_PER_METER, feetToDisplay, roundNum } from './units';

export type IssueCode =
  | 'item_overlap'
  | 'item_outside_room'
  | 'door_blocked'
  | 'doorway_blocked'
  | 'opening_overlap'
  | 'opening_off_wall'
  | 'room_overlap'
  | 'window_between_rooms'
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
  /**
   * Gaps from TUCKED (6 in) up to this (feet) are reported as `tight_clearance`. Default 2 (24 in).
   */
  minClearance?: number;
  /** Units of the distances in messages. Default: the plan's display setting, else ft-in. */
  unitSystem?: UnitSystem;
  /** Only these kinds of issue (the others are not computed). Default: all. */
  codes?: IssueCode[];
}

/**
 * Below this (feet: 6 in) a gap is on purpose, not tight: chairs side by side or tucked to a
 * table, a nightstand by a bed, a dresser a little off the wall. A person passes neither way, and
 * nobody means to; tight is the gap between this and `minClearance`, too narrow to walk through
 * yet wider than "touching".
 */
export const TUCKED = 0.5;
/** Rounding slack on the TUCKED bound, so a gap written as exactly 6 in counts as 6 in. */
const SLACK = 1e-6;
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

/**
 * Every door with its shape, in plan order (rooms, then the room's openings), and the areas it
 * needs kept clear: `clearance` (what the door sweeps or runs in) and `doorways` (the passage in
 * front of it). A door between two rooms (on a wall they share) has both on both sides: its
 * swing into whichever room it opens into, and a doorway in each room.
 */
export const planDoors = (plan: Pick<Plan, 'rooms'>) =>
  plan.rooms.flatMap((room) =>
    room.openings
      .filter((o) => o.kind === 'door')
      .map((door) => {
        const geometry = openingDoorGeometry(room, door) as DoorGeometry & {
          frame: ReturnType<typeof wallFrame>;
        };
        const other = plan.rooms.length > 1 ? neighbourOf(plan, room, door) : null;
        const clearance = [...geometry.clearance];
        const doorways = [geometry.doorway];
        if (other) {
          // Outward swings sweep the next room; and it has a doorway of its own.
          if (geometry.side === 'outside')
            clearance.push(...geometry.leaves.map((l) => sweptArea(l)));
          const f = geometry.frame;
          const a0 = geometry.position;
          const a1 = a0 + geometry.width;
          doorways.push([
            frameAt(f, a0, 0),
            frameAt(f, a1, 0),
            frameAt(f, a1, -DOORWAY_DEPTH),
            frameAt(f, a0, -DOORWAY_DEPTH),
          ]);
        }
        return { room, door, geometry, other, clearance, doorways };
      }),
  );

const nameOf = (item: Item) => item.label.trim() || 'A piece';

const FEET_PER: Record<UnitSystem, number> = {
  'ft-in': 1,
  ft: 1,
  in: FEET_PER_INCH,
  m: FEET_PER_METER,
  cm: FEET_PER_CM,
};

/**
 * Names for the pieces in messages: the label, with the piece's centre in the display unit
 * ("Chair at (11, 6)", feet for feet and inches) when another piece has the same label, so an
 * agent can tell which one to move.
 */
const pieceNamer = (plan: Pick<Plan, 'items'>, unitSystem: UnitSystem) => {
  const counts = new Map<string, number>();
  for (const { item } of activePieces(plan)) {
    const n = nameOf(item);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const coord = (feet: number) => roundNum(feet / FEET_PER[unitSystem], 2);
  return (item: Item) => {
    const n = nameOf(item);
    if ((counts.get(n) ?? 0) < 2 || !item.placement) return n;
    return `${n} at (${coord(item.placement.x)}, ${coord(item.placement.y)})`;
  };
};

const wallName = (room: Room, wall: number) =>
  isRectangle(room) ? `the ${WALL_NAMES[wall]} wall` : `wall ${wall}`;

/**
 * Where an opening is on a rectangle's wall, seen from above: "7'–10' from the top" on a left or
 * right wall, "from the left" on a top or bottom wall. Empty for any other outline.
 */
export const openingSpan = (room: Room, o: Opening, unitSystem: UnitSystem): string => {
  if (!isRectangle(room) || o.wall > 3) return '';
  const b = roomBounds(room);
  const f = wallFrame(room, o.wall);
  const ends = [o.offset, o.offset + o.width].map((t) =>
    o.wall % 2 === 0 ? f.origin.x + f.along.x * t - b.left : f.origin.y + f.along.y * t - b.top,
  );
  const [a, z] = [Math.min(...ends), Math.max(...ends)];
  const len = (feet: number) => feetToDisplay(Math.max(0, feet), unitSystem);
  return `${len(a)}–${len(z)} from the ${o.wall % 2 === 0 ? 'left' : 'top'}`;
};

const doorName = (
  plan: Plan,
  room: Room,
  door: Opening,
  other: Room | null | undefined,
  unitSystem: UnitSystem,
) => {
  if (other) return `the door between ${roomName(plan, room)} and ${roomName(plan, other)}`;
  const span = openingSpan(room, door, unitSystem);
  return `the door on ${wallName(room, door.wall)}${plan.rooms.length > 1 ? ` of ${roomName(plan, room)}` : ''}${span ? ` (${span})` : ''}`;
};

/** Every issue with the plan's layout, in a stable order. */
export function checkLayout(plan: Plan, options: CheckOptions = {}): Issue[] {
  const unitSystem = options.unitSystem ?? plan.settings?.unitSystem ?? 'ft-in';
  const minClearance = options.minClearance ?? 2;
  const len = (feet: number) => feetToDisplay(feet, unitSystem);
  const want = (code: IssueCode) => !options.codes || options.codes.includes(code);
  const issues: Issue[] = [];
  const pieces = activePieces(plan);
  const named = pieceNamer(plan, unitSystem);
  const doors = want('door_blocked') || want('doorway_blocked') ? planDoors(plan) : [];

  pieces.forEach(({ item, parts }, i) => {
    if (want('item_outside_room') && !roomOf(parts, plan)) {
      issues.push({
        code: 'item_outside_room',
        severity: 'error',
        message: `${named(item)} is outside ${plan.rooms.length > 1 ? 'every room' : 'the room'}.`,
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
          message: `${named(item)} overlaps ${named(other.item)} by ${len(depth)}.`,
          ids: [item.id, other.item.id],
        });
      }
    }
  });

  // Doors: a piece in a door's swing, fold or track (inside the room), or else in its doorway.
  for (const { item, parts } of pieces) {
    const shapes = parts.map((p) => shrinkPolygon(p, GEOMETRY_EPSILON));
    const hits = (zone: Point[]) => shapes.some((sh) => polygonsOverlap(sh, zone));
    for (const { room, door, other, clearance, doorways } of doors) {
      if (clearance.some(hits)) {
        if (!want('door_blocked')) continue;
        issues.push({
          code: 'door_blocked',
          severity: 'warning',
          message: `${named(item)} is in the way of ${doorName(plan, room, door, other, unitSystem)}.`,
          ids: [item.id, door.id],
        });
      } else if (want('doorway_blocked') && doorways.some(hits)) {
        issues.push({
          code: 'doorway_blocked',
          severity: 'warning',
          message: `${named(item)} stands in the doorway of ${doorName(plan, room, door, other, unitSystem)}.`,
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
      if (outlinesOverlap(a, b)) {
        issues.push({
          code: 'room_overlap',
          severity: 'warning',
          message: `${roomName(plan, a)} overlaps ${roomName(plan, b)}.`,
          ids: [a.id, b.id],
        });
      }
    }
  });

  // Windows on a wall another room shares look into that room, not outside.
  for (const room of want('window_between_rooms') && plan.rooms.length > 1 ? plan.rooms : []) {
    for (const o of room.openings) {
      if (o.kind !== 'window') continue;
      if (sharedLength(plan, room, o) <= GEOMETRY_EPSILON) continue;
      const other = neighbourOf(plan, room, o);
      issues.push({
        code: 'window_between_rooms',
        severity: 'warning',
        message: `The window ${o.id} is on a wall ${roomName(plan, room)} shares with ${other ? roomName(plan, other) : 'another room'}.`,
        ids: [o.id, room.id],
      });
    }
  }

  // Tight clearances: straight gaps between pieces, and to the walls of a rectangular room, from
  // TUCKED to minClearance.
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
        if (gap >= TUCKED - SLACK && gap < minClearance) {
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
      if (gap >= TUCKED - SLACK && gap < minClearance) {
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

// --- Grouping, for people and models -----------------------------------------------------------

const SEVERITY_ORDER: Record<Issue['severity'], number> = { error: 0, warning: 1, info: 2 };

/** Issues that read the same (one code, one message), counted once, with every entity list. */
export interface IssueGroup {
  code: IssueCode;
  severity: Issue['severity'];
  message: string;
  /** Each issue's ids, in plan order. */
  ids: string[][];
  count: number;
}

/**
 * Issues grouped by what they say (code and message: "Only 1'6" between Chair and Table." ten
 * times is one group of ten), errors first, then warnings, then info, each in plan order.
 */
export function groupIssues(issues: readonly Issue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const i of issues) {
    const key = `${i.code}\u0000${i.message}`;
    const g = groups.get(key);
    if (g) {
      g.ids.push(i.ids);
      g.count++;
    } else {
      groups.set(key, {
        code: i.code,
        severity: i.severity,
        message: i.message,
        ids: [i.ids],
        count: 1,
      });
    }
  }
  return [...groups.values()]
    .map((g, order) => ({ g, order }))
    .sort(
      (a, b) => SEVERITY_ORDER[a.g.severity] - SEVERITY_ORDER[b.g.severity] || a.order - b.order,
    )
    .map(({ g }) => g);
}
