/**
 * The editor's view of a plan. The app holds a v4 `Plan` (core/schema.ts) in feet; its editor
 * shows one rectangular room at the origin with doors and windows on the walls named top, right,
 * bottom and left, and pieces by the top-left corner of their unrotated box, exactly as before the
 * plan format existed (docs/design/plan-format.md, section 9: "Rectangles keep the four names").
 * These helpers translate between the two; nothing here changes what a plan means.
 */
import { checkLayout, type IssueCode } from '../core/check';
import { normalizeDegrees, type ItemWarning } from '../core/geometry';
import { clampCut, defaultCut, itemBox } from '../core/geometry/shapes';
import {
  drawingFrame,
  isRectangle,
  offsetFromPosition,
  openingInFrame,
  roomBounds,
} from '../core/geometry/walls';
import type { Unit } from '../core/schema';
import { compact } from '../core/share/compact';
import type { SnapPiece } from '../core/snapping';
import type { Id, Item, Opening, Plan, Room, RoomDims, UnitSystem, Wall } from '../types';

export const WALLS: readonly Wall[] = ['top', 'right', 'bottom', 'left'];

export const DEFAULT_PLAN_NAME = 'Untitled';

/** A `width` x `height` rectangle from the origin, clockwise from its top-left corner. */
export const rectOutline = (width: number, height: number): Room['outline'] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

// --- The starter room -------------------------------------------------------------------------

/** A piece given as the v3 app stored it: the top-left corner of its unrotated box. */
const piece = (
  n: number,
  label: string,
  x: number,
  y: number,
  width: number,
  depth: number,
  color: string,
): Item => ({
  id: `item-${n}`,
  label,
  color,
  shape: 'rect',
  width,
  depth,
  placement: { x: x + width / 2, y: y + depth / 2, rotation: 0 },
});

/**
 * The sample bedroom a first visit (and "New plan") starts from: a 12' x 12' room with the bed
 * under the window, clear of the door swing, nothing overlapping and everything inside the room
 * (defaults.test.ts). It is the v3 starter room as the 3 -> 4 migration reads it (plans.test.ts).
 */
export const starterPlan = (): Plan => ({
  version: 4,
  name: DEFAULT_PLAN_NAME,
  unit: 'ft',
  rooms: [
    {
      id: 'room-1',
      outline: rectOutline(12, 12),
      openings: [
        {
          id: 'door-1',
          kind: 'door',
          wall: 2,
          offset: 3,
          width: 3,
          type: 'swing-in',
          hinge: 'end',
        },
        {
          id: 'window-1',
          kind: 'window',
          wall: 0,
          offset: 4,
          width: 4,
          type: 'swing-in',
          hinge: 'start',
        },
      ],
    },
  ],
  items: [
    piece(1, 'Bed', 3.5, 0, 5, 6.5, '#93c5fd'),
    piece(2, 'Nightstand', 2, 0, 1.5, 1.5, '#fcd34d'),
    piece(3, 'Nightstand', 8.5, 0, 1.5, 1.5, '#fcd34d'),
    piece(4, 'Dresser', 0, 7, 1.5, 4, '#d8b4fe'),
    piece(5, 'Desk', 10, 6.5, 2, 4, '#6ee7b7'),
    piece(6, 'Chair', 8.3, 7.1, 1.5, 1.5, '#fdba74'),
  ],
});

/** An empty room of the starter size: no doors, windows or furniture ("Start blank"). */
export const blankPlan = (): Plan => ({
  version: 4,
  name: DEFAULT_PLAN_NAME,
  unit: 'ft',
  rooms: [{ id: 'room-1', outline: rectOutline(12, 12), openings: [] }],
  items: [],
});

// --- Rooms ------------------------------------------------------------------------------------

/** The room the editor shows (a plan always has at least one). */
export const mainRoom = (plan: Pick<Plan, 'rooms'>): Room => plan.rooms[0]!;

/** A room's width and length (its bounding box). */
export const roomSize = (room: Pick<Room, 'outline'>): RoomDims => {
  const b = roomBounds(room);
  return { width: b.right - b.left, height: b.bottom - b.top };
};

export const doorsOf = (room: Pick<Room, 'openings'>): Opening[] =>
  room.openings.filter((o) => o.kind === 'door');

export const windowsOf = (room: Pick<Room, 'openings'>): Opening[] =>
  room.openings.filter((o) => o.kind === 'window');

// --- Doors and windows on a rectangle -------------------------------------------------------

/**
 * Where an opening is, in the editor's terms: its wall by name, `position` from the wall's left
 * (top, for the side walls) end, and the hinge on the left or right as drawn. On the bottom and
 * left walls these run against the outline (whose walls go clockwise), so `offset` and `hinge`
 * are mirrored there.
 */
