/**
 * The editor's edits as pure functions `(plan, args) => plan`, over core/ops.ts and core
 * placement. They are the edits of a single rectangular room whose doors and windows sit on named
 * walls (plans.ts); each returns the plan unchanged (the same object) when there is nothing to do.
 */
import {
  insideShift,
  bestSpot,
  findFurnitureSpot,
  furnitureSpotBox,
  moveInside,
  wallSpots,
} from '../core/placement';
import { GEOMETRY_EPSILON } from '../core/geometry';
import { addItem, nextId, removeItem, removeOpening, toInventory, updateItem } from '../core/ops';
import { clamp } from '../core/units';
import type { Id, Item, Opening, Plan, Room, RoomDims, Wall } from '../types';
import {
  WALLS,
  hingeFor,
  mainRoom,
  openingPlace,
  patchPiece,
  placeOn,
  rectOutline,
  roomSize,
  type PiecePatch,
} from './plans';

const withMainRoom = (plan: Plan, room: Room): Plan => ({
  ...plan,
  rooms: [room, ...plan.rooms.slice(1)],
});

const wallLen = (dims: RoomDims, wall: Wall) =>
  wall === 'top' || wall === 'bottom' ? dims.width : dims.height;

// --- Room size -------------------------------------------------------------------------------

/**
 * The room resized to `dims` (from its top-left corner). Each door and window keeps its distance
 * from the left (or top) end of its wall, kept on the wall if the wall got shorter; pieces stay
 * where they are (the planner offers to move those now outside back in).
 */
export function resizeRoom(plan: Plan, dims: RoomDims): Plan {
  const room = mainRoom(plan);
  const size = roomSize(room);
  if (size.width === dims.width && size.height === dims.height) return plan;
  const next: Room = { ...room, outline: rectOutline(dims.width, dims.height) };
  next.openings = room.openings.map((o) => {
    const place = openingPlace(room, o);
    const len = wallLen(dims, place.wall);
    const width = Math.min(place.width, len);
    const position = clamp(place.position, 0, Math.max(0, len - width));
    const at = placeOn(next, place.wall, position, width);
    if (at.offset === o.offset && width === o.width) return o;
    return { ...o, ...at, width };
  });
  return withMainRoom(plan, next);
}

// --- Doors and windows -----------------------------------------------------------------------

/** A new door's defaults; it goes to the next free spot from here. */
export const NEW_DOOR = {
  width: 3,
  wall: 'bottom' as Wall,
  position: 2,
  hinge: 'left' as const,
  type: 'swing-in' as const,
};
/** A new window's defaults. */
export const NEW_WINDOW = { width: 3, wall: 'top' as Wall, position: 2 };

/** For a door: what its swing needs kept clear, and its hinge side as drawn. */
interface Swing {
  type: Opening['type'];
  swingAngle?: Opening['swingAngle'];
  hinge: 'left' | 'right';
}

const spots = (
  plan: Plan,
  width: number,
  walls: Wall[],
  position: number,
  swing: Swing | undefined,
  exclude?: string,
) =>
  wallSpots(
    plan,
    mainRoom(plan),
    width,
    walls.map((w) => WALLS.indexOf(w)),
    () => position,
    {
      exclude,
      swing: swing && { type: swing.type, swingAngle: swing.swingAngle },
      // The hinge is on the same side as drawn whichever wall the door is on.
      hingeAtEnd: () => swing?.hinge === 'right',
    },
  );

/**
 * Where a new door or window of `width` goes: walls are tried from `preferred.wall`, then the
 * rest in top, right, bottom, left order; along a wall, `preferred.position` first, then from its
 * start (see `wallSpots` and `bestSpot` in core/placement.ts). `preferred` if nothing fits.
 */
export function openingSpot(
  plan: Plan,
  width: number,
  preferred: { wall: Wall; position: number },
  swing?: Swing,
): { wall: Wall; position: number } {
  const walls = [preferred.wall, ...WALLS.filter((w) => w !== preferred.wall)];
  const best = bestSpot(spots(plan, width, walls, preferred.position, swing));
  return best ? { wall: WALLS[best.wall]!, position: best.position } : preferred;
}

/** Add a door (in the order the canvas lists them: doors before windows). */
export const insertOpening = (plan: Plan, o: Opening): Plan => {
  const room = mainRoom(plan);
  const openings =
    o.kind === 'door'
      ? [
          ...room.openings.filter((x) => x.kind === 'door'),
          o,
          ...room.openings.filter((x) => x.kind !== 'door'),
        ]
      : [...room.openings, o];
  return withMainRoom(plan, { ...room, openings });
};

/** A new door at the first free spot (see `openingSpot`). Returns the plan and the new door. */
export function addDoor(plan: Plan): { plan: Plan; door: Opening; wall: Wall } {
  const room = mainRoom(plan);
  const spot = openingSpot(plan, NEW_DOOR.width, NEW_DOOR, NEW_DOOR);
  const door: Opening = {
    id: nextId(plan, 'door'),
    kind: 'door',
    ...placeOn(room, spot.wall, spot.position, NEW_DOOR.width),
    width: NEW_DOOR.width,
    type: NEW_DOOR.type,
    hinge: hingeFor(room, WALLS.indexOf(spot.wall), NEW_DOOR.hinge),
  };
  return { plan: insertOpening(plan, door), door, wall: spot.wall };
}

