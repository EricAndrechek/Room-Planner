/**
 * The editor's edits as pure functions `(plan, args) => plan`, over core/ops.ts and core
 * placement. Room edits act on one room of the floor (`roomId`, the first room when it is left
 * out), of any outline, whose doors and windows sit on its walls, numbered as the outline lists
 * them (plans.ts); a door or window edit finds its room by the opening's id. Each returns the plan
 * unchanged (the same object) when there is nothing to do.
 */
import {
  insideShift,
  bestSpot,
  clearSpot,
  findFurnitureSpot,
  furnitureSpotBox,
  moveInside,
  wallSpots,
} from '../core/placement';
import { activePieces, partsOverlap, roomOf } from '../core/check';
import { besideRoom, overlappedRooms, roomAt, roomName } from '../core/floor';
import { itemParts } from '../core/geometry/shapes';
import { GEOMETRY_EPSILON, type Point } from '../core/geometry';
import {
  addItem,
  addRoom as addRoomOp,
  insertVertex,
  moveRoom,
  moveVertex,
  nextId,
  removeItem,
  removeOpening,
  removeRoom,
  removeVertex,
  reshapeRoom,
  toInventory,
  updateItem,
} from '../core/ops';
import {
  isRectangle,
  lOutline,
  lShapeOf,
  roomBounds,
  wallFrame,
  type LShape,
} from '../core/geometry/walls';
import { clamp } from '../core/units';
import type { Id, Item, Opening, Plan, Room, RoomDims } from '../types';
import {
  hingeFor,
  openingPlace,
  roomById,
  roomOfOpening,
  patchPiece,
  placeOn,
  rectOutline,
  roomSize,
  type PiecePatch,
} from './plans';

/** The plan with `room` in place of the room with its id. */
const withRoom = (plan: Plan, room: Room): Plan => ({
  ...plan,
  rooms: plan.rooms.map((r) => (r.id === room.id ? room : r)),
});

const wallLen = (room: Pick<Room, 'outline'>, wall: number) => wallFrame(room, wall).length;

// --- Room size -------------------------------------------------------------------------------

/**
 * The room resized to `dims` (from its top-left corner). Each door and window keeps its distance
 * from the left (or top) end of its wall, kept on the wall if the wall got shorter; pieces stay
 * where they are (the planner offers to move those now outside back in).
 */
export function resizeRoom(plan: Plan, dims: RoomDims, roomId?: Id): Plan {
  const room = roomById(plan, roomId);
  const size = roomSize(room);
  if (size.width === dims.width && size.height === dims.height) return plan;
  const b = roomBounds(room);
  const next: Room = {
    ...room,
    outline: rectOutline(dims.width, dims.height).map((p) => ({
      x: p.x + b.left,
      y: p.y + b.top,
    })),
  };
  next.openings = room.openings.map((o) => {
    const place = openingPlace(room, o);
    const len = wallLen(next, place.wall);
    const width = Math.min(place.width, len);
    const position = clamp(place.position, 0, Math.max(0, len - width));
    const at = placeOn(next, place.wall, position, width);
    if (at.offset === o.offset && width === o.width) return o;
    return { ...o, ...at, width };
  });
  return withRoom(plan, next);
}

// --- Room shape ------------------------------------------------------------------------------

/** What the Shape control offers. */
export type ShapeChoice = 'rect' | 'l' | 'custom';

/** An L's cut-out corner by default: half the room each way, in whole feet. */
export const defaultLShape = (dims: RoomDims): LShape => ({
  width: dims.width,
  height: dims.height,
  // The bottom-right corner: the starter room's door and window stay where they are.
  corner: 'br',
  cutWidth: Math.max(0.5, Math.round(dims.width / 2)),
  cutHeight: Math.max(0.5, Math.round(dims.height / 2)),
});

/** The shortest wall an L made from the Shape fields may have (feet). */
export const L_MIN_SIDE = 0.5;

/** `l` kept valid: the cut inside the bounding box, with every wall at least `L_MIN_SIDE`. */
export const fitLShape = (l: LShape): LShape => ({
  ...l,
  cutWidth: clamp(l.cutWidth, L_MIN_SIDE, Math.max(L_MIN_SIDE, l.width - L_MIN_SIDE)),
  cutHeight: clamp(l.cutHeight, L_MIN_SIDE, Math.max(L_MIN_SIDE, l.height - L_MIN_SIDE)),
});

