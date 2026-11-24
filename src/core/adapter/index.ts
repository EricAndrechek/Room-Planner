/**
 * The v3 layout API over the plan-based core (docs/design/plan-format.md, section 10, PR 3). The
 * app still holds v3 layouts (`roomDims`, `doors`, `windows`, `items`); every function here turns
 * one into a plan with `planFromLayout`, calls core, and maps the answer back to v3 terms, so the
 * app and its tests see exactly what they saw before. PR 5 moves the app to plans and removes
 * this file (and scene.ts beside it, the export's adapter, kept apart so the export stays a lazy
 * chunk).
 */
import { checkLayout, partInRoom, type IssueCode } from '../check';
import { migrateColor } from '../colors';
import { GEOMETRY_EPSILON, type ItemWarning } from '../geometry';
import { itemParts } from '../geometry/shapes';
import {
  furnitureSpotBox,
  insideShift,
  bestSpot,
  wallSpots,
  type OpeningSpotOptions as PlanSpotOptions,
} from '../placement';
import type { Item, Opening, Plan, Room } from '../schema';
import type { Door, FurnitureItem, Id, Layout, RoomDims, RoomWindow, Wall } from '../types';

const WALLS: Wall[] = ['top', 'right', 'bottom', 'left'];
const wallIndex = (wall: Wall | undefined, fallback: Wall): number =>
  WALLS.indexOf(WALLS.includes(wall as Wall) ? (wall as Wall) : fallback);

const rectangle = (room: RoomDims): Room => ({
  id: 'room-1',
  outline: [
    { x: 0, y: 0 },
    { x: room.width, y: 0 },
    { x: room.width, y: room.height },
    { x: 0, y: room.height },
  ],
  openings: [],
});

/** A v3 door or window as a v4 opening of the rectangle `room`, as the v3 app drew it. */
const opening = (
  o: Door | RoomWindow,
  index: number,
  kind: 'door' | 'window',
  room: RoomDims,
): Opening => {
  const wall = wallIndex(o.wall, kind === 'door' ? 'bottom' : 'top');
  const len = wall % 2 === 0 ? room.width : room.height;
  const reversed = wall >= 2;
  const width = Math.min(o.width, len);
  const position = Math.min(Math.max(o.position, 0), Math.max(0, len - width));
  const door = kind === 'door' ? (o as Door) : null;
  return {
    id: `${kind}-${index}`,
    kind,
    wall,
    offset: reversed ? Math.max(0, len - position - width) : position,
    width,
    type: door?.type || 'swing-in',
    hinge: (door?.hinge === 'right') !== reversed ? 'end' : 'start',
    ...(door && (door.swingAngle === 90 || door.swingAngle === 180)
      ? { swingAngle: door.swingAngle }
      : {}),
  };
};

/** A v3 piece as a v4 item: the same box, by its centre. */
export const itemFromV3 = (it: FurnitureItem, index = 0): Item => ({
  id: `item-${index}`,
  label: it.label,
  color: migrateColor(it.color),
  shape: 'rect',
  width: it.width,
  depth: it.height,
  placement: { x: it.x + it.width / 2, y: it.y + it.height / 2, rotation: it.rotation },
  ...(it.locked ? { locked: true } : {}),
  ...(it.visible === false ? { hidden: true } : {}),
});

/**
 * A v3 layout as a plan: one rectangular room at the origin, in feet. Ids are positional
 * (`door-0`, `window-0`, `item-0`), so answers map back by index even when v3 ids collide. The
 * plan is not validated: it is a view of the layout for core, not a document.
 */
export function planFromLayout(
  layout: Pick<Layout, 'roomDims' | 'doors' | 'windows'> & Partial<Pick<Layout, 'items'>>,
  name = 'Untitled',
): Plan {
  const room = rectangle(layout.roomDims);
  room.openings = [
    ...layout.doors.map((d, i) => opening(d, i, 'door', layout.roomDims)),
    ...layout.windows.map((w, i) => opening(w, i, 'window', layout.roomDims)),
  ];
  return {
    version: 4,
    name,
    unit: 'ft',
    rooms: [room],
    items: (layout.items ?? []).map(itemFromV3),
  };
}