/** A new window at the first free spot. */
export function addWindow(plan: Plan): { plan: Plan; window: Opening; wall: Wall } {
  const room = mainRoom(plan);
  const spot = openingSpot(plan, NEW_WINDOW.width, NEW_WINDOW);
  const win: Opening = {
    id: nextId(plan, 'window'),
    kind: 'window',
    ...placeOn(room, spot.wall, spot.position, NEW_WINDOW.width),
    width: NEW_WINDOW.width,
    type: 'swing-in',
    hinge: 'start',
  };
  return { plan: insertOpening(plan, win), window: win, wall: spot.wall };
}

const mapOpening = (plan: Plan, id: Id, f: (o: Opening, room: Room) => Opening): Plan => {
  const room = mainRoom(plan);
  const i = room.openings.findIndex((o) => o.id === id);
  if (i < 0) return plan;
  const next = f(room.openings[i]!, room);
  if (next === room.openings[i]) return plan;
  const openings = [...room.openings];
  openings[i] = next;
  return withMainRoom(plan, { ...room, openings });
};

/** A door or window edit in the editor's terms (position from the left or top, hinge as drawn). */
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
    const len = wallLen(roomSize(room), place.wall);
    const width = clamp(patch.width ?? place.width, minWidth, len);
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

/** Slide a door or window along its wall by (dx, dy) feet (the part along the wall counts). */
export function slideOpening(plan: Plan, id: Id, dx: number, dy: number): Plan {
  return mapOpening(plan, id, (o, room) => {
    const place = openingPlace(room, o);
    const len = wallLen(roomSize(room), place.wall);
    const delta = place.wall === 'top' || place.wall === 'bottom' ? dx : dy;
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
export function moveOpeningToWall(plan: Plan, id: Id, wall: Wall): Plan | null {
  const room = mainRoom(plan);
  const o = room.openings.find((x) => x.id === id);
  if (!o) return null;
  const place = openingPlace(room, o);
  if (place.wall === wall) return plan;
  const swing =
    o.kind === 'door' ? { type: o.type, swingAngle: o.swingAngle, hinge: place.hinge } : undefined;
  const best = bestSpot(spots(plan, o.width, [wall], place.position, swing, o.id));
  if (!best) return null;
  return mapOpening(plan, id, (cur) => ({
    ...cur,
    ...placeOn(room, wall, best.position, cur.width),
    ...(cur.kind === 'door' ? { hinge: hingeFor(room, WALLS.indexOf(wall), place.hinge) } : {}),
  }));
}

export const deleteOpening = (plan: Plan, id: Id): Plan => removeOpening(plan, id);

// --- Furniture -------------------------------------------------------------------------------

/** A new piece's size. */
export const NEW_PIECE = { width: 3, depth: 2 };

/** A new piece at the free spot nearest the middle of the room. */
export function addPiece(plan: Plan, color: string): { plan: Plan; item: Item } {
  const corner = furnitureSpotBox(plan, mainRoom(plan), {
    width: NEW_PIECE.width,
    height: NEW_PIECE.depth,
  });
  const item: Item = {
    id: nextId(plan, 'item'),
    label: 'New Item',
    color,
    shape: 'rect',
    width: NEW_PIECE.width,
    depth: NEW_PIECE.depth,
    placement: {
      x: corner.x + NEW_PIECE.width / 2,
      y: corner.y + NEW_PIECE.depth / 2,
      rotation: 0,
    },
  };
  return { plan: addItem(plan, item), item };
}

export const deletePiece = (plan: Plan, id: Id): Plan => removeItem(plan, id);

/**
 * Edit a piece in the editor's terms (see `patchPiece`). The piece is replaced, not merged, so a
 * flag the patch turns off (`locked`, `hidden`) is gone.
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
export function placePiece(plan: Plan, id: Id): Plan {
  const item = plan.items.find((i) => i.id === id);
  if (!item || item.placement) return plan;
  const placed = updateItem(plan, id, { placement: findFurnitureSpot(plan, mainRoom(plan), item) });
  return item.hidden ? changePiece(placed, id, { hidden: false }) : placed;
}

/** Every shown piece that is (partly) outside the room moved the least amount that brings it in. */
export function movePiecesInside(plan: Plan): Plan {
  const room = mainRoom(plan);
  let changed = false;
  const items = plan.items.map((i) => {
    if (i.hidden || !i.placement) return i;
    const { dx, dy } = insideShift(i, room);
    if (Math.abs(dx) < GEOMETRY_EPSILON && Math.abs(dy) < GEOMETRY_EPSILON) return i;
    changed = true;
    return moveInside(i, room);
  });
  return changed ? { ...plan, items } : plan;
}
