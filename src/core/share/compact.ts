/**
 * The compact share form (docs/design/plan-format.md, section 5): a plan as nested positional
 * arrays, which deflates to about half the size of the plan's JSON. Still JSON inside the same
 * `#s=` / `#j=` link.
 *
 *   [4, name, unit, unitSystem | 0, rooms, items]
 *   room    = [[x0, y0, x1, y1, ...], openings, name | 0, id | 0]
 *   opening = [kind, wall, offset, width, type, hinge, swing180, id | 0]   (kind, type, hinge: index)
 *   item    = [label, width, depth, color, [x, y, rotation] | 0, shape, [corner, w, d] | 0,
 *              flags, notes | 0, id | 0]
 *
 * - 0 stands for "absent" or "the default" wherever a field is optional, and trailing defaults
 *   are trimmed from every tuple (also `rotation` from a placement);
 * - `color` is an index into the ten presets or six hex digits; `flags` is locked (1) + hidden (2);
 * - an id is written only when it differs from its positional default (`room-1`, `door-2` for the
 *   plan's second door, `window-1`, `item-7`), which `expand` regenerates;
 * - lengths are rounded to 4 decimals and rotation to 2; fields this version does not know are not
 *   carried. A later optional field is appended to the end of its tuple.
 *
 * `expand` turns any array back into plan-shaped JSON without validating it: `loadPlan` does that.
 */
import { COLOR_PRESETS } from '../colors';
import type { Item, Opening, Plan, Room } from '../schema';

// Copies of the schema's enums (importing them would bring Zod along). A test keeps them equal.
export const KINDS = ['door', 'window'] as const;
export const TYPES = [
  'swing-in',
  'swing-out',
  'double-in',
  'double-out',
  'sliding',
  'pocket',
  'bifold',
  'opening',
] as const;
export const HINGE_ORDER = ['start', 'end'] as const;
export const SHAPE_ORDER = ['rect', 'l', 'ellipse'] as const;
export const CORNER_ORDER = ['tl', 'tr', 'br', 'bl'] as const;

/** Rounding of lengths (4 decimals) and rotation (2), with -0 as 0. */
export const roundLength = (n: number): number => Math.round(n * 1e4) / 1e4 + 0;
export const roundRotation = (n: number): number => {
  const r = Math.round(n * 100) / 100 + 0;
  return r >= 360 ? r - 360 : r;
};

const isZero = (v: unknown) => v === 0 || (Array.isArray(v) && v.length === 0);

/** Drop trailing defaults, keeping the first `required` elements. */
const trim = (tuple: unknown[], required: number): unknown[] => {
  let end = tuple.length;
  while (end > required && isZero(tuple[end - 1])) end--;
  return tuple.slice(0, end);
};

const colorCode = (hex: string): number | string => {
  const i = COLOR_PRESETS.findIndex((p) => p.hex === hex);
  return i >= 0 ? i : hex.slice(1);
};

/** A valid plan as the compact array. */
export function compact(plan: Plan): unknown[] {
  const counters = { door: 0, window: 0 };
  const opening = (o: Opening): unknown[] => {
    const n = ++counters[o.kind];
    return trim(
      [
        KINDS.indexOf(o.kind),
        o.wall,
        roundLength(o.offset),
        roundLength(o.width),
        TYPES.indexOf(o.type),
        HINGE_ORDER.indexOf(o.hinge),
        o.swingAngle === 180 ? 1 : 0,
        o.id === `${o.kind}-${n}` ? 0 : o.id,
      ],
      4,
    );
  };
  const room = (r: Room, i: number): unknown[] =>
    trim(
      [
        r.outline.flatMap((p) => [roundLength(p.x), roundLength(p.y)]),
        r.openings.map(opening),
        r.name ?? 0,
        r.id === `room-${i + 1}` ? 0 : r.id,
      ],
      1,
    );
  const item = (it: Item, i: number): unknown[] =>
    trim(
      [
        it.label,
        roundLength(it.width),
        roundLength(it.depth),
        colorCode(it.color),
        it.placement
          ? trim(
              [
                roundLength(it.placement.x),
                roundLength(it.placement.y),
                roundRotation(it.placement.rotation),
              ],
              2,
            )
          : 0,
        SHAPE_ORDER.indexOf(it.shape),
        it.cut
          ? [
              CORNER_ORDER.indexOf(it.cut.corner),
              roundLength(it.cut.width),
              roundLength(it.cut.depth),
            ]
          : 0,
        (it.locked ? 1 : 0) + (it.hidden ? 2 : 0),
        it.notes ?? 0,
        it.id === `item-${i + 1}` ? 0 : it.id,
      ],
      3,
    );
  return trim(
    [
      plan.version,
      plan.name,
      plan.unit,
      plan.settings?.unitSystem ?? 0,
      plan.rooms.map(room),
      plan.items.map(item),
    ],
    5,
  );
}

