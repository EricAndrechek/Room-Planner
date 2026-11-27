/**
 * Readable plan links, `#p=...`: a plan in a compact text that an assistant with no tools writes
 * straight into a link (docs/design/plan-format.md, section 5, "Readable links"). Only characters
 * that chat apps, Markdown and browsers leave alone: letters, digits and `- . _ ~ , ; : @`.
 *
 *   #p=ft;room:Bedroom:12x11;door:bottom:8:3;window:top:4:4;item:Queen_bed:5x6.7@6,3.35
 *
 * - Statements are separated by `;`, fields by `:`. Keywords are case-insensitive; `_` in a name
 *   is a space. Extra separators, spaces and unknown statements are ignored (with a note).
 * - `ft` (default), `in`, `m` or `cm`: the unit of every length. `name:<plan name>`.
 * - `room:<name>:<W>x<L>[@x,y]`: a rectangle, top-left corner at x,y. Without `@`, the first room
 *   is at 0,0 and each next one goes right of the one before, top-aligned, sharing its wall.
 *   `room:<name>:x1,y1,x2,y2,...[@x,y]`: an outline, its corners clockwise (shifted by `@`).
 * - `door:<wall>:<offset>:<width>[:<type>][:right][:180]`, `window:<wall>:<offset>:<width>`: on the
 *   room before them. On a rectangle, `wall` is top, right, bottom or left and `offset` runs from
 *   the wall's left end (top and bottom walls) or top end (left and right walls); otherwise `wall`
 *   is the index (wall i runs from corner i to corner i+1) and `offset` runs clockwise from corner
 *   i. `end-<offset>` measures from the other end (the right or bottom one; corner i+1), and
 *   `right-`, `bottom-` (or `left-`, `top-`) name the end. Types: in (default), out, double, double-out, sliding, pocket, bifold, opening. `right`
 *   hinges the door on the right, seen from inside the room facing the wall.
 * - `item:<label>:<W>x<D>[@x,y[,rotation]][:round][:L-<corner>-<w>x<d>][:color-<rrggbb>]`: a piece,
 *   its centre at x,y (rotation in clockwise degrees). Without `@` it is set aside. `round` makes it
 *   an ellipse; `L-tr-6x4` cuts a 6 x 4 rectangle out of its top-right corner (tl, tr, br, bl).
 *
 * The reader builds a v4 document and leaves ids, outline direction and anything it could not
 * read to `loadPlan(..., 'lenient')`, like every other link. It never throws.
 */
import { COLOR_PRESETS } from '../colors';
import { isRectangle, roomBounds } from '../geometry/walls';
import {
  PLAN_VERSION,
  UNITS,
  type Item,
  type Opening,
  type Plan,
  type Room,
  type Unit,
} from '../schema';
import { FEET_PER_CM, FEET_PER_INCH, FEET_PER_METER } from '../units';

export const READABLE_KEY = 'p';
/** The most text a readable link may carry, once percent-decoded (16 KB). */
export const READABLE_MAX_CHARS = 16 * 1024;

export type ReadablePayload =
  | { status: 'none' }
  | { status: 'damaged' }
  | { status: 'ok'; data: Record<string, unknown>; notes: string[] };

type Json = Record<string, unknown>;

const PREFIX = `${READABLE_KEY}=`;

/** The text after `#p=`, or null. */
function rawFragment(href: string): string | null {
  let hash: string;
  try {
    hash = new URL(href).hash.replace(/^#/, '');
  } catch {
    return null;
  }
  return hash.slice(0, PREFIX.length).toLowerCase() === PREFIX ? hash.slice(PREFIX.length) : null;
}

export const hasReadableLink = (href: string): boolean => rawFragment(href) !== null;

/** `decodeURIComponent`, but a stray `%` is kept rather than failing the whole text. */
const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/(%[0-9A-Fa-f]{2})+/g, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  }
};

/** A name as written: `_` is a space, then percent-decoding (so `%5F` is a real underscore). */
const nameOf = (s: string): string => decode(s.replace(/_/g, ' ')).trim();

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const t = s.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** `12x11` (also `12 X 11`, `12×11`, `12*11`) as [12, 11]. */
const size = (s: string | undefined): [number, number] | null => {
  if (!s) return null;
  const parts = s.replace(/\s+/g, '').split(/[x×*]/i);
  if (parts.length !== 2) return null;
  const a = num(parts[0]);
  const b = num(parts[1]);
  return a !== null && b !== null && a > 0 && b > 0 ? [a, b] : null;
};

