/**
 * localStorage persistence (docs/design/plan-format.md, section 4, "Storage, backup and rollback").
 *
 * The app reads and writes these keys:
 *
 *   room-planner-plans     JSON [{ id, createdAt, updatedAt, ui: { designMode }, plan }]
 *   room-planner-working   JSON Plan: the plan being edited (in feet, with its name and units)
 *   room-planner-ui        JSON { currentPlanId, designMode, legacy: { migratedAt, fingerprint } }
 *   room-planner-schema    "2"
 *   room-planner-backup    JSON { at, raw: { plans, working } }: the raw strings, before the first
 *                          write that replaces a plan stored in an older format (one generation)
 *
 * The keys of the app before the plan format (v3) are read, never written:
 *
 *   room-planner-projects        JSON Project[] ({ id, name, data: layout, createdAt, updatedAt })
 *   room-sim-v3-{units,mode,currentProject}   raw strings
 *   room-sim-v3-{dims,doors,windows,items}    JSON: the working layout, lengths in feet
 *   room-sim-v2-{dims,door,items}             the first release's working layout
 *
 * The first boot copies them into the new keys and never touches them again, so they are the raw
 * pre-migration backup and a rollback to a v3 build finds them as it left them. When a v3 build
 * runs again afterwards (a rollback, a stale tab) and saves there, `room-planner-projects` no
 * longer matches `legacy.fingerprint`: every legacy plan saved after `legacy.migratedAt` comes in
 * as a new plan named "<name> (recovered)". No edit is lost in either direction.
 *
 * Every plan is read through `loadPlan`. A stored plan this build cannot open (made by a newer
 * Room Planner, or using what its editor cannot show yet) is never loaded and never written over:
 * a saved one is written back byte for byte whenever the list is saved, and a working one stops
 * every write to `room-planner-working`. The list is merged on every write with what is stored at
 * that moment, so a second tab (of this build or another) never loses a plan it saved.
 *
 * A write that fails (storage full, or blocked) leaves the app working in memory, and the old
 * keys and the new keys keep what they held; the planner says so once (`onFailure`).
 */
import { loadPlan, type LoadResult } from '../core/load';
import { PLAN_VERSION } from '../core/schema';
import { detectVersion } from '../core/version';
import type { DesignMode, LockedProject, Plan, Project, UnitSystem } from '../types';
import { DESIGN_MODES, isDesignMode, isUnitSystem } from './constants';
import { APP_PLAN_VERSION } from './planVersion';
import { DEFAULT_PLAN_NAME, editablePlan, samePlan, starterPlan, withDoc } from './plans';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const KEYS = {
  plans: 'room-planner-plans',
  working: 'room-planner-working',
  ui: 'room-planner-ui',
  schema: 'room-planner-schema',
  backup: 'room-planner-backup',
} as const;

export const SCHEMA_VERSION = 2;

/** The v3 app's keys (read, never written). */
export const LEGACY_KEYS = {
  projects: 'room-planner-projects',
  units: 'room-sim-v3-units',
  mode: 'room-sim-v3-mode',
  currentProject: 'room-sim-v3-currentProject',
  dims: 'room-sim-v3-dims',
  doors: 'room-sim-v3-doors',
  windows: 'room-sim-v3-windows',
  items: 'room-sim-v3-items',
} as const;
export const LEGACY_V2_PREFIX = 'room-sim-v2-';

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