/**
 * The room made a rectangle (its bounding box) or the L `l` (from the room's top-left corner),
 * with each door and window moved to the nearest wall that runs the same way (`reshapeRoom`). The
 * same plan if the room already is that shape.
 */
export function setRoomShape(
  plan: Plan,
  shape: { kind: 'rect' } | { kind: 'l'; l: LShape },
  roomId?: Id,
): Plan {
  const room = roomById(plan, roomId);
  const b = roomBounds(room);
  const at = { x: b.left, y: b.top };
  if (shape.kind === 'rect') {
    if (isRectangle(room)) return plan;
    const outline = rectOutline(b.right - b.left, b.bottom - b.top).map((p) => ({
      x: p.x + at.x,
      y: p.y + at.y,
    }));
    return reshapeRoom(plan, room.id, outline);
  }
  const l = fitLShape(shape.l);
  if (l.width <= 2 * L_MIN_SIDE - 1e-9 || l.height <= 2 * L_MIN_SIDE - 1e-9) return plan;
  const current = lShapeOf(room);
  if (
    current &&
    current.width === l.width &&
    current.height === l.height &&
    current.corner === l.corner &&
    current.cutWidth === l.cutWidth &&
    current.cutHeight === l.cutHeight
  ) {
    return plan;
  }
  return reshapeRoom(plan, room.id, lOutline(l, at));
}

// --- Corners ---------------------------------------------------------------------------------

/** Move corner `i` to `to` (refused, the same plan, if walls would cross or touch). */
export const moveCorner = (plan: Plan, i: number, to: Point, roomId?: Id): Plan =>
  moveVertex(plan, roomById(plan, roomId).id, i, to);

/** A new corner in the middle of wall `wall` (its index is `wall + 1`). */
export const addCorner = (plan: Plan, wall: number, roomId?: Id): Plan =>
  insertVertex(plan, roomById(plan, roomId).id, wall, 0.5);

/** Remove corner `i` (refused below 3 corners, or if walls would cross). */
export const removeCorner = (plan: Plan, i: number, roomId?: Id): Plan =>
  removeVertex(plan, roomById(plan, roomId).id, i);

/**
 * Wall `wall` made `length` long by moving its far corner along the wall's direction (the next
 * wall changes with it). Refused, the same plan, if walls would cross or touch.
 */
export function setWallLength(plan: Plan, wall: number, length: number, roomId?: Id): Plan {
  const room = roomById(plan, roomId);
  const f = wallFrame(room, wall);
  if (!(length > 0) || Math.abs(length - f.length) < 1e-9) return plan;
  const n = room.outline.length;
  const to = {
    x: Math.round((f.origin.x + f.along.x * length) * 1e9) / 1e9 + 0,
    y: Math.round((f.origin.y + f.along.y * length) * 1e9) / 1e9 + 0,
  };
  return moveVertex(plan, room.id, (wall + 1) % n, to);
}

// --- Doors and windows -----------------------------------------------------------------------

/** A new door's defaults; it goes to the next free spot from here (wall 2: a rectangle's bottom). */
export const NEW_DOOR = {
  width: 3,
  wall: 2,
  position: 2,
  hinge: 'left' as const,
  type: 'swing-in' as const,
};
/** A new window's defaults (wall 0: a rectangle's top). */
export const NEW_WINDOW = { width: 3, wall: 0, position: 2 };

/** For a door: what its swing needs kept clear, and its hinge side as drawn. */
interface Swing {
  type: Opening['type'];
  swingAngle?: Opening['swingAngle'];
  hinge: 'left' | 'right';
}

const spots = (
  plan: Plan,
  room: Room,
  width: number,
  walls: number[],
  position: number,
  swing: Swing | undefined,
  exclude?: string,
) =>
  wallSpots(plan, room, width, walls, () => position, {
    exclude,
    swing: swing && { type: swing.type, swingAngle: swing.swingAngle },
    // The hinge is on the same side as drawn whichever wall the door is on.
    hingeAtEnd: () => swing?.hinge === 'right',
  });

