import type {
  Door,
  FurnitureItem,
  Hinge,
  Layout,
  RoomDims,
  RoomWindow,
  UnitSystem,
  Wall,
} from '../types';
import { DOOR_TYPES, INITIAL_DOORS, INITIAL_ITEMS, INITIAL_ROOM, INITIAL_WINDOWS, WALL_OPTIONS } from './constants';
import { migrateColor } from './colors';
import { feetToUnitValue, unitValueToFeet } from './units';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const isWall = (v: unknown): v is Wall => WALL_OPTIONS.includes(v as Wall);

/** Deep copy of the built-in starter room (so callers can never mutate the constants). */
export const defaultLayout = (): Layout => structuredClone({
  roomDims: INITIAL_ROOM,
  doors: INITIAL_DOORS,
  windows: INITIAL_WINDOWS,
  items: INITIAL_ITEMS,
});

// --- Normalization ------------------------------------------------------------
// Stored and imported data is untrusted. These keep every field that is
// already valid (including unknown extra fields) and only fill in what the
// renderer would otherwise choke on, mirroring the defaults the original UI
// applied at render time (`door.wall || 'bottom'`, `migrateColor(item.color)`...).

export const normalizeRoomDims = (raw: unknown, fallback: RoomDims = INITIAL_ROOM): RoomDims => {
  if (!isObject(raw)) return { ...fallback };
  return { ...raw, width: num(raw.width, fallback.width), height: num(raw.height, fallback.height) };
};

export const normalizeDoor = (raw: unknown, index = 0): Door | null => {
  if (!isObject(raw)) return null;
  const type = DOOR_TYPES.some((t) => t.value === raw.type) ? (raw.type as Door['type']) : 'swing-in';
  const hinge: Hinge = raw.hinge === 'right' ? 'right' : 'left';
  return {
    ...raw,
    id: typeof raw.id === 'number' || typeof raw.id === 'string' ? raw.id : index + 1,
    width: num(raw.width, 3),
    position: num(raw.position, 0),
    wall: isWall(raw.wall) ? raw.wall : 'bottom',
    hinge,
    type,
  } as Door;
};

export const normalizeWindow = (raw: unknown, index = 0): RoomWindow | null => {
  if (!isObject(raw)) return null;
  return {
    ...raw,
    id: typeof raw.id === 'number' || typeof raw.id === 'string' ? raw.id : index + 1,
    width: num(raw.width, 3),
    position: num(raw.position, 0),
    wall: isWall(raw.wall) ? raw.wall : 'top',
  } as RoomWindow;
};

export const normalizeItem = (raw: unknown, index = 0): FurnitureItem | null => {
  if (!isObject(raw)) return null;
  return {
    ...raw,
    id: typeof raw.id === 'number' || typeof raw.id === 'string' ? raw.id : `item-${index + 1}`,
    label: typeof raw.label === 'string' ? raw.label : String(raw.label ?? 'Item'),
    width: num(raw.width, 3),
    height: num(raw.height, 2),
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    rotation: num(raw.rotation, 0),
    color: migrateColor(raw.color),
  } as FurnitureItem;
};

const normalizeList = <T>(
  raw: unknown,
  fn: (v: unknown, i: number) => T | null,
  fallback: T[],
): T[] => (Array.isArray(raw) ? raw.map(fn).filter((v): v is T => v !== null) : fallback);

/** Normalize any layout-shaped object; missing parts fall back to the starter room. */
export const normalizeLayout = (raw: unknown): Layout => {
  const src = isObject(raw) ? raw : {};
  const def = defaultLayout();
  return {
    roomDims: normalizeRoomDims(src.roomDims, def.roomDims),
    doors: normalizeList(src.doors, normalizeDoor, def.doors),
    windows: normalizeList(src.windows, normalizeWindow, def.windows),
    items: normalizeList(src.items, normalizeItem, def.items),
  };
};