/** `x,y[,r]` as numbers, or null. */
const numbers = (s: string): number[] | null => {
  const parts = s
    .replace(/\s+/g, '')
    .split(',')
    .filter((p) => p !== '');
  const out = parts.map((p) => num(p));
  return out.every((n): n is number => n !== null) ? out : null;
};

/** A field `<main>@x,y[,r]`, split. */
const at = (s: string): { main: string; pos: number[] | null } => {
  const i = s.indexOf('@');
  if (i < 0) return { main: s, pos: null };
  return { main: s.slice(0, i), pos: numbers(s.slice(i + 1)) };
};

const WALLS = ['top', 'right', 'bottom', 'left'] as const;
const DOOR_TYPES: Record<string, Opening['type']> = {
  in: 'swing-in',
  'swing-in': 'swing-in',
  swing: 'swing-in',
  out: 'swing-out',
  'swing-out': 'swing-out',
  double: 'double-in',
  'double-in': 'double-in',
  'double-out': 'double-out',
  sliding: 'sliding',
  slide: 'sliding',
  pocket: 'pocket',
  bifold: 'bifold',
  'bi-fold': 'bifold',
  opening: 'opening',
  open: 'opening',
  doorway: 'opening',
};

/** The plan in `#p=` text (already taken out of the URL), as a v4 document for `loadPlan`. */
export function parseReadable(input: string): ReadablePayload {
  const notes: string[] = [];
  if (input.length > READABLE_MAX_CHARS * 3) return { status: 'damaged' };
  // A link whose separators were percent-encoded as a whole.
  let text = /%3B/i.test(input) && !input.includes(';') ? decode(input) : input;
  if (text.length > READABLE_MAX_CHARS) return { status: 'damaged' };
  text = text.replace(/[\r\n]+/g, ';');

  let unit: Unit = 'ft';
  let name: string | undefined;
  const rooms: (Json & { outline: { x: number; y: number }[]; openings: Json[] })[] = [];
  const items: Json[] = [];
  let next: { x: number; y: number } = { x: 0, y: 0 };

  const statements = text.split(';');
  for (const [k, statement] of statements.entries()) {
    const fields = statement.split(':').map((f) => decode(f).trim());
    const keyword = (fields[0] ?? '').toLowerCase();
    if (!keyword) continue;
    const note = (what: string) => notes.push(`statement ${k + 1} (${keyword}): ${what}`);

    if ((UNITS as readonly string[]).includes(keyword) && fields.length === 1) {
      unit = keyword as Unit;
    } else if (keyword === 'unit') {
      const u = (fields[1] ?? '').toLowerCase();
      if ((UNITS as readonly string[]).includes(u)) unit = u as Unit;
      else note('unknown unit, kept ft');
    } else if (keyword === 'name') {
      name = nameOf(statement.split(':').slice(1).join(':'));
    } else if (keyword === 'room') {
      const raw = statement.split(':');
      const roomName = raw[1] !== undefined ? nameOf(raw[1]) : '';
      const { main, pos } = at(decode(raw.slice(2).join(':')).trim());
      const dims = size(main);
      let outline: { x: number; y: number }[] | null = null;
      if (dims) {
        const o = pos ?? (rooms.length ? [next.x, next.y] : [0, 0]);
        const [x, y] = [o[0] ?? 0, o[1] ?? 0];
        outline = [
          { x, y },
          { x: x + dims[0], y },
          { x: x + dims[0], y: y + dims[1] },
          { x, y: y + dims[1] },
        ];
      } else {
        const list = numbers(main);
        if (list && list.length >= 6 && list.length % 2 === 0) {
          const [dx, dy] = [pos?.[0] ?? 0, pos?.[1] ?? 0];
          outline = [];
          for (let i = 0; i < list.length; i += 2) {
            outline.push({ x: list[i]! + dx, y: list[i + 1]! + dy });
          }
        }
      }
      if (!outline) {
        note('no size (WxL) or corners (x,y,...); room left out');
        continue;
      }
      const b = roomBounds({ outline });
      next = { x: b.right, y: b.top };
      rooms.push({ ...(roomName ? { name: roomName } : {}), outline, openings: [] });
    } else if (keyword === 'door' || keyword === 'window') {
      const room = rooms.at(-1);
      if (!room) {
        note('comes before any room; left out');
        continue;
      }
      const wallText = (fields[1] ?? '').toLowerCase();
      // `end-2`: 2 from the far end (`right-2`, `bottom-2` and so on name that end).
      const fromText = /^(start|end|left|right|top|bottom)-?(.*)$/i.exec(fields[2] ?? '');
      const side = (fromText?.[1] ?? 'start').toLowerCase();
      const offset = num(fromText ? fromText[2] : fields[2]);
      const width = num(fields[3]);
      if (offset === null || width === null || width <= 0) {
        note('needs <wall>:<offset>:<width>; left out');
        continue;
      }
      const named = WALLS.indexOf(wallText as (typeof WALLS)[number]);
      const rect = isRectangle({ outline: room.outline });
      let wall: number;
      let along = offset;
      if (named >= 0) {
        if (!rect) {
          note('wall names are for rectangular rooms; use the wall number; left out');
          continue;
        }
        wall = named;
        const b = roomBounds({ outline: room.outline });
        const len = named % 2 === 0 ? b.right - b.left : b.bottom - b.top;
        // Offsets run from the left or top end (the far end: the right or bottom one).
        const far = named % 2 === 0 ? 'right' : 'bottom';
        const near = named % 2 === 0 ? 'left' : 'top';
        if (side !== 'start' && side !== 'end' && side !== far && side !== near) {
          note(`a ${wallText} wall has no ${side} end; measured from the ${near}`);
        }
        if (side === 'end' || side === far) along = len - offset - width;
        // The format's offsets run clockwise from the start corner.
        if (named === 2 || named === 3) along = len - along - width;
      } else {
        const index = num(wallText);
        if (index === null || !Number.isInteger(index) || index < 0) {
          note(`unknown wall "${wallText}"; left out`);
          continue;
        }
        wall = index;
        if (side === 'end' && index < room.outline.length) {
          const p = room.outline[index]!;
          const q = room.outline[(index + 1) % room.outline.length]!;
          along = Math.hypot(q.x - p.x, q.y - p.y) - offset - width;
        } else if (side !== 'start' && side !== 'end') {
          note(`"${side}" is for named walls; measured from corner ${index}`);
        }
      }
      const opening: Json = { kind: keyword, wall, offset: Math.max(0, along), width };
      if (keyword === 'door') {
        for (const extra of fields.slice(4)) {
          const e = extra.toLowerCase();
          if (DOOR_TYPES[e]) opening.type = DOOR_TYPES[e];
          else if (e === 'right' || e === 'end') opening.hinge = 'end';
          else if (e === 'left' || e === 'start') opening.hinge = 'start';
          else if (e === '180' || e === '90') opening.swingAngle = Number(e);
          else if (e) note(`"${extra}" ignored`);
        }
      }
      room.openings.push(opening);
    } else if (keyword === 'item' || keyword === 'piece') {
      const raw = statement.split(':');
      const label = raw[1] !== undefined ? nameOf(raw[1]) : '';
      const rest = raw.slice(2).map((f) => decode(f).trim());
      const first = at(rest[0] ?? '');
      const dims = size(first.main);
      if (!dims) {
        note('needs <label>:<W>x<D>; left out');
        continue;
      }
      const item: Json = {
        label: label || 'Piece',
        width: dims[0],
        depth: dims[1],
        color: COLOR_PRESETS[items.length % COLOR_PRESETS.length]!.hex,
      };
      let pos = first.pos;
      for (const extra of rest.slice(1)) {
        const { main, pos: p } = at(extra);
        if (p) pos = p;
        const e = main.toLowerCase().replace(/\s+/g, '');
        if (!e) continue;
        const cut = /^l-?(tl|tr|br|bl)-?(.+)$/.exec(e);
        const color = /^(?:colou?r)?-?([0-9a-f]{6})$/.exec(e);
        if (e === 'round' || e === 'ellipse' || e === 'oval' || e === 'circle') {
          item.shape = 'ellipse';
        } else if (e === 'rect' || e === 'rectangle') {
          item.shape = 'rect';
        } else if (cut && size(cut[2])) {
          const [w, d] = size(cut[2])!;
          item.shape = 'l';
          item.cut = { corner: cut[1] as 'tl' | 'tr' | 'br' | 'bl', width: w, depth: d };
        } else if (color && /^colou?r/.test(e)) {
          item.color = `#${color[1]}`;
        } else note(`"${extra}" ignored`);
      }
      if (pos && pos.length >= 2) {
        item.placement = { x: pos[0], y: pos[1], rotation: (((pos[2] ?? 0) % 360) + 360) % 360 };
      }
      items.push(item);
    } else {
      note('unknown statement, ignored');
    }
  }

  if (rooms.length === 0) return { status: 'damaged' };
  const planName =
    name ?? (rooms.length === 1 ? (rooms[0]!.name as string | undefined) : undefined);
  return {
    status: 'ok',
    notes,
    data: {
      version: PLAN_VERSION,
      ...(planName ? { name: planName } : {}),
      unit,
      rooms,
      items,
    },
  };
}