/**
 * Where a new door or window of `width` goes: walls are tried from `preferred.wall`, then the
 * rest in the outline's order; along a wall, `preferred.position` first, then from its start (see
 * `wallSpots` and `bestSpot` in core/placement.ts). `preferred` if nothing fits.
 */
export function openingSpot(
  plan: Plan,
  width: number,
  preferred: { wall: number; position: number },
  swing?: Swing,
  roomId?: Id,
): { wall: number; position: number } {
  const room = roomById(plan, roomId);
  const n = room.outline.length;
  const first = Math.min(preferred.wall, n - 1);
  const walls = [first, ...Array.from({ length: n }, (_, i) => i).filter((w) => w !== first)];
  const best = bestSpot(spots(plan, room, width, walls, preferred.position, swing));
  return best ? { wall: best.wall, position: best.position } : { ...preferred, wall: first };
}

/** Add a door (in the order the canvas lists them: doors before windows). */
export const insertOpening = (plan: Plan, o: Opening, roomId?: Id): Plan => {
  const room = roomById(plan, roomId);
  const openings =
    o.kind === 'door'
      ? [
          ...room.openings.filter((x) => x.kind === 'door'),
          o,
          ...room.openings.filter((x) => x.kind !== 'door'),
        ]
      : [...room.openings, o];
  return withRoom(plan, { ...room, openings });
};

/** A new door at the first free spot (see `openingSpot`). Returns the plan and the new door. */
export function addDoor(plan: Plan, roomId?: Id): { plan: Plan; door: Opening; wall: number } {
  const room = roomById(plan, roomId);
  const spot = openingSpot(plan, NEW_DOOR.width, NEW_DOOR, NEW_DOOR, room.id);
  const width = Math.min(NEW_DOOR.width, wallLen(room, spot.wall));
  const door: Opening = {
    id: nextId(plan, 'door'),
    kind: 'door',
    ...placeOn(room, spot.wall, spot.position, width),
    width,
    type: NEW_DOOR.type,
    hinge: hingeFor(room, spot.wall, NEW_DOOR.hinge),
  };
  return { plan: insertOpening(plan, door, room.id), door, wall: spot.wall };
}

/** A new window at the first free spot. */
export function addWindow(plan: Plan, roomId?: Id): { plan: Plan; window: Opening; wall: number } {
  const room = roomById(plan, roomId);
  const spot = openingSpot(plan, NEW_WINDOW.width, NEW_WINDOW, undefined, room.id);
  const width = Math.min(NEW_WINDOW.width, wallLen(room, spot.wall));
  const win: Opening = {
    id: nextId(plan, 'window'),
    kind: 'window',
    ...placeOn(room, spot.wall, spot.position, width),
    width,
    type: 'swing-in',
    hinge: 'start',
  };
  return { plan: insertOpening(plan, win, room.id), window: win, wall: spot.wall };
}

const mapOpening = (plan: Plan, id: Id, f: (o: Opening, room: Room) => Opening): Plan => {
  const room = roomOfOpening(plan, id);
  if (!room) return plan;
  const i = room.openings.findIndex((o) => o.id === id);
  const next = f(room.openings[i]!, room);
  if (next === room.openings[i]) return plan;
  const openings = [...room.openings];
  openings[i] = next;
  return withRoom(plan, { ...room, openings });
};

/** A door or window edit in the editor's terms (position along the drawing, hinge as drawn). */
export interface OpeningPatch {
  width?: number;
  position?: number;
  hinge?: 'left' | 'right';
  type?: Opening['type'];
  /** 180, or undefined for the default (90). */
  swingAngle?: 180 | 90 | undefined;
}

/**
 * Edit a door or window, keeping it on its wall: the width is kept between `minWidth` and the
 * wall's length, the position between the wall's start and its length minus the width.
 */