const indexOf = (id: string) => Number(id.slice(id.lastIndexOf('-') + 1));

// --- Warnings ----------------------------------------------------------------------------------

export interface DoorBlock {
  /** The piece is in a door's swing / fold / sliding track (inside the room). */
  door: boolean;
  /** The piece stands in a doorway (the passage in front of an opening), any door type. */
  doorway: boolean;
  /** Ids of the doors concerned. */
  doorIds: Id[];
}

const DOOR_CODES: IssueCode[] = ['door_blocked', 'doorway_blocked'];

/** Door blocks per v3 piece id, from the plan check (a later piece with the same id wins). */
const doorBlocks = (layout: Pick<Layout, 'items' | 'doors' | 'roomDims'>) => {
  const result = new Map<Id, DoorBlock>();
  if (layout.doors.length === 0) return result;
  const plan = planFromLayout({ ...layout, windows: [] });
  const byIndex = new Map<number, DoorBlock>();
  for (const issue of checkLayout(plan, { codes: DOOR_CODES })) {
    const i = indexOf(issue.ids[0]!);
    const block = byIndex.get(i) ?? { door: false, doorway: false, doorIds: [] };
    if (issue.code === 'door_blocked') block.door = true;
    else block.doorway = true;
    block.doorIds.push(layout.doors[indexOf(issue.ids[1]!)]!.id);
    byIndex.set(i, block);
  }
  for (const [i, block] of byIndex) result.set(layout.items[i]!.id, block);
  return result;
};

/**
 * Which visible pieces block a door: in its clearance (inward swings incl. both leaves of a
 * double, a bi-fold's fold, a sliding door's track) or in its doorway (every type, also openings,
 * pockets and outward swings, whose swing itself is outside). Touching an edge does not count.
 * Hidden pieces never block.
 */
export const computeDoorBlocks = (
  items: readonly FurnitureItem[],
  doors: readonly Door[],
  room: RoomDims,
): Map<Id, DoorBlock> => doorBlocks({ items: [...items], doors: [...doors], roomDims: room });

/**
 * Every visible piece's warnings: out of the room and overlapping furniture (red), plus blocking a
 * door or doorway (amber). As the v3 app did, two pieces with the same id never count as
 * overlapping each other.
 */
export function computeLayoutWarnings(
  layout: Pick<Layout, 'items' | 'doors' | 'roomDims'>,
): Map<Id, ItemWarning> {
  const plan = planFromLayout({ ...layout, windows: [] });
  const out = new Set<number>();
  const collide = new Set<number>();
  for (const issue of checkLayout(plan, { codes: ['item_outside_room', 'item_overlap'] })) {
    const [a, b] = issue.ids.map(indexOf) as [number, number?];
    if (issue.code === 'item_outside_room') out.add(a);
    else if (b !== undefined && layout.items[a]!.id !== layout.items[b]!.id) {
      collide.add(a);
      collide.add(b);
    }
  }
  const warnings = new Map<Id, ItemWarning>();
  layout.items.forEach((item, i) => {
    if (item.visible === false) return;
    warnings.set(item.id, { outOfBounds: out.has(i), collision: collide.has(i) });
  });
  for (const [id, b] of doorBlocks(layout)) {
    const w = warnings.get(id);
    if (w) {
      warnings.set(id, { ...w, blocksDoor: b.door, blocksDoorway: b.doorway, doorIds: b.doorIds });
    }
  }
  return warnings;
}

/** Short warning for a piece that blocks a door ("Blocks door" wins over "Blocks doorway"). */
export const doorBlockText = (b: Pick<DoorBlock, 'door' | 'doorway'>): string =>
  b.door ? 'Blocks door' : 'Blocks doorway';