/** The plan in `href`'s `#p=`. */
export function readReadableLink(href: string): ReadablePayload {
  const raw = rawFragment(href);
  return raw === null ? { status: 'none' } : parseReadable(raw);
}

// --- Writing ------------------------------------------------------------------------------------

const PER_FOOT: Record<Unit, number> = {
  ft: 1,
  in: 1 / FEET_PER_INCH,
  m: 1 / FEET_PER_METER,
  cm: 1 / FEET_PER_CM,
};

/** A name in a readable link: spaces as `_`, anything else outside the safe set encoded. */
const writeName = (s: string): string =>
  [...s.trim()]
    .map((c) =>
      c === ' '
        ? '_'
        : /[A-Za-z0-9\-.~,]/.test(c)
          ? c
          : [...new TextEncoder().encode(c)]
              .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
              .join(''),
    )
    .join('');

const DOOR_WORDS: Partial<Record<Opening['type'], string>> = {
  'swing-out': 'out',
  'double-in': 'double',
  'double-out': 'double-out',
  sliding: 'sliding',
  pocket: 'pocket',
  bifold: 'bifold',
  opening: 'opening',
};

/**
 * A plan (in feet) as readable text, in `unit` (default: the plan's display unit, feet for
 * feet and inches). Notes, ids, and locked and hidden flags are not part of the syntax.
 */
