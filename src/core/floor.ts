/**
 * A floor of several rooms (docs/design/plan-format.md, section 3): rooms abut with zero wall
 * thickness, so a wall two rooms share is two collinear edges, one of each room, that overlap and
 * run opposite ways (both outlines are clockwise). Nothing about it is stored: shared walls and the
 * doors between rooms are derived from the outlines, so nothing can disagree.
 *
 * Also here: where a new room goes (flush against a free side of another), moving a room with its
 * walls snapping to the other rooms', the room a point is in, and whether two rooms overlap.
 */
import { GEOMETRY_EPSILON, pointInPolygon, type Point } from './geometry';
import { roomBounds, wallFrame } from './geometry/walls';
import type { Opening, Plan, Room } from './schema';

type Outline = Pick<Room, 'outline'>;
type Bounds = ReturnType<typeof roomBounds>;

const EPS = GEOMETRY_EPSILON;
const clean = (v: number) => Math.round(v * 1e9) / 1e9 + 0;

// --- Shared walls ----------------------------------------------------------------------------------

/** A stretch of wall two rooms share: wall `wallA` of room `a` from `from` to `to` (along it). */
export interface SharedWall {
  a: string;
  wallA: number;
  b: string;
  wallB: number;
  /** The shared stretch along wall `wallA`, in its frame (from its start corner). */
  from: number;
  to: number;
  /** The same stretch in floor coordinates. */
  start: Point;
  end: Point;
}

/**
 * Where wall `j` of `b` lies along wall `i` of `a`, if the two are collinear, run opposite ways and
 * overlap by more than GEOMETRY_EPSILON: the overlap in wall `i`'s frame.
 */
function overlapOnWall(a: Outline, i: number, b: Outline, j: number): [number, number] | null {
  const f = wallFrame(a, i);
  const g = wallFrame(b, j);
  if (f.length <= EPS || g.length <= EPS) return null;
  // Opposite directions (both outlines run clockwise, so a shared wall is walked both ways).
  if (f.along.x * g.along.x + f.along.y * g.along.y > -1 + 1e-6) return null;
  const off = (p: Point) => (p.x - f.origin.x) * f.inward.x + (p.y - f.origin.y) * f.inward.y;
  const gEnd = { x: g.origin.x + g.along.x * g.length, y: g.origin.y + g.along.y * g.length };
  if (Math.abs(off(g.origin)) > EPS || Math.abs(off(gEnd)) > EPS) return null;
  const along = (p: Point) => (p.x - f.origin.x) * f.along.x + (p.y - f.origin.y) * f.along.y;
  const t0 = Math.max(0, Math.min(along(g.origin), along(gEnd)));
  const t1 = Math.min(f.length, Math.max(along(g.origin), along(gEnd)));
  return t1 - t0 > EPS ? [clean(t0), clean(t1)] : null;
}

/** Every wall stretch two rooms share, once per pair (room `a` before room `b` in plan order). */
export function sharedWalls(plan: Pick<Plan, 'rooms'>): SharedWall[] {
  const out: SharedWall[] = [];
  plan.rooms.forEach((a, ia) => {
    for (const b of plan.rooms.slice(ia + 1)) {
      const ba = roomBounds(a);
      const bb = roomBounds(b);
      // Rooms whose boxes do not even touch share nothing.
      if (
        ba.right < bb.left - EPS ||
        bb.right < ba.left - EPS ||
        ba.bottom < bb.top - EPS ||
        bb.bottom < ba.top - EPS
      ) {
        continue;
      }
      for (let i = 0; i < a.outline.length; i++) {
        for (let j = 0; j < b.outline.length; j++) {
          const o = overlapOnWall(a, i, b, j);
          if (!o) continue;
          const f = wallFrame(a, i);
          const at = (t: number) => ({
            x: clean(f.origin.x + f.along.x * t),
            y: clean(f.origin.y + f.along.y * t),
          });
          out.push({
            a: a.id,
            wallA: i,
            b: b.id,
            wallB: j,
            from: o[0],
            to: o[1],
            start: at(o[0]),
            end: at(o[1]),
          });
        }
      }
    }
  });
  return out;
}

/** The stretches of wall `wall` of `room` that another room shares, in that wall's frame. */
export function sharedStretches(
  plan: Pick<Plan, 'rooms'>,
  room: Room,
  wall: number,
): { other: Room; from: number; to: number }[] {
  const out: { other: Room; from: number; to: number }[] = [];
  for (const other of plan.rooms) {
    if (other.id === room.id) continue;
    for (let j = 0; j < other.outline.length; j++) {
      const o = overlapOnWall(room, wall, other, j);
      if (o) out.push({ other, from: o[0], to: o[1] });
    }
  }
  return out;
}