// --- Placement ---------------------------------------------------------------------------------

export interface OpeningSpotOptions {
  /** For a door: its type, hinge and angle, so its swing and doorway can be kept clear of furniture. */
  swing?: Pick<Door, 'type' | 'hinge' | 'swingAngle'>;
  gap?: number;
  margin?: number;
  step?: number;
}

type SpotLayout = Pick<Layout, 'roomDims' | 'doors' | 'windows'> & Partial<Pick<Layout, 'items'>>;

const spotsFor = (
  layout: SpotLayout,
  width: number,
  walls: Wall[],
  position: number,
  { swing, ...options }: OpeningSpotOptions,
) => {
  const plan = planFromLayout(layout);
  const v4: Omit<PlanSpotOptions, 'swing'> = options;
  return wallSpots(
    plan,
    plan.rooms[0]!,
    width,
    walls.map((w) => WALLS.indexOf(w)),
    () => position,
    {
      ...v4,
      swing: swing && { type: swing.type, swingAngle: swing.swingAngle },
      // v3 hinges are named in the drawing frame: "right" is its far end on every wall.
      hingeAtEnd: () => swing?.hinge === 'right',
    },
  );
};

/**
 * Where a new door/window of `width` goes. Walls are tried in order: `preferred.wall` first, then
 * the rest in top, right, bottom, left order; along a wall, `preferred.position` first, then from
 * the start of the wall in `step` increments (plus the spots just past each opening). See
 * `wallSpots` and `bestSpot` in core/placement.ts.
 */
export function findOpeningSpot(
  layout: SpotLayout,
  width: number,
  preferred: { wall: Wall; position: number },
  options: OpeningSpotOptions = {},
): { wall: Wall; position: number } {
  const walls = [preferred.wall, ...WALLS.filter((w) => w !== preferred.wall)];
  const best = bestSpot(spotsFor(layout, width, walls, preferred.position, options));
  return best ? { wall: WALLS[best.wall]!, position: best.position } : preferred;
}

/**
 * Where an existing door/window goes when it moves to `wall`: the same choice as
 * `findOpeningSpot`, on that wall only. `layout` must not contain the opening itself. Null if it
 * fits nowhere on that wall without overlapping another opening.
 */
export function findOpeningSpotOnWall(
  layout: SpotLayout,
  width: number,
  wall: Wall,
  position: number,
  options: OpeningSpotOptions = {},
): number | null {
  const best = bestSpot(spotsFor(layout, width, [wall], position, options));
  return best ? best.position : null;
}

/** Top-left corner for a new, unrotated piece: see `furnitureSpotBox` in core/placement.ts. */
export function findFurnitureSpot(
  layout: Pick<Layout, 'roomDims' | 'doors' | 'items'>,
  size: { width: number; height: number },
  step?: number,
): { x: number; y: number } {
  const plan = planFromLayout({ ...layout, windows: [] });
  return furnitureSpotBox(plan, plan.rooms[0]!, size, step);
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The piece shifted (not resized or turned) by the least amount that puts it inside the room; a
 * piece wider or deeper than the room is aligned with the top/left wall. Unchanged (same object)
 * when already inside.
 */
export function moveInside<T extends FurnitureItem>(item: T, room: RoomDims): T {
  const { dx, dy } = insideShift(itemFromV3(item), rectangle(room));
  if (Math.abs(dx) < GEOMETRY_EPSILON && Math.abs(dy) < GEOMETRY_EPSILON) return item;
  return { ...item, x: round(item.x + dx), y: round(item.y + dy) };
}

/** Visible pieces that are (partly) outside the room. */
export const piecesOutside = (items: readonly FurnitureItem[], room: RoomDims): FurnitureItem[] => {
  const r = rectangle(room);
  return items.filter(
    (i) => i.visible !== false && !itemParts(itemFromV3(i)).every((p) => partInRoom(p, r)),
  );
};