export function toReadable(plan: Plan, unit?: Unit): string {
  const u: Unit =
    unit ??
    (() => {
      const s = plan.settings?.unitSystem;
      return s === 'in' || s === 'm' || s === 'cm' ? s : 'ft';
    })();
  const k = PER_FOOT[u];
  const n = (feet: number) => String(Math.round(feet * k * 1000) / 1000 + 0);
  const out: string[] = [u];
  if (plan.name) out.push(`name:${writeName(plan.name)}`);
  for (const room of plan.rooms as Room[]) {
    const label = writeName(room.name ?? '');
    if (isRectangle(room)) {
      const b = roomBounds(room);
      out.push(
        `room:${label}:${n(b.right - b.left)}x${n(b.bottom - b.top)}@${n(b.left)},${n(b.top)}`,
      );
    } else {
      out.push(`room:${label}:${room.outline.map((p) => `${n(p.x)},${n(p.y)}`).join(',')}`);
    }
    const rect = isRectangle(room);
    const b = roomBounds(room);
    for (const o of room.openings) {
      let wall: string = String(o.wall);
      let offset = o.offset;
      if (rect) {
        wall = WALLS[o.wall]!;
        if (o.wall === 2 || o.wall === 3) {
          const len = o.wall === 2 ? b.right - b.left : b.bottom - b.top;
          offset = len - o.offset - o.width;
        }
      }
      const extras: string[] = [];
      if (o.kind === 'door') {
        const word = DOOR_WORDS[o.type];
        if (word) extras.push(word);
        if (o.hinge === 'end') extras.push('right');
        if (o.swingAngle === 180) extras.push('180');
      }
      out.push([o.kind, wall, n(offset), n(o.width), ...extras].join(':'));
    }
  }
  for (const item of plan.items as Item[]) {
    const parts = [`item:${writeName(item.label)}:${n(item.width)}x${n(item.depth)}`];
    if (item.placement) {
      const r = item.placement.rotation;
      parts[0] += `@${n(item.placement.x)},${n(item.placement.y)}${r ? `,${Math.round(r * 1000) / 1000}` : ''}`;
    }
    if (item.shape === 'ellipse') parts.push('round');
    if (item.shape === 'l' && item.cut) {
      parts.push(`L-${item.cut.corner}-${n(item.cut.width)}x${n(item.cut.depth)}`);
    }
    parts.push(`color-${item.color.replace('#', '').toLowerCase()}`);
    out.push(parts.join(':'));
  }
  return out.join(';');
}

/** A readable link for `plan` on `origin`. */
export const toReadableLink = (plan: Plan, origin: string, unit?: Unit): string =>
  `${new URL('/', origin).toString()}#${PREFIX}${toReadable(plan, unit)}`;

/** The `#p=` fragment of `href` removed. */
export function stripReadableLink(href: string): string {
  const url = new URL(href);
  if (rawFragment(href) !== null) url.hash = '';
  return url.toString();
}
