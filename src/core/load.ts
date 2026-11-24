/**
 * The one entry point for reading a plan from anywhere (docs/design/plan-format.md, section 4):
 * storage, share links, pasted JSON, plan files, MCP and WebMCP input, the guide examples.
 *
 *   1. detect the version; above PLAN_VERSION: `newer`, nothing else happens;
 *   2. expand the compact share form (an array);
 *   3. migrate step by step to the current version;
 *   4. lenient mode only: `repair` what can be repaired, recording each action;
 *   5. validate with the schema, then `checkIntegrity`;
 *   6. `toFeet`.
 *
 * Lenient mode is for the app's own data, links and imports, where one bad field must never cost a
 * plan. Strict mode is for agents (MCP, WebMCP), which should get the error and fix it.
 */
import { migrate, type MigrateOptions } from './migrate';
import { isJson, type Json } from './migrate/types';
import {
  HINGES,
  OPENING_KINDS,
  PLAN_VERSION,
  Plan,
  SHAPES,
  CORNERS,
  DOOR_TYPES,
  UNITS,
  UNIT_SYSTEMS,
} from './schema';
import { expand } from './share/compact';
import { toFeet } from './units';
import { detectVersion } from './version';

/** A problem with a document: where it is (a JSON path) and what is wrong, as a sentence. */
export interface LoadIssue {
  path: (string | number)[];
  message: string;
}

export type LoadResult =
  | { ok: true; plan: Plan; from: number; repairs: string[] }
  | { ok: false; reason: 'newer'; version: number }
  | { ok: false; reason: 'invalid'; issues: LoadIssue[] };

export type LoadMode = 'lenient' | 'strict';

export type LoadOptions = MigrateOptions;

const invalid = (issues: LoadIssue[]): LoadResult => ({ ok: false, reason: 'invalid', issues });

/**
 * Read a plan in any format ever written. `options.lengthsInFeet` says that a version 3 input is
 * stored data (lengths in feet, `unitSystem` only the display preference) rather than a link or
 * export (lengths in `unitSystem`). It is ignored for other versions, which name their unit.
 */
export function loadPlan(input: unknown, mode: LoadMode, options: LoadOptions = {}): LoadResult {
  const from = detectVersion(input);
  if (from === null || from < 2) {
    return invalid([{ path: [], message: 'This is not a Room Planner plan.' }]);
  }
  if (from > PLAN_VERSION) return { ok: false, reason: 'newer', version: from };

  let doc: unknown;
  try {
    // A copy, so nothing below can touch the caller's object.
    doc = structuredClone(Array.isArray(input) ? expand(input) : input);
  } catch {
    return invalid([{ path: [], message: 'This is not a Room Planner plan.' }]);
  }
  if (!isJson(doc)) return invalid([{ path: [], message: 'This is not a Room Planner plan.' }]);
  doc = migrate(doc, from, PLAN_VERSION, options);

  let repairs: string[] = [];
  if (mode === 'lenient') ({ doc, repairs } = repair(doc as Json));

  const parsed = Plan.safeParse(doc);
  if (!parsed.success) {
    return invalid(
      parsed.error.issues.map((i) => ({
        path: i.path.map((p) => (typeof p === 'number' ? p : String(p))),
        message: i.message,
      })),
    );
  }
  const issues = checkIntegrity(parsed.data);
  if (issues.length > 0) return invalid(issues);
  return { ok: true, plan: toFeet(parsed.data), from, repairs };
}

/** `loadPlan`'s issues as one line each: `rooms.0.openings.1.wall: ...`. */
export const formatIssues = (issues: LoadIssue[]): string[] =>
  issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));

// --- Integrity -------------------------------------------------------------------------------

/**
 * How far (in the document's unit) an opening may overhang its wall's end and still fit: more than
 * the share form's rounding (4 decimals), far less than anything visible.
 */
export const FIT_TOLERANCE = 1e-3;

type Pt = { x: number; y: number };

/** Twice the signed area: positive for an outline that runs clockwise as drawn (y down). */
export const signedArea2 = (pts: readonly Pt[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a;
};

const orient = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const onSegment = (a: Pt, b: Pt, p: Pt) =>
  Math.min(a.x, b.x) <= p.x &&
  p.x <= Math.max(a.x, b.x) &&
  Math.min(a.y, b.y) <= p.y &&
  p.y <= Math.max(a.y, b.y);

/** Whether segments ab and cd share any point (touching counts). */
const segmentsMeet = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return (
    (d1 === 0 && onSegment(c, d, a)) ||
    (d2 === 0 && onSegment(c, d, b)) ||
    (d3 === 0 && onSegment(a, b, c)) ||
    (d4 === 0 && onSegment(a, b, d))
  );
};

