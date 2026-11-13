/**
 * localStorage persistence.
 *
 * Format decision: the on-disk format is the one the original app wrote, key
 * for key, so existing users' data loads unchanged and a rollback to the old
 * build would still read everything we write:
 *
 *   room-planner-projects        JSON Project[]
 *   room-sim-v3-units            raw string, a UnitSystem
 *   room-sim-v3-mode             raw string, a DesignMode
 *   room-sim-v3-currentProject   raw string, a project id (absent = none)
 *   room-sim-v3-dims             JSON RoomDims          (the working layout,
 *   room-sim-v3-doors            JSON Door[]             all lengths in feet)
 *   room-sim-v3-windows          JSON RoomWindow[]
 *   room-sim-v3-items            JSON FurnitureItem[]
 *
 * On top of that there is a schema version marker, `room-planner-schema`.
 * Absent means "written by the pre-2.0 app" (= version 0). `migrateStorage`
 * upgrades step by step and never deletes or rewrites legacy keys:
 *
 *   0 -> 1  if no v3 working layout exists but the very first release's
 *           `room-sim-v2-*` keys do (`dims`, single `door`, `items` with
 *           Tailwind-class colors), copy them forward into the v3 keys.
 *
 * Everything read is also normalized (legacy colors -> hex, missing door
 * type/wall -> the defaults the old renderer used, corrupt JSON -> defaults).
 */
import type { DesignMode, Layout, Project, UnitSystem } from '../types';
import { DESIGN_MODES, isDesignMode, isUnitSystem } from './constants';
import {
  defaultLayout,
  legacyDoorToDoor,
  normalizeLayout,
  normalizeRoomDims,
  type LegacyDoor,
} from './layout';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_PREFIX = 'room-sim-v3-';
export const LEGACY_V2_PREFIX = 'room-sim-v2-';
export const PROJECTS_STORAGE_KEY = 'room-planner-projects';
export const SCHEMA_KEY = 'room-planner-schema';
export const SCHEMA_VERSION = 1;

export const KEYS = {
  projects: PROJECTS_STORAGE_KEY,
  units: `${STORAGE_PREFIX}units`,
  mode: `${STORAGE_PREFIX}mode`,
  currentProject: `${STORAGE_PREFIX}currentProject`,
  dims: `${STORAGE_PREFIX}dims`,
  doors: `${STORAGE_PREFIX}doors`,
  windows: `${STORAGE_PREFIX}windows`,
  items: `${STORAGE_PREFIX}items`,
  schema: SCHEMA_KEY,
} as const;

/** In-memory fallback used when localStorage is unavailable (private mode, blocked cookies...). */
export const createMemoryStorage = (
  initial: Record<string, string> = {},
): StorageLike & {
  dump(): Record<string, string>;
} => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
};

let fallbackStorage: StorageLike | null = null;

/** The browser's localStorage, or an in-memory stand-in if it is unusable. */
export const getBrowserStorage = (): StorageLike => {
  try {
    const ls = window.localStorage;
    const probe = '__room_planner_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    fallbackStorage ??= createMemoryStorage();
    return fallbackStorage;
  }
};

const safeGet = (s: StorageLike, key: string): string | null => {
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (s: StorageLike, key: string, value: string): boolean => {
  try {
    s.setItem(key, value);
    return true;
  } catch (err) {
    console.error(`Failed to write ${key}:`, err);
    return false;
  }
};

const safeRemove = (s: StorageLike, key: string): void => {
  try {
    s.removeItem(key);
  } catch {
    /* ignore */
  }
};

const readJson = (s: StorageLike, key: string): unknown => {
  const raw = safeGet(s, key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

export const getSchemaVersion = (s: StorageLike): number => {
  const raw = safeGet(s, SCHEMA_KEY);
  const v = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(v) ? v : 0;
};

/** Upgrade stored data to {@link SCHEMA_VERSION}. Idempotent; never removes legacy keys. */
export const migrateStorage = (s: StorageLike): void => {
  let version = getSchemaVersion(s);
  if (version >= SCHEMA_VERSION) return;

  if (version < 1) {
    const hasV3Layout = [KEYS.dims, KEYS.doors, KEYS.windows, KEYS.items].some(
      (k) => safeGet(s, k) !== null,
    );
    if (!hasV3Layout) {
      const v2Dims = readJson(s, `${LEGACY_V2_PREFIX}dims`);
      const v2Door = readJson(s, `${LEGACY_V2_PREFIX}door`);
      const v2Items = readJson(s, `${LEGACY_V2_PREFIX}items`);
      if (v2Dims !== undefined || v2Door !== undefined || v2Items !== undefined) {
        const layout = normalizeLayout({
          roomDims: normalizeRoomDims(v2Dims),
          doors:
            v2Door && typeof v2Door === 'object'
              ? [legacyDoorToDoor(v2Door as LegacyDoor)]
              : undefined,
          // v2 rooms had no windows.
          windows: [],
          items: v2Items,
        });
        saveLayout(s, layout);
      }
    }
    version = 1;
  }

  safeSet(s, SCHEMA_KEY, String(version));
};

export interface PersistedState {
  layout: Layout;
  unitSystem: UnitSystem;
  designMode: DesignMode;
  currentProjectId: string | null;
  projects: Project[];
}

const isProject = (p: unknown): p is Project =>
  typeof p === 'object' &&
  p !== null &&
  typeof (p as Project).id === 'string' &&
  typeof (p as Project).data === 'object' &&
  (p as Project).data !== null;

/** Read and normalize everything. Pure with respect to storage (no writes). */
export const loadPersistedState = (s: StorageLike): PersistedState => {
  const def = defaultLayout();
  const read = (key: string) => readJson(s, key);
  const layout = normalizeLayout({
    roomDims: read(KEYS.dims) ?? def.roomDims,
    doors: read(KEYS.doors) ?? def.doors,
    windows: read(KEYS.windows) ?? def.windows,
    items: read(KEYS.items) ?? def.items,
  });

  const units = safeGet(s, KEYS.units);
  const mode = safeGet(s, KEYS.mode);
  const projectsRaw = read(KEYS.projects);
  const projects = Array.isArray(projectsRaw)
    ? projectsRaw.filter(isProject).map((p) => ({
        ...p,
        name: typeof p.name === 'string' ? p.name : 'Untitled',
      }))
    : [];

  return {
    layout,
    unitSystem: isUnitSystem(units) ? units : 'ft-in',
    designMode: isDesignMode(mode) ? mode : DESIGN_MODES.ROOM_SETUP,
    currentProjectId: safeGet(s, KEYS.currentProject) || null,
    projects,
  };
};

export const saveLayout = (s: StorageLike, layout: Layout): void => {
  safeSet(s, KEYS.dims, JSON.stringify(layout.roomDims));
  safeSet(s, KEYS.doors, JSON.stringify(layout.doors));
  safeSet(s, KEYS.windows, JSON.stringify(layout.windows));
  safeSet(s, KEYS.items, JSON.stringify(layout.items));
};

export const saveUnitSystem = (s: StorageLike, units: UnitSystem): void =>
  void safeSet(s, KEYS.units, units);

export const saveDesignMode = (s: StorageLike, mode: DesignMode): void =>
  void safeSet(s, KEYS.mode, mode);

export const saveCurrentProjectId = (s: StorageLike, id: string | null): void => {
  if (id) safeSet(s, KEYS.currentProject, id);
  else safeRemove(s, KEYS.currentProject);
};

export const saveProjects = (s: StorageLike, projects: Project[]): boolean =>
  safeSet(s, KEYS.projects, JSON.stringify(projects));