/**
 * The room on the other side of a door or window: the room that shares the wall it is on, where
 * its middle is. Null on an outside wall.
 */
export function neighbourOf(
  plan: Pick<Plan, 'rooms'>,
  room: Room,
  o: Pick<Opening, 'wall' | 'offset' | 'width'>,
): Room | null {
  if (o.wall < 0 || o.wall >= room.outline.length) return null;
  const mid = o.offset + o.width / 2;
  for (const s of sharedStretches(plan, room, o.wall)) {
    if (mid >= s.from - EPS && mid <= s.to + EPS) return s.other;
  }
  return null;
}

/** Every door between two rooms: the room that lists it and the room it opens into. */
export function doorConnections(
  plan: Pick<Plan, 'rooms'>,
): { door: Opening; room: Room; other: Room }[] {
  const out: { door: Opening; room: Room; other: Room }[] = [];
  if (plan.rooms.length < 2) return out;
  for (const room of plan.rooms) {
    for (const door of room.openings) {
      if (door.kind !== 'door') continue;
      const other = neighbourOf(plan, room, door);
      if (other) out.push({ door, room, other });
    }
  }
  return out;
}

/** How much of an opening (feet) lies on a stretch of wall another room shares. */
export function sharedLength(
  plan: Pick<Plan, 'rooms'>,
  room: Room,
  o: Pick<Opening, 'wall' | 'offset' | 'width'>,
): number {
  let total = 0;
  for (const s of sharedStretches(plan, room, o.wall)) {
    total += Math.max(0, Math.min(o.offset + o.width, s.to) - Math.max(o.offset, s.from));
  }
  return total;
}

// --- Where rooms are ---------------------------------------------------------------------------------

/** The bounding box of every room together (the floor). */
export function floorBounds(plan: Pick<Plan, 'rooms'>): Bounds {
  const boxes = plan.rooms.map(roomBounds);
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/** The room a point is in (the first, in plan order, for a point on a shared wall), or null. */
export const roomAt = (plan: Pick<Plan, 'rooms'>, p: Point): Room | null =>
  plan.rooms.find((r) => pointInPolygon(p, r.outline)) ?? null;

const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Segments ab and cd cross at a point inside both (touching or running along does not count). */
const properlyCross = (a: Point, b: Point, c: Point, d: Point) => {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  const e = 1e-9;
  return (
    ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e))
  );
};

/** Points just inside an outline: a little in from the middle of each wall, and from each corner. */
const insidePoints = (room: Outline, depth: number): Point[] => {
  const n = room.outline.length;
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const f = wallFrame(room, i);
    const g = wallFrame(room, i + 1);
    pts.push({
      x: f.origin.x + f.along.x * (f.length / 2) + f.inward.x * depth,
      y: f.origin.y + f.along.y * (f.length / 2) + f.inward.y * depth,
    });
    // Into the room from the corner between walls i and i + 1 (along both inward normals).
    const c = room.outline[(i + 1) % n]!;
    pts.push({
      x: c.x + (f.inward.x + g.inward.x) * depth,
      y: c.y + (f.inward.y + g.inward.y) * depth,
    });
  }
  return pts.filter((p) => pointInPolygon(p, room.outline));
};

/**
 * Whether two rooms overlap (share floor): walls that cross, or a point just inside one that is
 * inside the other. Rooms that only share a wall or a corner do not overlap.
 */
export function outlinesOverlap(a: Outline, b: Outline): boolean {
  const ba = roomBounds(a);
  const bb = roomBounds(b);
  if (
    ba.right <= bb.left + EPS ||
    bb.right <= ba.left + EPS ||
    ba.bottom <= bb.top + EPS ||
    bb.bottom <= ba.top + EPS
  ) {
    return false;
  }
  const n = a.outline.length;
  const m = b.outline.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (
        properlyCross(
          a.outline[i]!,
          a.outline[(i + 1) % n]!,
          b.outline[j]!,
          b.outline[(j + 1) % m]!,
        )
      ) {
        return true;
      }
    }
  }
  const depth = 4 * EPS;
  return (
    insidePoints(a, depth).some((p) => pointInPolygon(p, b.outline)) ||
    insidePoints(b, depth).some((p) => pointInPolygon(p, a.outline))
  );
}