/**
 * Whether an outline is a simple polygon: no repeated corner, no two walls that meet except
 * neighbours at their shared corner, and no wall that folds back onto the previous one.
 */
export const isSimplePolygon = (pts: readonly Pt[]): boolean => {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    if (a.x === b.x && a.y === b.y) return false;
    // Neighbouring walls that run back over each other.
    const c = pts[(i + 2) % n]!;
    if (orient(a, b, c) === 0 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) {
      return false;
    }
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours across the closing corner
      if (segmentsMeet(a, b, pts[j]!, pts[(j + 1) % n]!)) return false;
    }
  }
  return true;
};

export const wallLengthOf = (outline: readonly Pt[], wall: number): number => {
  const a = outline[wall]!;
  const b = outline[(wall + 1) % outline.length]!;
  return Math.hypot(b.x - a.x, b.y - a.y);
};

/** The rules the schema cannot express. Empty when the plan is consistent. */
export function checkIntegrity(plan: Plan): LoadIssue[] {
  const issues: LoadIssue[] = [];
  const seen = new Map<string, string>();
  const claim = (id: string, path: (string | number)[]) => {
    const first = seen.get(id);
    if (first !== undefined) {
      issues.push({
        path: [...path, 'id'],
        message: `The id "${id}" is already used by ${first}.`,
      });
    } else {
      seen.set(id, path.join('.'));
    }
  };

  plan.rooms.forEach((room, r) => {
    const path = ['rooms', r];
    claim(room.id, path);
    if (!isSimplePolygon(room.outline) || signedArea2(room.outline) === 0) {
      issues.push({
        path: [...path, 'outline'],
        message: 'The outline must be a simple polygon: its walls may not cross or touch.',
      });
    } else if (signedArea2(room.outline) < 0) {
      issues.push({
        path: [...path, 'outline'],
        message: 'The outline must list its corners clockwise as drawn (y grows downward).',
      });
    }
    room.openings.forEach((o, i) => {
      const op = [...path, 'openings', i];
      claim(o.id, op);
      if (o.wall >= room.outline.length) {
        issues.push({
          path: [...op, 'wall'],
          message: `Wall ${o.wall} does not exist: the room has walls 0 to ${room.outline.length - 1}.`,
        });
        return;
      }
      const len = wallLengthOf(room.outline, o.wall);
      if (o.offset + o.width > len + FIT_TOLERANCE) {
        issues.push({
          path: op,
          message: `The ${o.kind} does not fit its wall: offset ${o.offset} + width ${o.width} is more than the wall's length, ${+len.toFixed(6)}.`,
        });
      }
    });
  });

  plan.items.forEach((item, i) => {
    const path = ['items', i];
    claim(item.id, path);
    if (item.shape === 'l' && !item.cut) {
      issues.push({ path: [...path, 'cut'], message: 'An L-shaped piece needs a "cut".' });
    } else if (item.shape !== 'l' && item.cut) {
      issues.push({ path: [...path, 'cut'], message: 'Only an L-shaped piece has a "cut".' });
    } else if (item.cut && (item.cut.width >= item.width || item.cut.depth >= item.depth)) {
      issues.push({
        path: [...path, 'cut'],
        message: 'The cut must be smaller than the piece in both width and depth.',
      });
    }
  });
  return issues;
}

// --- Repair (lenient mode) ---------------------------------------------------------------------

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const COORD_MAX = 100000;
const SIZE_MAX = 10000;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCoord = (v: unknown): v is number => finite(v) && Math.abs(v) <= COORD_MAX;
const isSize = (v: unknown): v is number => finite(v) && v > 0 && v <= SIZE_MAX;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

/**
 * Make a migrated document valid where that is possible without guessing: drop what cannot be
 * fixed (an entry that is not an object, a room without a usable outline, a door on a wall that
 * does not exist, a piece without a size), clamp an opening onto its wall, put a piece with an
 * unusable position in the inventory, reset invalid optional fields to their defaults, shorten
 * text that is too long, reverse a counter-clockwise outline and give missing, invalid or
 * duplicate ids new ones. Each action is described in `repairs`. This is the v3 app's
 * normalisation, kept so one bad field never costs a plan.
 */