export interface OpeningPlace {
  wall: Wall;
  position: number;
  width: number;
  hinge: 'left' | 'right';
}

export const openingPlace = (room: Pick<Room, 'outline'>, o: Opening): OpeningPlace => {
  const { position, width, hingeAtEnd } = openingInFrame(room, o);
  return { wall: WALLS[o.wall] ?? 'top', position, width, hinge: hingeAtEnd ? 'right' : 'left' };
};

/** The v4 `hinge` for a hinge on the `side` (as drawn) of wall `wall`. */
export const hingeFor = (
  room: Pick<Room, 'outline'>,
  wall: number,
  side: 'left' | 'right',
): Opening['hinge'] => ((side === 'right') !== drawingFrame(room, wall).reversed ? 'end' : 'start');

/** The `wall` and `offset` of an opening at `position` (from the left or top) on `wall`. */
export const placeOn = (
  room: Pick<Room, 'outline'>,
  wall: Wall,
  position: number,
  width: number,
): Pick<Opening, 'wall' | 'offset'> => {
  const index = WALLS.indexOf(wall);
  return { wall: index, offset: offsetFromPosition(room, index, position, width) };
};

// --- Pieces ------------------------------------------------------------------------------------

/** A piece's unrotated box: top-left corner, width, depth (as `height`) and rotation. */
export interface PieceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** The piece's box (a piece in the inventory has none: it is given the origin). */
export const boxOf = (item: Item): PieceBox =>
  itemBox(item) ?? { x: 0, y: 0, width: item.width, height: item.depth, rotation: 0 };

/** An edit to a piece in the editor's terms: `x` and `y` are its box's top-left corner. */
export interface PiecePatch {
  label?: string;
  color?: string;
  width?: number;
  depth?: number;
  x?: number;
  y?: number;
  rotation?: number;
  locked?: boolean;
  hidden?: boolean;
  /** Another shape in the same box; an L gets `defaultCut` unless `cut` is given. */
  shape?: Item['shape'];
  /** An L's cut, merged into the current one. */
  cut?: Partial<NonNullable<Item['cut']>>;
}

/**
 * `item` with `patch` applied. Changing the size keeps the box's top-left corner where it was (as
 * the size fields always have); the centre is recomputed only when the box changes, so other edits
 * never move a piece by a rounding error. An L's cut is kept inside its box.
 */
export function patchPiece(item: Item, patch: PiecePatch): Item {
  const { x, y, rotation, locked, hidden, shape, cut, ...fields } = patch;
  const next: Item = { ...item, ...fields };
  if (shape !== undefined) next.shape = shape;
  if (next.shape === 'l') {
    const base = item.cut ?? defaultCut(next.width, next.depth);
    next.cut = clampCut(cut ? { ...base, ...cut } : base, next.width, next.depth);
  } else delete next.cut;
  if (
    x !== undefined ||
    y !== undefined ||
    fields.width !== undefined ||
    fields.depth !== undefined
  ) {
    const box = boxOf(item);
    const left = x ?? box.x;
    const top = y ?? box.y;
    next.placement = {
      ...item.placement,
      x: left + next.width / 2,
      y: top + next.depth / 2,
      rotation: item.placement?.rotation ?? 0,
    };
  }
  if (rotation !== undefined) {
    next.placement = {
      ...(next.placement ?? { x: next.width / 2, y: next.depth / 2 }),
      rotation: normalizeDegrees(rotation),
    };
  }
  const flag = (key: 'locked' | 'hidden', on: boolean | undefined) => {
    if (on === undefined) return;
    if (on) next[key] = true;
    else delete next[key];
  };
  flag('locked', locked);
  flag('hidden', hidden);
  return next;
}

export type { SnapPiece };

/** A piece as snapping sees it: its box and shape. */
export const snapBox = (item: Item): PieceBox & Pick<SnapPiece, 'shape' | 'cut'> => ({
  ...boxOf(item),
  shape: item.shape,
  ...(item.cut && { cut: item.cut }),
});

/** Placed pieces as the boxes snapping works on. */
export const snapPieces = (plan: Pick<Plan, 'items'>): SnapPiece[] =>
  plan.items
    .filter((i) => i.placement)
    .map((i) => ({ ...snapBox(i), id: i.id, label: i.label, visible: !i.hidden }));

/** Placed, visible pieces: the ones the canvas draws and the checks consider. */
export const shownPieces = (plan: Pick<Plan, 'items'>): Item[] =>
  plan.items.filter((i) => i.placement && !i.hidden);

/** Pieces in the room (shown or not): the furniture list. */
export const placedPieces = (plan: Pick<Plan, 'items'>): Item[] =>
  plan.items.filter((i) => i.placement);

