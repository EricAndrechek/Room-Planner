/**
 * Every edit as a pure function `(plan, args) => plan` (docs/design/plan-format.md, section 6):
 * the app's hooks and the WebMCP tools call the same functions, so each edit is one undo step
 * whoever makes it. An edit that cannot be made (an unknown id, a corner whose removal or move
 * would leave an outline that is not simple) returns the plan unchanged, the same object.
 *
 * Corners change only through `insertVertex`, `removeVertex` and `moveVertex`, which re-anchor
 * the openings (section 3): an opening on a wall the edit did not change stays where it is.
 */
import { GEOMETRY_EPSILON, pointInPolygon, type Point } from './geometry';
import { isSimplePolygon, signedArea2 } from './load';
import {
  drawingFrame,
  frameAt,
  offsetFromPosition,
  openingInFrame,
  wallFrame,
} from './geometry/walls';
import type { Item, Opening, Plan, Room } from './schema';

type Kind = 'room' | 'door' | 'window' | 'item';

/** Every id in the plan (one namespace for rooms, openings and items). */
export const planIds = (plan: Plan): string[] => [
  ...plan.rooms.flatMap((r) => [r.id, ...r.openings.map((o) => o.id)]),
  ...plan.items.map((i) => i.id),
];

/** A new id `<kind>-<n>`, `n` one above the highest in use for that kind. */
export function nextId(plan: Plan, kind: Kind): string {
  let n = 0;
  for (const id of planIds(plan)) {
    const m = new RegExp(`^${kind}-(\\d+)$`).exec(id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `${kind}-${n + 1}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// --- Items ------------------------------------------------------------------------------------

/** Add a piece (given an id with `nextId` if it has none). Without `placement` it goes to the inventory. */
export const addItem = (
  plan: Plan,
  item: Partial<Item> & Pick<Item, 'label' | 'width' | 'depth'>,
): Plan => ({
  ...plan,
  items: [
    ...plan.items,
    { color: '#93c5fd', shape: 'rect', ...item, id: item.id ?? nextId(plan, 'item') } as Item,
  ],
});

const mapItem = (plan: Plan, id: string, f: (item: Item) => Item | null): Plan => {
  const i = plan.items.findIndex((it) => it.id === id);
  if (i < 0) return plan;
  const next = f(plan.items[i]!);
  const items = [...plan.items];
  if (next) items[i] = next;
  else items.splice(i, 1);
  return { ...plan, items };
};

/** Change a piece's fields (its id stays). */
export const updateItem = (plan: Plan, id: string, patch: Partial<Item>): Plan =>
  mapItem(plan, id, (it) => ({ ...it, ...patch, id }));

/** Put a piece's centre at (x, y), keeping its rotation unless one is given. */
export const moveItem = (
  plan: Plan,
  id: string,
  to: { x: number; y: number; rotation?: number },
): Plan =>
  mapItem(plan, id, (it) => ({
    ...it,
    placement: { x: to.x, y: to.y, rotation: to.rotation ?? it.placement?.rotation ?? 0 },
  }));

/** Take a piece out of its room: it keeps its size, colour and name. */
export const toInventory = (plan: Plan, id: string): Plan =>
  mapItem(plan, id, ({ placement: _placement, ...rest }) => rest as Item);

export const removeItem = (plan: Plan, id: string): Plan => mapItem(plan, id, () => null);

// --- Openings ---------------------------------------------------------------------------------

const roomIndex = (plan: Plan, id: string) => plan.rooms.findIndex((r) => r.id === id);

const withRoom = (plan: Plan, index: number, room: Room): Plan => {
  const rooms = [...plan.rooms];
  rooms[index] = room;
  return { ...plan, rooms };
};

/** Add a door or window to a room's wall (given an id with `nextId` if it has none). */
export const addOpening = (
  plan: Plan,
  roomId: string,
  opening: Partial<Opening> & Pick<Opening, 'kind' | 'wall' | 'offset' | 'width'>,
): Plan => {
  const r = roomIndex(plan, roomId);
  if (r < 0) return plan;
  const room = plan.rooms[r]!;
  const o = {
    type: 'swing-in',
    hinge: 'start',
    ...opening,
    id: opening.id ?? nextId(plan, opening.kind),
  } as Opening;
  return withRoom(plan, r, { ...room, openings: [...room.openings, o] });
};

const findOpening = (plan: Plan, id: string) => {
  for (let r = 0; r < plan.rooms.length; r++) {
    const i = plan.rooms[r]!.openings.findIndex((o) => o.id === id);
    if (i >= 0) return { r, i };
  }
  return null;
};

/** Change a door or window (its id stays). */
export const updateOpening = (plan: Plan, id: string, patch: Partial<Opening>): Plan => {
  const at = findOpening(plan, id);
  if (!at) return plan;
  const room = plan.rooms[at.r]!;
  const openings = [...room.openings];
  openings[at.i] = { ...openings[at.i]!, ...patch, id } as Opening;
  return withRoom(plan, at.r, { ...room, openings });
};

export const removeOpening = (plan: Plan, id: string): Plan => {
  const at = findOpening(plan, id);
  if (!at) return plan;
  const room = plan.rooms[at.r]!;
  return withRoom(plan, at.r, { ...room, openings: room.openings.filter((o) => o.id !== id) });
};

// --- Corners ----------------------------------------------------------------------------------

const pointToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/**
 * An outline an edit may produce: simple, clockwise, and with walls that are not neighbours at
 * least GEOMETRY_EPSILON apart, so no later edit can make two of them touch by rounding.
 */
const validOutline = (outline: Point[]) => {
  const n = outline.length;
  if (n < 3 || !isSimplePolygon(outline) || !(signedArea2(outline) > 0)) return false;
  for (let i = 0; i < n; i++) {
    const a = outline[i]!;
    const b = outline[(i + 1) % n]!;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = outline[j]!;
      const d = outline[(j + 1) % n]!;
      const gap = Math.min(
        pointToSegment(a, c, d),
        pointToSegment(b, c, d),
        pointToSegment(c, a, b),
        pointToSegment(d, a, b),
      );
      if (gap <= GEOMETRY_EPSILON) return false;
    }
  }
  return true;
};

/** An opening kept on a wall of length `len`: no wider than it, and not past its end. */
const onWall = (o: Opening, len: number): Opening => {
  const width = Math.min(o.width, len);
  return { ...o, width, offset: clamp(o.offset, 0, len - width) };
};

/**
 * Split wall `wall` at `t` (0 to 1 along it) with a new corner. An opening on that wall goes to
 * the half it is on; one the new corner would cut stays whole on the longer half. Openings on
 * later walls follow their wall's new index. Refused (the plan unchanged) when the new corner
 * would leave walls closer than GEOMETRY_EPSILON (on a sliver of a room, by rounding).
 */
export function insertVertex(plan: Plan, roomId: string, wall: number, t: number): Plan {
  const r = roomIndex(plan, roomId);
  const room = plan.rooms[r];
  if (!room || wall < 0 || wall >= room.outline.length || !(t > 0 && t < 1)) return plan;
  if (room.outline.length >= 64) return plan;
  const f = wallFrame(room, wall);
  const first = f.length * t;
  const second = f.length - first;
  const corner = { x: f.origin.x + f.along.x * first, y: f.origin.y + f.along.y * first };
  const outline = [...room.outline];
  outline.splice(wall + 1, 0, corner);
  // Rounding can put the new corner a hair off the wall: refused if that makes walls touch.
  if (!validOutline(outline)) return plan;
  const openings = room.openings.map((o) => {
    if (o.wall > wall) return { ...o, wall: o.wall + 1 };
    if (o.wall < wall) return o;
    if (o.offset + o.width <= first) return o;
    if (o.offset >= first) return { ...o, wall: wall + 1, offset: o.offset - first };
    return first >= second
      ? onWall(o, first)
      : onWall({ ...o, wall: wall + 1, offset: Math.max(0, o.offset - first) }, second);
  });
  return withRoom(plan, r, { ...room, outline, openings });
}

const project = (p: Point, f: ReturnType<typeof wallFrame>) =>
  (p.x - f.origin.x) * f.along.x + (p.y - f.origin.y) * f.along.y;

/**
 * Remove corner `i`, merging the two walls that meet there. Their openings keep their floor
 * position, projected onto the merged wall and clamped to it. Refused (the plan unchanged) when
 * the room would have fewer than 3 corners or an outline that is not simple.
 */
export function removeVertex(plan: Plan, roomId: string, i: number): Plan {
  const r = roomIndex(plan, roomId);
  const room = plan.rooms[r];
  if (!room) return plan;
  const n = room.outline.length;
  if (i < 0 || i >= n || n <= 3) return plan;
  const outline = room.outline.filter((_, k) => k !== i);
  if (!validOutline(outline)) return plan;
  const before = (i - 1 + n) % n; // the wall that ends at corner i
  // The merged wall's index in the new outline: it starts at corner i - 1.
  const merged = i === 0 ? n - 2 : i - 1;
  const mergedFrame = wallFrame({ outline }, merged);
  const openings = room.openings.map((o) => {
    if (o.wall !== before && o.wall !== i) {
      return { ...o, wall: o.wall > i ? o.wall - 1 : o.wall };
    }
    const f = wallFrame(room, o.wall);
    const start = { x: f.origin.x + f.along.x * o.offset, y: f.origin.y + f.along.y * o.offset };
    const end = {
      x: f.origin.x + f.along.x * (o.offset + o.width),
      y: f.origin.y + f.along.y * (o.offset + o.width),
    };
    const a = project(start, mergedFrame);
    const b = project(end, mergedFrame);
    const offset = Math.min(a, b);
    return onWall(
      { ...o, wall: merged, offset, width: Math.abs(b - a) || o.width },
      mergedFrame.length,
    );
  });
  return withRoom(plan, r, { ...room, outline, openings });
}

/**
 * Move corner `i` to `to`. Each opening on the two walls that meet there keeps its distance from
 * the corner that did not move, clamped to the wall's new length. Refused when the outline would
 * no longer be simple or clockwise.
 */
export function moveVertex(plan: Plan, roomId: string, i: number, to: Point): Plan {
  const r = roomIndex(plan, roomId);
  const room = plan.rooms[r];
  if (!room || i < 0 || i >= room.outline.length) return plan;
  const n = room.outline.length;
  const outline = room.outline.map((p, k) => (k === i ? { ...p, x: to.x, y: to.y } : p));
  if (!validOutline(outline)) return plan;
  const before = (i - 1 + n) % n;
  const moved = { outline };
  const openings = room.openings.map((o) => {
    if (o.wall === before) return onWall(o, wallFrame(moved, before).length);
    if (o.wall !== i) return o;
    // Measured from the far corner, which stayed.
    const oldLen = wallFrame(room, i).length;
    const len = wallFrame(moved, i).length;
    return onWall({ ...o, offset: o.offset + (len - oldLen) }, len);
  });
  return withRoom(plan, r, { ...room, outline, openings });
}

/**
 * Replace a room's outline with another (a new shape: a rectangle made an L, an L's cut changed).
 * Each opening moves to the wall of the new outline nearest to where it was among the walls that
 * run the same way (any wall if none does), keeping the floor position of the start of its
 * drawing, kept on the wall. Refused when the outline is not one an edit may produce.
 */
export function reshapeRoom(plan: Plan, roomId: string, outline: Point[]): Plan {
  const r = roomIndex(plan, roomId);
  const room = plan.rooms[r];
  if (!room || !validOutline(outline)) return plan;
  const next = { outline };
  const frames = outline.map((_, k) => wallFrame(next, k));
  const openings = room.openings.map((o) => {
    const f = wallFrame(room, o.wall);
    const { frame, position, width } = openingInFrame(room, o);
    // Where its drawing starts (its left or top end, as the editor shows it) and its middle.
    const start = frameAt(frame, position, 0);
    const mid = frameAt(frame, position + width / 2, 0);
    const distance = (k: number) => {
      const g = frames[k]!;
      const end = { x: g.origin.x + g.along.x * g.length, y: g.origin.y + g.along.y * g.length };
      return pointToSegment(mid, g.origin, end);
    };
    const same = frames
      .map((g, k) => ({ k, dot: g.along.x * f.along.x + g.along.y * f.along.y }))
      .filter((c) => c.dot > 1 - 1e-6)
      .map((c) => c.k);
    const pool = same.length ? same : frames.map((_, k) => k);
    let wall = pool[0]!;
    for (const k of pool) if (distance(k) < distance(wall) - 1e-9) wall = k;
    const g = drawingFrame(next, wall);
    const w = Math.min(width, g.length);
    const at = Math.min(Math.max(project(start, g), 0), Math.max(0, g.length - w));
    const offset = offsetFromPosition(next, wall, Math.round(at * 1e9) / 1e9, w);
    return onWall({ ...o, wall, width: w, offset: Math.round(offset * 1e9) / 1e9 }, g.length);
  });
  return withRoom(plan, r, { ...room, outline, openings });
}

// --- Rooms ------------------------------------------------------------------------------------

const centreIn = (item: Item, room: Room) =>
  !!item.placement && pointInPolygon(item.placement, room.outline);

/** Move a room by (dx, dy), with the pieces whose centre is in it, in one edit. */
export function moveRoom(plan: Plan, roomId: string, dx: number, dy: number): Plan {
  const r = roomIndex(plan, roomId);
  const room = plan.rooms[r];
  if (!room) return plan;
  const moved = withRoom(plan, r, {
    ...room,
    outline: room.outline.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
  });
  return {
    ...moved,
    items: plan.items.map((it) =>
      centreIn(it, room)
        ? {
            ...it,
            placement: { ...it.placement!, x: it.placement!.x + dx, y: it.placement!.y + dy },
          }
        : it,
    ),
  };
}

/** Delete a room; the pieces whose centre is in it go to the inventory, in one edit. */
export function removeRoom(plan: Plan, roomId: string): Plan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room || plan.rooms.length <= 1) return plan;
  return {
    ...plan,
    rooms: plan.rooms.filter((r) => r.id !== roomId),
    items: plan.items.map((it) => {
      if (!centreIn(it, room)) return it;
      const { placement: _placement, ...rest } = it;
      return rest as Item;
    }),
  };
}

/** Add a room (given an id with `nextId` if it has none). Its outline must be clockwise. */
export const addRoom = (plan: Plan, room: Partial<Room> & Pick<Room, 'outline'>): Plan => ({
  ...plan,
  rooms: [...plan.rooms, { openings: [], ...room, id: room.id ?? nextId(plan, 'room') } as Room],
});

/** Rename a room: an empty name removes it (the room is then called "Room N"). */
export function renameRoom(plan: Plan, roomId: string, name: string): Plan {
  const r = roomIndex(plan, roomId);
  const room = plan.rooms[r];
  if (!room) return plan;
  const trimmed = name.trim().slice(0, 80);
  if ((room.name ?? '') === trimmed) return plan;
  const { name: _old, ...rest } = room;
  return withRoom(plan, r, (trimmed ? { ...rest, name: trimmed } : rest) as Room);
}