export function repair(input: Json): { doc: Json; repairs: string[] } {
  const repairs: string[] = [];
  const doc: Json = { ...input };
  const note = (path: string, what: string): undefined => {
    repairs.push(`${path}: ${what}`);
  };
  const text = (o: Json, key: string, max: number, path: string) => {
    if (o[key] === undefined) return;
    if (typeof o[key] !== 'string') {
      delete o[key];
      note(path, `removed "${key}" (not text)`);
    } else if ((o[key] as string).length > max) {
      o[key] = (o[key] as string).slice(0, max);
      note(path, `shortened "${key}" to ${max} characters`);
    }
  };
  const optionalEnum = (o: Json, key: string, list: readonly string[], path: string) => {
    if (o[key] !== undefined && !oneOf(list, o[key])) {
      delete o[key];
      note(path, `reset "${key}" to its default`);
    }
  };

  text(doc, 'name', 100, 'name');
  if (!oneOf(UNITS, doc.unit)) {
    doc.unit = 'ft';
    note('unit', 'set to "ft"');
  }
  if (doc.settings !== undefined) {
    if (!isJson(doc.settings)) {
      delete doc.settings;
      note('settings', 'removed (not an object)');
    } else {
      doc.settings = { ...doc.settings };
      optionalEnum(doc.settings as Json, 'unitSystem', UNIT_SYSTEMS, 'settings');
    }
  }

  // Rooms and their openings.
  const rooms: Json[] = [];
  const paths = new Map<Json, string>();
  (Array.isArray(doc.rooms) ? doc.rooms : []).forEach((raw, r) => {
    const path = `rooms.${r}`;
    if (!isJson(raw)) return note(path, 'removed (not an object)');
    const room: Json = { ...raw };
    let outline = Array.isArray(room.outline)
      ? room.outline.map((p) =>
          isJson(p) && isCoord(p.x) && isCoord(p.y) ? { ...p, x: p.x, y: p.y } : null,
        )
      : [];
    if (outline.some((p) => p === null) || outline.length < 3 || outline.length > 64) {
      return note(path, 'removed (its outline is not 3 to 64 valid corners)');
    }
    let pts = outline as (Json & Pt)[];
    if (!isSimplePolygon(pts) || signedArea2(pts) === 0) {
      return note(path, 'removed (its outline crosses itself or has no area)');
    }
    // Kept at their input index, so every note names the input's path.
    let openings = (Array.isArray(room.openings) ? room.openings : []).map((o, i) => {
      if (isJson(o)) return o;
      note(`${path}.openings.${i}`, 'removed (not an object)');
      return null;
    });
    if (signedArea2(pts) < 0) {
      // Reverse the corners; wall i (p_i -> p_i+1) becomes wall n-2-i, running the other way.
      const n = pts.length;
      pts = [...pts].reverse();
      openings = openings.map((o) => {
        if (!o) return o;
        if (!Number.isInteger(o.wall) || (o.wall as number) < 0 || (o.wall as number) >= n)
          return o;
        const wall = (2 * n - 2 - (o.wall as number)) % n;
        const len = wallLengthOf(pts, wall);
        const out: Json = { ...o, wall };
        if (finite(o.offset) && finite(o.width)) out.offset = len - o.offset - o.width;
        if (o.hinge === 'end') out.hinge = 'start';
        else if (o.kind === 'door') out.hinge = 'end';
        return out;
      });
      note(`${path}.outline`, 'reversed to run clockwise');
    }
    outline = pts;
    room.outline = outline;
    text(room, 'name', 80, path);

    room.openings = openings
      .map((raw, i) => {
        if (!raw) return undefined;
        const op = `${path}.openings.${i}`;
        const o: Json = { ...raw };
        if (!oneOf(OPENING_KINDS, o.kind)) return note(op, 'removed (not a door or a window)');
        if (
          !Number.isInteger(o.wall) ||
          (o.wall as number) < 0 ||
          (o.wall as number) >= pts.length
        ) {
          return note(op, `removed (wall ${String(o.wall)} does not exist)`);
        }
        if (!isSize(o.width)) return note(op, 'removed (no valid width)');
        const len = wallLengthOf(pts, o.wall as number);
        if (o.width > len + FIT_TOLERANCE) {
          o.width = len;
          note(op, 'narrowed to its wall');
        }
        const width = o.width as number;
        if (!finite(o.offset) || o.offset < 0 || o.offset + width > len + FIT_TOLERANCE) {
          const offset = finite(o.offset) ? o.offset : 0;
          o.offset = Math.min(Math.max(offset, 0), Math.max(0, len - width));
          note(op, 'moved onto its wall');
        }
        paths.set(o, op);
        optionalEnum(o, 'type', DOOR_TYPES, op);
        optionalEnum(o, 'hinge', HINGES, op);
        if (o.swingAngle !== undefined && o.swingAngle !== 90 && o.swingAngle !== 180) {
          delete o.swingAngle;
          note(op, 'reset "swingAngle" to its default');
        }
        return o;
      })
      .filter((o): o is Json => o !== undefined)
      .slice(0, 64);
    paths.set(room, path);
    rooms.push(room);
  });
  doc.rooms = rooms;

  // Items.
  const items: Json[] = [];
  (Array.isArray(doc.items) ? doc.items : []).forEach((raw, i) => {
    const path = `items.${i}`;
    if (!isJson(raw)) return note(path, 'removed (not an object)');
    const item: Json = { ...raw };
    if (!isSize(item.width) || !isSize(item.depth)) {
      return note(path, 'removed (no valid width and depth)');
    }
    if (typeof item.label !== 'string') {
      item.label = String(item.label ?? 'Item');
      note(path, 'gave it a label');
    }
    text(item, 'label', 80, path);
    text(item, 'notes', 500, path);
    if (
      item.color !== undefined &&
      !(typeof item.color === 'string' && COLOR_RE.test(item.color))
    ) {
      delete item.color;
      note(path, 'reset "color" to its default');
    }
    optionalEnum(item, 'shape', SHAPES, path);
    const cut = item.cut;
    if (item.shape === 'l') {
      const ok =
        isJson(cut) &&
        oneOf(CORNERS, cut.corner) &&
        isSize(cut.width) &&
        isSize(cut.depth) &&
        cut.width < (item.width as number) &&
        cut.depth < (item.depth as number);
      if (!ok) {
        item.shape = 'rect';
        delete item.cut;
        note(path, 'made rectangular (its cut is missing or too large)');
      }
    } else if (cut !== undefined) {
      delete item.cut;
      note(path, 'removed "cut" (only L-shaped pieces have one)');
    }
    if (item.placement !== undefined) {
      const p = item.placement;
      if (!isJson(p) || !isCoord(p.x) || !isCoord(p.y)) {
        delete item.placement;
        note(path, 'moved to the inventory (no valid position)');
      } else {
        const placement: Json = { ...p };
        if (placement.rotation !== undefined) {
          const rot = finite(placement.rotation) ? ((placement.rotation % 360) + 360) % 360 : 0;
          if (rot !== placement.rotation) {
            placement.rotation = rot === 360 ? 0 : rot;
            note(path, 'normalised its rotation');
          }
        }
        item.placement = placement;
      }
    }
    for (const flag of ['locked', 'hidden']) {
      if (item[flag] !== undefined && typeof item[flag] !== 'boolean') {
        delete item[flag];
        note(path, `removed "${flag}" (not true or false)`);
      }
    }
    paths.set(item, path);
    items.push(item);
  });
  doc.items = items.slice(0, 500);
  if (rooms.length > 50) doc.rooms = rooms.slice(0, 50);

  // Ids: one namespace for the whole document. Keep the first valid use of each.
  const entities: { o: Json; kind: string }[] = [];
  for (const room of doc.rooms as Json[]) {
    entities.push({ o: room, kind: 'room' });
    for (const o of room.openings as Json[]) entities.push({ o, kind: o.kind as string });
  }
  for (const o of doc.items as Json[]) entities.push({ o, kind: 'item' });
  const used = new Set<string>();
  const fresh: typeof entities = [];
  for (const e of entities) {
    const id = e.o.id;
    if (typeof id === 'string' && ID_RE.test(id) && !used.has(id)) used.add(id);
    else fresh.push(e);
  }
  const next = new Map<string, number>();
  for (const id of used) {
    const m = /^([a-z]+)-(\d+)$/.exec(id);
    if (m) next.set(m[1]!, Math.max(next.get(m[1]!) ?? 0, Number(m[2])));
  }
  for (const e of fresh) {
    let n = (next.get(e.kind) ?? 0) + 1;
    while (used.has(`${e.kind}-${n}`)) n++;
    next.set(e.kind, n);
    const id = `${e.kind}-${n}`;
    used.add(id);
    note(
      paths.get(e.o) ?? '',
      e.o.id === undefined ? `given the id "${id}"` : `id changed to "${id}"`,
    );
    e.o.id = id;
  }
  return { doc, repairs };
}