/** Pieces in the inventory (no `placement`): the Inventory tray, in plan order. */
export const inventoryPieces = (plan: Pick<Plan, 'items'>): Item[] =>
  plan.items.filter((i) => !i.placement);

// --- Warnings ----------------------------------------------------------------------------------

const WARNING_CODES: IssueCode[] = [
  'item_outside_room',
  'item_overlap',
  'door_blocked',
  'doorway_blocked',
];

/**
 * Every shown piece's warnings, from the plan check: out of the room and overlapping furniture
 * (red), plus blocking a door or doorway (amber) with the doors concerned.
 */
export function itemWarnings(plan: Plan): Map<Id, ItemWarning> {
  const issues = checkLayout(plan, { codes: WARNING_CODES });
  const warnings = new Map<Id, ItemWarning>();
  for (const item of shownPieces(plan)) {
    warnings.set(item.id, { outOfBounds: false, collision: false });
  }
  for (const issue of issues) {
    const [a, b] = issue.ids as [string, string?];
    const w = warnings.get(a);
    if (!w) continue;
    if (issue.code === 'item_outside_room') w.outOfBounds = true;
    else if (issue.code === 'item_overlap') {
      w.collision = true;
      const other = b === undefined ? undefined : warnings.get(b);
      if (other) other.collision = true;
    } else {
      if (issue.code === 'door_blocked') w.blocksDoor = true;
      else w.blocksDoorway = true;
      w.blocksDoor ??= false;
      w.blocksDoorway ??= false;
      (w.doorIds ??= []).push(b!);
    }
  }
  return warnings;
}

/** Short warning for a piece that blocks a door ("Blocks door" wins over "Blocks doorway"). */
export const doorBlockText = (b: { door: boolean; doorway: boolean }): string =>
  b.door ? 'Blocks door' : 'Blocks doorway';

// --- Documents ---------------------------------------------------------------------------------

/** The unit a plan's lengths are written in for a display unit system (JSON export). */
export const unitFor = (units: UnitSystem): Unit => (units === 'ft-in' ? 'ft' : units);

/** The plan with its name and display unit system: what is stored, shared and exported. */
export const withDoc = (plan: Plan, name: string, unitSystem: UnitSystem): Plan => ({
  ...plan,
  name,
  settings: { ...plan.settings, unitSystem },
});

/**
 * What a plan draws, for "is this the same plan?": the compact share form of its rooms and pieces
 * (name and units left out, lengths rounded as links round them, so a plan opened from a link
 * matches the plan the link was made from).
 */
export const planContent = (plan: Plan): string => JSON.stringify(compact(plan).slice(4));

export const samePlan = (a: Plan, b: Plan): boolean => planContent(a) === planContent(b);

// --- What this editor can show ---------------------------------------------------------------

/**
 * `plan` in the form the editor works on, or what keeps it from showing the plan. A single
 * rectangular room listed from any corner, anywhere, is turned to start at its top-left corner
 * and moved to the origin (with everything in it), which changes no drawing; pieces in the
 * inventory (no `placement`) come along untouched. Pieces of every shape (rectangles, Ls and
 * ellipses) are editable. Several rooms and another outline are in the format (section 3) but
 * not yet in the editor (PRs 7b, 9): such a plan is not opened, so that no edit made here can
 * damage it.
 */
export function editablePlan(plan: Plan): { ok: true; plan: Plan } | { ok: false; why: string[] } {
  const why: string[] = [];
  if (plan.rooms.length !== 1) why.push('several rooms');
  const room = plan.rooms[0];
  if (!room) return { ok: false, why };
  const outline = room.outline;
  let start = -1;
  if (outline.length === 4) {
    const left = Math.min(...outline.map((p) => p.x));
    const top = Math.min(...outline.map((p) => p.y));
    start = outline.findIndex((p) => p.x === left && p.y === top);
  }
  const turned =
    start < 0 ? null : { ...room, outline: [...outline.slice(start), ...outline.slice(0, start)] };
  if (!turned || !isRectangle(turned)) why.push('a room that is not a rectangle');
  if (why.length || !turned) return { ok: false, why };
  if (start === 0 && outline[0]!.x === 0 && outline[0]!.y === 0) return { ok: true, plan };

  const { x: dx, y: dy } = turned.outline[0]!;
  const shift = <T extends { x: number; y: number }>(p: T): T => ({
    ...p,
    x: p.x - dx,
    y: p.y - dy,
  });
  return {
    ok: true,
    plan: {
      ...plan,
      rooms: [
        {
          ...turned,
          outline: turned.outline.map(shift),
          openings: room.openings.map((o) => ({ ...o, wall: (o.wall - start + 4) % 4 })),
        },
      ],
      items: plan.items.map((i) => (i.placement ? { ...i, placement: shift(i.placement) } : i)),
    },
  };
}