export function updateOpening(plan: Plan, id: Id, patch: OpeningPatch, minWidth: number): Plan {
  return mapOpening(plan, id, (o, room) => {
    const place = openingPlace(room, o);
    const len = wallLen(room, place.wall);
    const width = clamp(patch.width ?? place.width, Math.min(minWidth, len), len);
    const position = clamp(patch.position ?? place.position, 0, Math.max(0, len - width));
    let next: Opening = { ...o };
    if (width !== place.width || position !== place.position) {
      next = { ...next, ...placeOn(room, place.wall, position, width), width };
    }
    if (patch.type !== undefined) next.type = patch.type;
    if (patch.hinge !== undefined) next.hinge = hingeFor(room, o.wall, patch.hinge);
    if ('swingAngle' in patch) {
      if (patch.swingAngle === 180) next.swingAngle = 180;
      else delete next.swingAngle;
    }
    return next;
  });
}

/**
 * Slide a door or window along its wall by (dx, dy) feet: the part of the move along the wall's
 * drawing direction counts (all of it on a horizontal or vertical wall).
 */
export function slideOpening(plan: Plan, id: Id, dx: number, dy: number): Plan {
  return mapOpening(plan, id, (o, room) => {
    const place = openingPlace(room, o);
    const f = wallFrame(room, place.wall);
    const len = f.length;
    // Along the drawing (left to right, top to bottom), whichever way the outline runs.
    const sign = f.along.x < 0 || (f.along.x === 0 && f.along.y < 0) ? -1 : 1;
    const delta = sign * (dx * f.along.x + dy * f.along.y);
    const position = clamp(place.position + delta, 0, Math.max(0, len - place.width));
    if (position === place.position) return o;
    return { ...o, ...placeOn(room, place.wall, position, place.width) };
  });
}

/**
 * Move a door or window to another wall, at a free spot there (its position kept if that is free;
 * never on top of another opening), with its hinge on the same side as drawn. Null if it fits
 * nowhere on that wall.
 */
export function moveOpeningToWall(plan: Plan, id: Id, wall: number): Plan | null {
  const room = roomOfOpening(plan, id);
  const o = room?.openings.find((x) => x.id === id);
  if (!room) return null;
  if (!o || wall < 0 || wall >= room.outline.length) return null;
  const place = openingPlace(room, o);
  if (place.wall === wall) return plan;
  const swing =
    o.kind === 'door' ? { type: o.type, swingAngle: o.swingAngle, hinge: place.hinge } : undefined;
  const best = bestSpot(spots(plan, room, o.width, [wall], place.position, swing, o.id));
  if (!best) return null;
  return mapOpening(plan, id, (cur) => ({
    ...cur,
    ...placeOn(room, wall, best.position, cur.width),
    ...(cur.kind === 'door' ? { hinge: hingeFor(room, wall, place.hinge) } : {}),
  }));
}

export const deleteOpening = (plan: Plan, id: Id): Plan => removeOpening(plan, id);

/** Doors and windows wider than their wall after a change of shape (they were narrowed). */
export const narrowedOpenings = (before: Plan, after: Plan): Opening[] => {
  const was = new Map(before.rooms.flatMap((r) => r.openings.map((o) => [o.id, o.width])));
  return after.rooms.flatMap((r) =>
    r.openings.filter((o) => (was.get(o.id) ?? o.width) > o.width + 1e-9),
  );
};

// --- Furniture -------------------------------------------------------------------------------

/** A new piece's size. */
export const NEW_PIECE = { width: 3, depth: 2 };

/**
 * What "Add Item" can add: a plain piece, or one of two starters with a shape (a 9' x 7'
 * sectional with a 6' x 4' cut, so 3' deep arms; a 4' round table).
 */
export const PIECE_PRESETS = {
  new: { label: 'New Item', shape: 'rect', ...NEW_PIECE },
  'l-sofa': {
    label: 'L-shaped sofa',
    shape: 'l',
    width: 9,
    depth: 7,
    cut: { corner: 'tr', width: 6, depth: 4 },
  },
  'round-table': { label: 'Round table', shape: 'ellipse', width: 4, depth: 4 },
} as const satisfies Record<string, Pick<Item, 'label' | 'shape' | 'width' | 'depth' | 'cut'>>;

export type PiecePreset = keyof typeof PIECE_PRESETS;