const at = (a: unknown, i: number): unknown => (Array.isArray(a) ? a[i] : undefined);
const present = (v: unknown) => v !== undefined && v !== 0 && v !== null;
const pick = <T>(list: readonly T[], v: unknown): T | number | undefined =>
  v === undefined || v === 0
    ? undefined
    : typeof v === 'number' && list[v] !== undefined
      ? list[v]
      : (v as number);

/**
 * The compact array back as plan-shaped JSON (with default ids filled in). Never throws; anything
 * malformed comes through as an invalid value for the schema to report.
 */
export function expand(input: readonly unknown[]): Record<string, unknown> {
  const counters = { door: 0, window: 0 };
  const opening = (t: unknown) => {
    if (!Array.isArray(t)) return t;
    const kind = typeof t[0] === 'number' ? (KINDS[t[0]] ?? t[0]) : t[0];
    const n = kind === 'door' || kind === 'window' ? ++counters[kind as 'door' | 'window'] : 0;
    const out: Record<string, unknown> = {
      id: present(t[7]) ? t[7] : `${String(kind)}-${n}`,
      kind,
      wall: t[1],
      offset: t[2],
      width: t[3],
    };
    if (present(t[4])) out.type = pick(TYPES, t[4]);
    if (present(t[5])) out.hinge = pick(HINGE_ORDER, t[5]);
    if (t[6] === 1) out.swingAngle = 180;
    else if (present(t[6])) out.swingAngle = t[6];
    return out;
  };
  const room = (t: unknown, i: number) => {
    if (!Array.isArray(t)) return t;
    const flat = t[0];
    const outline = Array.isArray(flat)
      ? Array.from({ length: Math.ceil(flat.length / 2) }, (_, k) => ({
          x: flat[2 * k],
          y: flat[2 * k + 1],
        }))
      : flat;
    const out: Record<string, unknown> = {
      id: present(t[3]) ? t[3] : `room-${i + 1}`,
      outline,
      openings: t[1] === undefined ? [] : Array.isArray(t[1]) ? t[1].map(opening) : t[1],
    };
    if (present(t[2])) out.name = t[2];
    return out;
  };
  const item = (t: unknown, i: number) => {
    if (!Array.isArray(t)) return t;
    const color = t[3];
    const out: Record<string, unknown> = {
      id: present(t[9]) ? t[9] : `item-${i + 1}`,
      label: t[0],
      width: t[1],
      depth: t[2],
      color:
        color === undefined
          ? undefined
          : typeof color === 'number'
            ? (COLOR_PRESETS[color]?.hex ?? color)
            : typeof color === 'string'
              ? `#${color}`
              : color,
    };
    if (out.color === undefined) delete out.color;
    const p = t[4];
    if (present(p)) {
      out.placement = Array.isArray(p) ? { x: p[0], y: p[1], rotation: p[2] ?? 0 } : p;
    }
    if (present(t[5])) out.shape = pick(SHAPE_ORDER, t[5]);
    const cut = t[6];
    if (present(cut)) {
      out.cut = Array.isArray(cut)
        ? { corner: pick(CORNER_ORDER, cut[0] ?? 0) ?? 'tl', width: cut[1], depth: cut[2] }
        : cut;
    }
    const flags = t[7];
    if (typeof flags === 'number') {
      if (flags & 1) out.locked = true;
      if (flags & 2) out.hidden = true;
    }
    if (present(t[8])) out.notes = t[8];
    return out;
  };
  const rooms = at(input, 4);
  const items = at(input, 5);
  const out: Record<string, unknown> = {
    version: at(input, 0),
    name: at(input, 1),
    unit: at(input, 2),
    rooms: Array.isArray(rooms) ? rooms.map(room) : rooms,
    items: items === undefined ? [] : Array.isArray(items) ? items.map(item) : items,
  };
  if (present(at(input, 3))) out.settings = { unitSystem: at(input, 3) };
  return out;
}