/** Just the four layout fields, in a stable key order (for comparisons and snapshots). */
export const pickLayout = (data: Layout): Layout => ({
  roomDims: data.roomDims,
  doors: data.doors,
  windows: data.windows,
  items: data.items,
});

export const layoutsEqual = (a: Layout, b: Layout): boolean =>
  JSON.stringify(pickLayout(a)) === JSON.stringify(pickLayout(b));

// --- Share / JSON config ------------------------------------------------------

/** Pre-multi-door (v2) single door shape: `{ width, position, wall, hinge, open: 'in' | 'out' }`. */
export interface LegacyDoor {
  width: number;
  position: number;
  wall?: Wall;
  hinge?: Hinge;
  open?: 'in' | 'out';
  [key: string]: unknown;
}

/**
 * The portable layout format used by share links and the JSON export box.
 * Lengths are raw numbers in `unitSystem` (missing => decimal feet, which is
 * what every config written before unit systems existed contains).
 */
export interface ShareConfig {
  name?: string;
  unitSystem?: UnitSystem | string;
  roomDims: { width: number; height: number };
  doors?: Record<string, unknown>[];
  windows?: Record<string, unknown>[];
  items: Record<string, unknown>[];
  /** Legacy (v2) single door. */
  door?: LegacyDoor;
}

/** v2 single door -> v3 door (exactly what the original importer did). */
export const legacyDoorToDoor = (d: LegacyDoor): Record<string, unknown> => ({
  ...d,
  id: 1,
  type: d.open === 'in' ? 'swing-in' : 'swing-out',
});

export const isShareConfig = (v: unknown): v is ShareConfig =>
  isObject(v) && isObject(v.roomDims) && Array.isArray(v.items);

/** Layout (feet) -> portable config in the given unit system. */
export const toShareConfig = (layout: Layout, name: string, unitSystem: UnitSystem): ShareConfig => {
  const c = (feet: number) => feetToUnitValue(feet, unitSystem);
  return {
    name,
    unitSystem,
    roomDims: { width: c(layout.roomDims.width), height: c(layout.roomDims.height) },
    doors: layout.doors.map((d) => ({ ...d, width: c(d.width), position: c(d.position) })),
    windows: layout.windows.map((w) => ({ ...w, width: c(w.width), position: c(w.position) })),
    items: layout.items.map((i) => ({
      ...i,
      x: c(i.x),
      y: c(i.y),
      width: c(i.width),
      height: c(i.height),
      color: migrateColor(i.color),
    })),
  };
};

/**
 * Portable config -> layout in feet. Handles every historical shape:
 * configs without `unitSystem` (feet), the v2 single `door` field
 * (`open: 'in'` => swing-in, anything else => swing-out) and Tailwind-class
 * colors. Missing `doors`/`windows` fall back to the starter room's.
 */
export const fromShareConfig = (config: ShareConfig): Layout => {
  const source = config.unitSystem || 'ft';
  const c = (v: unknown) => unitValueToFeet(v as number, source);

  let doors: unknown[];
  if (Array.isArray(config.doors)) {
    doors = config.doors.map((d) => ({ ...d, width: c(d.width), position: c(d.position) }));
  } else if (isObject(config.door)) {
    const d = config.door;
    doors = [legacyDoorToDoor({ ...d, width: c(d.width), position: c(d.position) })];
  } else {
    doors = structuredClone(INITIAL_DOORS);
  }

  const windows = Array.isArray(config.windows)
    ? config.windows.map((w) => ({ ...w, width: c(w.width), position: c(w.position) }))
    : structuredClone(INITIAL_WINDOWS);

  const items = config.items.map((i) => ({
    ...i,
    x: c(i.x),
    y: c(i.y),
    width: c(i.width),
    height: c(i.height),
    color: migrateColor(i.color),
  }));

  return normalizeLayout({
    roomDims: { width: c(config.roomDims.width), height: c(config.roomDims.height) },
    doors,
    windows,
    items,
  });
};