/** The rooms `outline` would overlap (leaving out `except`, the room being moved). */
export const overlappedRooms = (
  plan: Pick<Plan, 'rooms'>,
  outline: Outline,
  except?: string,
): Room[] => plan.rooms.filter((r) => r.id !== except && outlinesOverlap(outline, r));

// --- A new room -------------------------------------------------------------------------------------

const shifted = (outline: readonly Point[], dx: number, dy: number): Point[] =>
  outline.map((p) => ({ ...p, x: clean(p.x + dx), y: clean(p.y + dy) }));

/** Which side of a room a new one went against. */
export type Side = 'right' | 'bottom' | 'left' | 'top';

/**
 * Where `outline` (anywhere: it is moved) goes against a free side of room `from`: flush with that
 * side, so the two share a wall, and overlapping no room. Sides are tried right, bottom, left, top;
 * along a side, lined up with its start, then with its end. When every side is taken, right of the
 * whole floor (sharing no wall). The outline moved there, and the side.
 */
export function besideRoom(
  plan: Pick<Plan, 'rooms'>,
  from: Room,
  outline: readonly Point[],
): { outline: Point[]; side: Side | null } {
  const b = roomBounds(from);
  const o = roomBounds({ outline: [...outline] });
  const w = o.right - o.left;
  const h = o.bottom - o.top;
  const tries: [Side, number, number][] = [
    ['right', b.right, b.top],
    ['right', b.right, b.bottom - h],
    ['bottom', b.left, b.bottom],
    ['bottom', b.right - w, b.bottom],
    ['left', b.left - w, b.top],
    ['left', b.left - w, b.bottom - h],
    ['top', b.left, b.top - h],
    ['top', b.right - w, b.top - h],
  ];
  for (const [side, x, y] of tries) {
    const moved = shifted(outline, x - o.left, y - o.top);
    if (overlappedRooms(plan, { outline: moved }).length === 0) return { outline: moved, side };
  }
  const f = floorBounds(plan);
  return { outline: shifted(outline, f.right + 1 - o.left, f.top - o.top), side: null };
}

// --- Moving a room ----------------------------------------------------------------------------------

/** A line a moving room lined up with: `axis` x is a vertical line at `pos`. */
export interface RoomGuide {
  axis: 'x' | 'y';
  pos: number;
  /** Its extent on the other axis (both rooms), to draw. */
  from: number;
  to: number;
}

/**
 * Where room `roomId` goes when moved by (dx, dy): each axis lines up, within `threshold` feet, a
 * corner of it with a corner of another room (the nearest), so walls end up flush and corners
 * meet. With nothing near, the move is rounded to `step` (0 for none). The snapped move and the
 * guides it lined up with.
 */
export function snapRoomMove(
  plan: Pick<Plan, 'rooms'>,
  roomId: string,
  dx: number,
  dy: number,
  threshold: number,
  step = 0,
): { dx: number; dy: number; guides: RoomGuide[] } {
  const room = plan.rooms.find((r) => r.id === roomId);
  const others = plan.rooms.filter((r) => r.id !== roomId);
  if (!room) return { dx, dy, guides: [] };
  const mine = room.outline;
  const theirs = others.flatMap((r) => r.outline);
  const guides: RoomGuide[] = [];
  const axis = (key: 'x' | 'y', d: number): number => {
    let best: { shift: number; pos: number } | null = null;
    for (const p of mine) {
      for (const q of theirs) {
        const shift = q[key] - (p[key] + d);
        if (Math.abs(shift) <= threshold && (!best || Math.abs(shift) < Math.abs(best.shift))) {
          best = { shift, pos: q[key] };
        }
      }
    }
    if (!best) return step > 0 ? clean(Math.round(d / step) * step) : d;
    const other = key === 'x' ? 'y' : 'x';
    const span = [
      ...mine.map((p) => p[other] + (other === 'x' ? dx : dy)),
      ...theirs.map((p) => p[other]),
    ];
    guides.push({ axis: key, pos: best.pos, from: Math.min(...span), to: Math.max(...span) });
    return clean(d + best.shift);
  };
  const sx = axis('x', dx);
  const sy = axis('y', dy);
  return { dx: sx, dy: sy, guides };
}

/** "Bedroom" for a named room, "Room 2" for the second room without a name. */
export const roomName = (plan: Pick<Plan, 'rooms'>, room: Pick<Room, 'id' | 'name'>): string => {
  const name = room.name?.trim();
  if (name) return name;
  const i = plan.rooms.findIndex((r) => r.id === room.id);
  return `Room ${i < 0 ? plan.rooms.length + 1 : i + 1}`;
};