/** A new piece (`preset`) at the free spot nearest the middle of the room (`roomId`, else the first). */
export function addPiece(
  plan: Plan,
  color: string,
  preset: PiecePreset = 'new',
  roomId?: Id,
): { plan: Plan; item: Item } {
  const p: Pick<Item, 'label' | 'shape' | 'width' | 'depth' | 'cut'> = PIECE_PRESETS[preset];
  const corner = furnitureSpotBox(plan, roomById(plan, roomId), {
    width: p.width,
    height: p.depth,
    shape: p.shape,
    cut: p.cut,
  });
  const item: Item = {
    id: nextId(plan, 'item'),
    label: p.label,
    color,
    shape: p.shape,
    width: p.width,
    depth: p.depth,
    ...(p.cut && { cut: { ...p.cut } }),
    placement: { x: corner.x + p.width / 2, y: corner.y + p.depth / 2, rotation: 0 },
  };
  return { plan: addItem(plan, item), item };
}

export const deletePiece = (plan: Plan, id: Id): Plan => removeItem(plan, id);

/**
 * Edit a piece in the editor's terms (see `patchPiece`). The patched piece replaces the old one, so
 * a field the patch removes (`locked`, `hidden`, an L's `cut`) is gone.
 */
export const changePiece = (plan: Plan, id: Id, patch: PiecePatch): Plan => {
  const i = plan.items.findIndex((it) => it.id === id);
  if (i < 0) return plan;
  const items = [...plan.items];
  items[i] = patchPiece(plan.items[i]!, patch);
  return { ...plan, items };
};

/** Every piece in the room removed ("Clear room"); the inventory stays. */
export const clearPieces = (plan: Plan): Plan =>
  plan.items.some((i) => i.placement)
    ? { ...plan, items: plan.items.filter((i) => !i.placement) }
    : plan;

export const toggleLock = (plan: Plan, id: Id): Plan => {
  const item = plan.items.find((i) => i.id === id);
  return item ? changePiece(plan, id, { locked: !item.locked }) : plan;
};

export const toggleHidden = (plan: Plan, id: Id): Plan => {
  const item = plan.items.find((i) => i.id === id);
  return item ? changePiece(plan, id, { hidden: !item.hidden }) : plan;
};

// --- The inventory ---------------------------------------------------------------------------

/**
 * Take a piece out of the room into the inventory (docs/design/plan-format.md, section 3: the
 * inventory is the absence of `placement`). It keeps its name, size, colour and lock; `hidden`
 * goes, since a piece in the inventory is not drawn anyway. Unchanged if it is already there.
 */
export function takeOutPiece(plan: Plan, id: Id): Plan {
  const item = plan.items.find((i) => i.id === id);
  if (!item?.placement) return plan;
  const out = toInventory(plan, id);
  return item.hidden ? changePiece(out, id, { hidden: false }) : out;
}

/**
 * Put a piece from the inventory back in the room, unrotated, at the free spot nearest the middle
 * of the room (as a new piece goes: `findFurnitureSpot`), shown. Unchanged if it is already placed.
 */
export function placePiece(plan: Plan, id: Id, roomId?: Id): Plan {
  const item = plan.items.find((i) => i.id === id);
  if (!item || item.placement) return plan;
  const placed = updateItem(plan, id, {
    placement: findFurnitureSpot(plan, roomById(plan, roomId), item),
  });
  return item.hidden ? changePiece(placed, id, { hidden: false }) : placed;
}