const parse = (raw: string | null): unknown => {
  if (raw === null || raw === '') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const timeOf = (iso: unknown): number => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** A short, stable fingerprint of a stored string (cyrb53), or "none" when the key is absent. */
export const fingerprint = (raw: string | null): string => {
  if (raw === null) return 'none';
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${raw.length}:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}`;
};

/**
 * The source text of each element of a JSON array, exactly as written (so an element can be
 * written back byte for byte), or null when `text` is not a JSON array.
 */
export function splitJsonArray(text: string): string[] | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  let depth = 0;
  let inString = false;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      if (depth === 1 && start < 0) start = i;
    } else if (c === '[' || c === '{') {
      if (depth === 1 && start < 0) start = i;
      depth++;
    } else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        if (start >= 0) out.push(text.slice(start, i).trim());
        break;
      }
    } else if (c === ',' && depth === 1) {
      out.push(text.slice(start, i).trim());
      start = -1;
    } else if (depth === 1 && start < 0 && !/\s/.test(c)) {
      start = i;
    }
  }
  return out.length === value.length ? out : null;
}

// --- Reading plans ---------------------------------------------------------------------------

/** A stored plan through `loadPlan`, in the editor's form; null when it cannot be opened here. */
type Opened =
  | { ok: true; plan: Plan; from: number }
  | { ok: false; reason: 'newer' | 'unsupported'; version: number }
  | { ok: false; reason: 'invalid' };

const openStored = (doc: unknown): Opened => {
  const version = detectVersion(doc);
  if (version !== null && version > APP_PLAN_VERSION) {
    return { ok: false, reason: 'newer', version };
  }
  const r: LoadResult = loadPlan(doc, 'lenient', { lengthsInFeet: true });
  if (!r.ok) {
    return r.reason === 'newer'
      ? { ok: false, reason: 'newer', version: r.version }
      : { ok: false, reason: 'invalid' };
  }
  const e = editablePlan(r.plan);
  if (!e.ok) return { ok: false, reason: 'unsupported', version: PLAN_VERSION };
  return { ok: true, plan: e.plan, from: r.from };
};

/** One element of `room-planner-plans`, with its source text. */
type Entry =
  | { kind: 'plan'; text: string; project: Project; from: number }
  | { kind: 'locked'; text: string; id: string | null; locked: LockedProject }
  | { kind: 'unreadable'; text: string; id: string | null };

const readEntry = (text: string): Entry => {
  const value = parse(text);
  const id = isObject(value) && typeof value.id === 'string' ? value.id : null;
  if (!isObject(value) || id === null) return { kind: 'unreadable', text, id };
  const opened = openStored(value.plan);
  if (!opened.ok) {
    if (opened.reason === 'invalid') return { kind: 'unreadable', text, id };
    const plan = isObject(value.plan) ? value.plan : {};
    const name = typeof plan.name === 'string' ? plan.name : DEFAULT_PLAN_NAME;
    return {
      kind: 'locked',
      text,
      id,
      locked: {
        id,
        name,
        version: opened.version,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
      },
    };
  }
  const ui = isObject(value.ui) ? value.ui : {};
  const project: Project = {
    ...value,
    id,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    ui: { ...ui, designMode: isDesignMode(ui.designMode) ? ui.designMode : undefined },
    plan: opened.plan,
  };
  if (project.ui!.designMode === undefined) delete project.ui!.designMode;
  return { kind: 'plan', text, project, from: opened.from };
};

// --- The v3 keys -----------------------------------------------------------------------------

/** A v3 saved plan, as `room-planner-projects` holds it. */
interface LegacyProject {
  id: string;
  name: string;
  data: Record<string, unknown>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const isLegacyProject = (p: unknown): p is LegacyProject =>
  isObject(p) && typeof p.id === 'string' && isObject(p.data);

const legacyProjects = (raw: string | null): LegacyProject[] => {
  const list = parse(raw);
  return Array.isArray(list) ? list.filter(isLegacyProject) : [];
};

/** A v3 saved plan as a saved plan of this build (null if it cannot be read). */
const fromLegacyProject = (p: LegacyProject, now: string): Project | null => {
  const name = typeof p.name === 'string' ? p.name : DEFAULT_PLAN_NAME;
  // The v3 app read a plan without a usable room size as the starter room's size.
  const data = isObject(p.data.roomDims) ? p.data : { ...p.data, roomDims: {} };
  const opened = openStored({ ...data, name });
  if (!opened.ok) return null;
  const mode = p.data.designMode;
  return {
    id: p.id,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : now,
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : now,
    ui: isDesignMode(mode) ? { designMode: mode } : {},
    plan: opened.plan,
  };
};

/**
 * Everything the v3 app read at start-up, read the way it read it (lib/storage.ts before the plan
 * format): the working layout from the v3 keys, or, when there are none and the schema marker is
 * below 1, from the first release's v2 keys (one door, no windows).
 */
function readLegacy(s: StorageLike) {
  const get = (key: string) => safeGet(s, key);
  const json = (key: string) => parse(get(key));
  const layoutKeys = [LEGACY_KEYS.dims, LEGACY_KEYS.doors, LEGACY_KEYS.windows, LEGACY_KEYS.items];
  const hasV3Layout = layoutKeys.some((k) => get(k) !== null);
  const schema = Number.parseInt(get(KEYS.schema) ?? '0', 10) || 0;
  const v2 = ['dims', 'door', 'items'].map((k) => json(`${LEGACY_V2_PREFIX}${k}`));
  const useV2 = !hasV3Layout && schema < 1 && v2.some((v) => v !== undefined);
  const units = get(LEGACY_KEYS.units);
  const unitSystem: UnitSystem = isUnitSystem(units) ? units : 'ft-in';
  const doc = useV2
    ? { roomDims: isObject(v2[0]) ? v2[0] : {}, door: v2[1], items: v2[2], windows: [], unitSystem }
    : {
        // Missing or unusable: the starter room's size, as the v3 app read it.
        roomDims: isObject(json(LEGACY_KEYS.dims)) ? json(LEGACY_KEYS.dims) : {},
        doors: json(LEGACY_KEYS.doors),
        windows: json(LEGACY_KEYS.windows),
        items: json(LEGACY_KEYS.items),
        unitSystem,
      };
  const mode = get(LEGACY_KEYS.mode);
  const projectsRaw = get(LEGACY_KEYS.projects);
  const hasLayout = hasV3Layout || useV2;
  return {
    doc,
    unitSystem,
    // A stored mode wins; without one, someone with a layout keeps room setup, and a first-time
    // visitor starts in Furniture mode (the sample pieces are what they reach for first).
    designMode: isDesignMode(mode)
      ? mode
      : hasLayout
        ? DESIGN_MODES.ROOM_SETUP
        : DESIGN_MODES.FURNITURE,
    currentProjectId: get(LEGACY_KEYS.currentProject) || null,
    projectsRaw,
    schema,
    usedV2: useV2,
    firstVisit: !hasLayout && mode === null && parse(projectsRaw) === undefined,
  };
}

// --- The store -------------------------------------------------------------------------------

export interface PersistedState {
  /** The working plan (in feet; name and units as stored). */
  plan: Plan;
  unitSystem: UnitSystem;
  designMode: DesignMode;
  currentProjectId: string | null;
  projects: Project[];
  /** Saved plans this build cannot open: listed, never opened, written back as they were. */
  locked: LockedProject[];
  /** Nothing was stored yet: a first visit on this device. */
  firstVisit: boolean;
  /**
   * The working plan in storage cannot be opened by this build (made by a newer Room Planner, or
   * using what its editor cannot show): it is left alone and never written over this session.
   */
  workingLocked: { reason: 'newer' | 'unsupported'; version: number } | null;
  /** Plans recovered from saves a v3 build made after the move to the new keys. */
  recovered: number;
}

export interface UiState {
  currentPlanId: string | null;
  designMode: DesignMode;
}

export interface SavedPlans {
  projects: Project[];
  locked: LockedProject[];
  /** Plans of ours that were saved under a new id (their id was taken by a plan we cannot open). */
  renamed: Map<string, string>;
}

export interface PlanStore {
  /** Read (and on the first boot migrate) everything. Call once, before anything is saved. */
  load(now?: Date): PersistedState;
  saveWorking(plan: Plan): boolean;
  saveUi(ui: UiState): boolean;
  /**
   * Save the list, merged with what is stored now: plans another tab added or changed later stay,
   * plans we cannot open stay byte for byte, plans in `deleted` go. Returns the merged list.
   */
  savePlans(projects: Project[], deleted?: ReadonlySet<string>): SavedPlans;
  /** A write failed (storage full or blocked): called on every failure. */
  onFailure(listener: (what: 'write' | 'backup') => void): () => void;
  /** Whether a write has failed this session. */
  hasFailed(): boolean;
  readonly storage: StorageLike;
}

export function createPlanStore(storage: StorageLike): PlanStore {
  const listeners = new Set<(what: 'write' | 'backup') => void>();
  let failed = false;
  let workingLocked = false;
  /** A stored plan in an older format: back up the raw keys before the first write over it. */
  let needsBackup = false;
  /** The backup could not be written: do not write over the old-format plans. */
  let backupFailed = false;
  /** Parsed entries by their source text, so a save parses only what changed. */
  let cache = new Map<string, Entry>();

  const fail = (what: 'write' | 'backup') => {
    failed = true;
    for (const l of listeners) l(what);
  };

  const set = (key: string, value: string): boolean => {
    try {
      storage.setItem(key, value);
      return true;
    } catch (err) {
      console.error(`Failed to write ${key}:`, err);
      fail('write');
      return false;
    }
  };

  /** Before the first write over an older format's plans: copy both keys, once. */
  const backupFirst = (): boolean => {
    if (!needsBackup) return true;
    if (backupFailed) return false;
    const raw = { plans: safeGet(storage, KEYS.plans), working: safeGet(storage, KEYS.working) };
    try {
      storage.setItem(KEYS.backup, JSON.stringify({ at: new Date().toISOString(), raw }));
      needsBackup = false;
      return true;
    } catch (err) {
      console.error(`Failed to write ${KEYS.backup}:`, err);
      backupFailed = true;
      fail('backup');
      return false;
    }
  };

  const entries = (raw: string | null): Entry[] => {
    if (raw === null) return [];
    const texts = splitJsonArray(raw);
    if (!texts) return [];
    const next = new Map<string, Entry>();
    const out = texts.map((text) => {
      const e = cache.get(text) ?? readEntry(text);
      next.set(text, e);
      return e;
    });
    cache = next;
    return out;
  };

  const readUi = (): Record<string, unknown> => {
    const v = parse(safeGet(storage, KEYS.ui));
    return isObject(v) ? v : {};
  };

  const writePlans = (texts: string[]): boolean => {
    const raw = safeGet(storage, KEYS.plans);
    // Something that is not a list of plans (written by hand, or damaged) is kept as the backup.
    if (raw !== null && splitJsonArray(raw) === null) {
      needsBackup = true;
    }
    if (!backupFirst()) return false;
    return set(KEYS.plans, `[${texts.join(',')}]`);
  };

  const newId = (taken: Set<string>, base: string) => {
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  };

  const savePlans: PlanStore['savePlans'] = (ours, deleted = new Set()) => {
    const stored = entries(safeGet(storage, KEYS.plans));
    const mine = new Map(ours.map((p) => [p.id, p]));
    const texts: string[] = [];
    const projects: Project[] = [];
    const locked: LockedProject[] = [];
    const taken = new Set<string>();
    const blocked = new Set<string>();
    const done = new Set<string>();
    const written = new Map<string, Entry>();
    for (const e of stored) {
      if (e.kind !== 'plan') {
        texts.push(e.text);
        written.set(e.text, e);
        if (e.kind === 'locked') locked.push(e.locked);
        if (e.id !== null) {
          taken.add(e.id);
          blocked.add(e.id);
        }
        continue;
      }
      const id = e.project.id;
      if (done.has(id)) continue;
      const ourCopy = mine.get(id);
      if (!ourCopy && deleted.has(id)) continue;
      done.add(id);
      taken.add(id);
      if (ourCopy && timeOf(ourCopy.updatedAt) >= timeOf(e.project.updatedAt)) {
        // Unchanged since it was read: written back as it was.
        const text = ourCopy === e.project ? e.text : JSON.stringify(ourCopy);
        texts.push(text);
        projects.push(ourCopy);
        written.set(text, { kind: 'plan', text, project: ourCopy, from: e.from });
      } else {
        texts.push(e.text);
        projects.push(e.project);
        written.set(e.text, e);
      }
    }
    const renamed = new Map<string, string>();
    for (const p of ours) {
      if (done.has(p.id)) continue;
      let project = p;
      if (blocked.has(p.id) || taken.has(p.id)) {
        project = { ...p, id: newId(taken, `${p.id}-copy`) };
        renamed.set(p.id, project.id);
      }
      taken.add(project.id);
      done.add(p.id);
      const text = JSON.stringify(project);
      texts.push(text);
      projects.push(project);
      written.set(text, { kind: 'plan', text, project, from: PLAN_VERSION });
    }
    if (writePlans(texts)) cache = written;
    return { projects, locked, renamed };
  };

  const saveWorking = (plan: Plan): boolean => {
    if (workingLocked || !backupFirst()) return false;
    return set(KEYS.working, JSON.stringify(plan));
  };

  const saveUi = (ui: UiState): boolean =>
    set(
      KEYS.ui,
      JSON.stringify({ ...readUi(), currentPlanId: ui.currentPlanId, designMode: ui.designMode }),
    );

  /** The first boot: the v3 keys into the new ones. */
  const migrate = (now: Date): PersistedState => {
    const iso = now.toISOString();
    const legacy = readLegacy(storage);
    const projects = legacyProjects(legacy.projectsRaw)
      .map((p) => fromLegacyProject(p, iso))
      .filter((p): p is Project => p !== null);
    const current = projects.find((p) => p.id === legacy.currentProjectId) ?? null;
    const opened = openStored(legacy.doc);
    const name = current?.plan.name ?? DEFAULT_PLAN_NAME;
    const plan = withDoc(opened.ok ? opened.plan : starterPlan(), name, legacy.unitSystem);

    set(KEYS.plans, `[${projects.map((p) => JSON.stringify(p)).join(',')}]`);
    set(KEYS.working, JSON.stringify(plan));
    // The first release's keys are read by a v3 build only while the marker is below 1; leave it
    // so a rollback still finds them.
    if (!legacy.usedV2) set(KEYS.schema, String(SCHEMA_VERSION));
    set(
      KEYS.ui,
      JSON.stringify({
        currentPlanId: current?.id ?? null,
        designMode: legacy.designMode,
        legacy: { migratedAt: iso, fingerprint: fingerprint(legacy.projectsRaw) },
      }),
    );
    return {
      plan,
      unitSystem: legacy.unitSystem,
      designMode: legacy.designMode,
      currentProjectId: current?.id ?? null,
      projects,
      locked: [],
      firstVisit: legacy.firstVisit,
      workingLocked: null,
      recovered: 0,
    };
  };

  /**
   * Saves a v3 build made after the migration: each legacy plan saved since `migratedAt` comes in
   * as "<name> (recovered)", once (its id is made from the legacy id and the time it was saved).
   */
  const recover = (state: PersistedState, now: Date): PersistedState => {
    const ui = readUi();
    const legacy = isObject(ui.legacy) ? ui.legacy : null;
    const raw = safeGet(storage, LEGACY_KEYS.projects);
    const print = fingerprint(raw);
    if (legacy && legacy.fingerprint === print) return state;
    const since = legacy ? timeOf(legacy.migratedAt) : Infinity;
    const known = new Set([...state.projects.map((p) => p.id), ...state.locked.map((l) => l.id)]);
    const iso = now.toISOString();
    const recovered: Project[] = [];
    for (const p of legacyProjects(raw)) {
      const t = timeOf(p.updatedAt);
      if (!(t > since)) continue;
      const id = `${p.id}-recovered-${t}`;
      if (known.has(id)) continue;
      const project = fromLegacyProject(p, iso);
      if (!project) continue;
      recovered.push({
        ...project,
        id,
        plan: { ...project.plan, name: `${project.plan.name} (recovered)` },
      });
    }
    let projects = state.projects;
    let locked = state.locked;
    if (recovered.length) ({ projects, locked } = savePlans([...state.projects, ...recovered]));
    set(
      KEYS.ui,
      JSON.stringify({
        ...ui,
        legacy: { migratedAt: iso, fingerprint: print },
      }),
    );
    return { ...state, projects, locked, recovered: recovered.length };
  };

  const load: PlanStore['load'] = (now = new Date()) => {
    const hasNew = [KEYS.plans, KEYS.working, KEYS.ui].some((k) => safeGet(storage, k) !== null);
    if (!hasNew) return migrate(now);

    const list = entries(safeGet(storage, KEYS.plans));
    const projects: Project[] = [];
    const locked: LockedProject[] = [];
    const seen = new Set<string>();
    for (const e of list) {
      if (e.kind === 'plan') {
        if (seen.has(e.project.id)) continue;
        seen.add(e.project.id);
        projects.push(e.project);
        if (e.from < PLAN_VERSION) needsBackup = true;
      } else if (e.kind === 'locked') locked.push(e.locked);
    }

    const ui = readUi();
    const current = projects.find((p) => p.id === ui.currentPlanId) ?? null;
    const workingRaw = safeGet(storage, KEYS.working);
    let lockedWorking: PersistedState['workingLocked'] = null;
    let plan: Plan | null = null;
    if (workingRaw !== null) {
      const doc = parse(workingRaw);
      const opened =
        doc === undefined ? ({ ok: false, reason: 'invalid' } as const) : openStored(doc);
      if (opened.ok) {
        plan = opened.plan;
        if (opened.from < PLAN_VERSION) needsBackup = true;
      } else if (opened.reason !== 'invalid') {
        lockedWorking = { reason: opened.reason, version: opened.version };
        workingLocked = true;
      } else {
        // Unreadable: kept in the backup before it is written over.
        needsBackup = true;
      }
    }
    plan ??= current ? current.plan : starterPlan();
    const unitSystem: UnitSystem = isUnitSystem(plan.settings?.unitSystem)
      ? plan.settings.unitSystem
      : 'ft-in';
    const designMode: DesignMode = isDesignMode(ui.designMode)
      ? ui.designMode
      : workingRaw !== null
        ? DESIGN_MODES.ROOM_SETUP
        : DESIGN_MODES.FURNITURE;
    const state: PersistedState = {
      plan: withDoc(plan, current?.plan.name ?? plan.name ?? DEFAULT_PLAN_NAME, unitSystem),
      unitSystem,
      designMode,
      currentProjectId: current?.id ?? null,
      projects,
      locked,
      firstVisit: false,
      workingLocked: lockedWorking,
      recovered: 0,
    };
    return recover(state, now);
  };

  return {
    load,
    saveWorking,
    saveUi,
    savePlans,
    onFailure: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    hasFailed: () => failed,
    storage,
  };
}

/** Whether the working plan is the current saved plan's (so the plan shows as saved). */
export const inSync = (state: Pick<PersistedState, 'plan' | 'projects' | 'currentProjectId'>) => {
  const current = state.projects.find((p) => p.id === state.currentProjectId);
  return !!current && samePlan(current.plan, state.plan);
};

// --- Preferences (per device; not part of a plan or of the share/export format) ---------------

/** Snapping on/off. Stored as '0' when off; anything else (including missing) means on. */
export const SNAP_PREF_KEY = 'room-planner-pref-snap';

export const loadSnapPreference = (s: StorageLike): boolean => safeGet(s, SNAP_PREF_KEY) !== '0';

export const saveSnapPreference = (s: StorageLike, on: boolean): void => {
  try {
    s.setItem(SNAP_PREF_KEY, on ? '1' : '0');
  } catch {
    /* a preference: nothing else depends on it */
  }
};