/** The room a placed piece belongs to: the one its centre is in, else the nearest (by its box). */
const homeRoom = (plan: Plan, item: Item): Room => {
  const p = item.placement!;
  const inside = roomAt(plan, p);
  if (inside) return inside;
  let best = plan.rooms[0]!;
  let bestD = Infinity;
  for (const r of plan.rooms) {
    const b = roomBounds(r);
    const d = Math.hypot(
      Math.max(b.left - p.x, 0, p.x - b.right),
      Math.max(b.top - p.y, 0, p.y - b.bottom),
    );
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
};

/**
 * Every shown piece that is (partly) outside every room moved the least amount that brings it into
 * its room (the one its centre is in, else the nearest; in a room that is not a rectangle: to the
 * nearest free spot inside, see `moveInside`).
 */
export function movePiecesInside(plan: Plan): Plan {
  let changed = false;
  const parts = new Map(activePieces(plan).map((p) => [p.item.id, p.parts]));
  const items = plan.items.map((i) => {
    if (i.hidden || !i.placement) return i;
    const own = parts.get(i.id);
    if (own && roomOf(own, plan)) return i;
    const room = homeRoom(plan, i);
    if (isRectangle(room)) {
      const { dx, dy } = insideShift(i, room);
      if (Math.abs(dx) < GEOMETRY_EPSILON && Math.abs(dy) < GEOMETRY_EPSILON) return i;
    }
    const others = [...parts].filter(([id]) => id !== i.id).map(([, p]) => p);
    const next = moveInside(i, room, others);
    if (next === i) return i;
    changed = true;
    const moved = activePieces({ items: [next] })[0];
    if (moved) parts.set(i.id, moved.parts);
    return next;
  });
  return changed ? { ...plan, items } : plan;
}

/**
 * One piece moved the least amount that brings it into its room (as `movePiecesInside` moves every
 * stranded piece): "Move inside" on its warning. The same plan when it is inside already.
 */
export function movePieceInside(plan: Plan, id: Id): Plan {
  const item = plan.items.find((i) => i.id === id);
  if (!item?.placement || item.hidden) return plan;
  const others = activePieces(plan)
    .filter((p) => p.item.id !== id)
    .map((p) => p.parts);
  const next = moveInside(item, homeRoom(plan, item), others);
  return next === item ? plan : { ...plan, items: plan.items.map((i) => (i.id === id ? next : i)) };
}

/**
 * One piece moved to the nearest spot in its room where it overlaps nothing and blocks no door
 * (`clearSpot`), keeping its turn: "Move it out of the way" on its warning. Null when there is no
 * such spot.
 */
export function movePieceClear(plan: Plan, id: Id): Plan | null {
  const item = plan.items.find((i) => i.id === id);
  if (!item?.placement) return null;
  const at = clearSpot(plan, item, homeRoom(plan, item));
  if (!at) return null;
  return {
    ...plan,
    items: plan.items.map((i) =>
      i.id === id ? { ...i, placement: { ...i.placement!, x: at.x, y: at.y } } : i,
    ),
  };
}

// --- Set aside, and back where you want it ----------------------------------------------------

const round4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

/**
 * Put a set-aside piece on the plan with its centre at `at` (where it was dropped or tapped),
 * unrotated and shown, in the room under that point: if it sticks out of that room it is moved the
 * least amount that brings it in (`moveInside`, avoiding the other pieces in an outline that is not
 * a rectangle). Unchanged (the same plan) if `at` is in no room, or the piece is not set aside.
 */
export function placePieceAt(plan: Plan, id: Id, at: Point): Plan {
  const item = plan.items.find((i) => i.id === id);
  if (!item || item.placement) return plan;
  const room = roomAt(plan, at);
  if (!room) return plan;
  const { hidden: _hidden, ...rest } = item;
  let next: Item = { ...rest, placement: { x: round4(at.x), y: round4(at.y), rotation: 0 } };
  const others = activePieces(plan).map((p) => p.parts);
  next = moveInside(next, room, others);
  return { ...plan, items: plan.items.map((i) => (i.id === id ? next : i)) };
}

/**
 * A copy of a placed piece (a new id, the same name, size, shape, colour and turn; never locked or
 * hidden) beside it: flush to its right, below it, to its left or above it, the first of those
 * that is inside the same room and overlaps nothing; else half a foot down and right. Null if the
 * piece is not on the plan.
 */
export function duplicatePiece(plan: Plan, id: Id): { plan: Plan; item: Item } | null {
  const item = plan.items.find((i) => i.id === id);
  if (!item?.placement) return null;
  const parts = itemParts(item);
  const b = parts.flat();
  const w = Math.max(...b.map((p) => p.x)) - Math.min(...b.map((p) => p.x));
  const h = Math.max(...b.map((p) => p.y)) - Math.min(...b.map((p) => p.y));
  const room = roomOf(parts, plan) ?? roomAt(plan, item.placement);
  const others = activePieces(plan).map((p) => p.parts);
  const { locked: _l, hidden: _h, ...rest } = item;
  const copyAt = (dx: number, dy: number): Item => ({
    ...rest,
    id: nextId(plan, 'item'),
    placement: {
      ...item.placement!,
      x: round4(item.placement!.x + dx),
      y: round4(item.placement!.y + dy),
    },
  });
  const tries: [number, number][] = [
    [w, 0],
    [0, h],
    [-w, 0],
    [0, -h],
  ];
  let copy = copyAt(0.5, 0.5);
  for (const [dx, dy] of tries) {
    const c = copyAt(dx, dy);
    const cp = itemParts(c);
    if (room && roomOf(cp, { rooms: [room] }) && !others.some((o) => partsOverlap(cp, o) > 0)) {
      copy = c;
      break;
    }
  }
  return { plan: addItem(plan, copy), item: copy };
}

// --- Rooms -------------------------------------------------------------------------------------

/** The size of a room "Add room" makes (feet). */
export const NEW_ROOM = { width: 10, height: 10 };

/** "Room N" with N the first number from the room count up that no room is called. */
const freshName = (plan: Plan, base = 'Room'): string => {
  const taken = new Set(plan.rooms.map((r) => roomName(plan, r).toLowerCase()));
  for (let n = plan.rooms.length + 1; ; n++) {
    const name = `${base} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
};

/**
 * A new rectangular room (`NEW_ROOM`, named "Room N") against a free side of room `fromId` (the
 * first room if it is gone), flush so the two share a wall (`besideRoom`).
 */
export function addRoomBeside(
  plan: Plan,
  fromId?: Id,
  size: RoomDims = NEW_ROOM,
): { plan: Plan; room: Room } {
  const from = roomById(plan, fromId);
  const { outline } = besideRoom(plan, from, rectOutline(size.width, size.height));
  const room: Room = { id: nextId(plan, 'room'), name: freshName(plan), outline, openings: [] };
  return { plan: addRoomOp(plan, room), room };
}

/**
 * A copy of a room (its outline, doors and windows, with new ids; not its furniture), named
 * "<name> copy", against a free side of it.
 */
export function duplicateRoom(plan: Plan, roomId: Id): { plan: Plan; room: Room } | null {
  const src = plan.rooms.find((r) => r.id === roomId);
  if (!src) return null;
  const { outline } = besideRoom(plan, src, src.outline);
  const id = nextId(plan, 'room');
  // New ids for the copies: one above the highest of each kind, counting up.
  const count = {
    door: Number(nextId(plan, 'door').slice(5)),
    window: Number(nextId(plan, 'window').slice(7)),
  };
  const openings: Opening[] = src.openings.map((o) => ({
    ...o,
    id: `${o.kind}-${count[o.kind]++}`,
  }));
  const base = roomName(plan, src);
  const taken = new Set(plan.rooms.map((r) => roomName(plan, r).toLowerCase()));
  let name = `${base} copy`.slice(0, 80);
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} copy ${n}`.slice(0, 80);
  const room: Room = { ...src, id, name, outline, openings };
  return { plan: addRoomOp(plan, room), room };
}

/** Delete a room: its pieces are set aside, in one edit (the last room stays). */
export const deleteRoom = (plan: Plan, roomId: Id): Plan => removeRoom(plan, roomId);

/**
 * Move a room by (dx, dy) with the pieces in it, in one edit; refused (the same plan) if it would
 * then overlap another room (rooms sharing a wall only touch).
 */
export function moveRoomBy(plan: Plan, roomId: Id, dx: number, dy: number): Plan {
  if (!dx && !dy) return plan;
  const next = moveRoom(plan, roomId, round4(dx), round4(dy));
  if (next === plan) return plan;
  const moved = next.rooms.find((r) => r.id === roomId)!;
  return overlappedRooms(next, moved, roomId).length ? plan : next;
}

/** Put a room's top-left (its bounding box's) at `x` and/or `y`, as `moveRoomBy`. */
export function setRoomPosition(plan: Plan, roomId: Id, at: { x?: number; y?: number }): Plan {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return plan;
  const b = roomBounds(room);
  return moveRoomBy(plan, roomId, (at.x ?? b.left) - b.left, (at.y ?? b.top) - b.top);
}
