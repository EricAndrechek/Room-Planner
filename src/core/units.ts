import type { Plan, Unit } from './schema';
import type { UnitSystem } from './types';

// Conversion factors (to feet). Internal storage is always feet.
export const FEET_PER_METER = 3.28084;
export const FEET_PER_CM = 0.0328084;
export const FEET_PER_INCH = 1 / 12;
export const FEET_PER_MM = FEET_PER_CM / 10;

export const roundNum = (num: number, decimals = 2): number => {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

type LengthUnit = 'ft' | 'in' | 'm' | 'cm' | 'mm';

const FEET_PER: Record<LengthUnit, number> = {
  ft: 1,
  in: FEET_PER_INCH,
  m: FEET_PER_METER,
  cm: FEET_PER_CM,
  mm: FEET_PER_MM,
};

const UNIT_ALIASES: Record<string, LengthUnit> = {
  "'": 'ft',
  ft: 'ft',
  foot: 'ft',
  feet: 'ft',
  "''": 'in',
  '"': 'in',
  in: 'in',
  inch: 'in',
  inches: 'in',
  m: 'm',
  meter: 'm',
  meters: 'm',
  metre: 'm',
  metres: 'm',
  cm: 'cm',
  centimeter: 'cm',
  centimeters: 'cm',
  centimetre: 'cm',
  centimetres: 'cm',
  mm: 'mm',
  millimeter: 'mm',
  millimeters: 'mm',
  millimetre: 'mm',
  millimetres: 'mm',
};

/** Unit-less number interpreted in the active unit system. */
const SYSTEM_FEET_PER: Record<UnitSystem, number> = {
  'ft-in': 1,
  ft: 1,
  in: FEET_PER_INCH,
  m: FEET_PER_METER,
  cm: FEET_PER_CM,
};

/** Why a typed length could not be read: nothing typed, two sizes in one field, or not a length. */
export type LengthProblem = 'empty' | 'pair' | 'invalid';

export type LengthParse = { ok: true; feet: number } | { ok: false; problem: LengthProblem };

const VULGAR_FRACTIONS: Record<string, string> = {
  '½': ' 1/2',
  '¼': ' 1/4',
  '¾': ' 3/4',
  '⅛': ' 1/8',
  '⅜': ' 3/8',
  '⅝': ' 5/8',
  '⅞': ' 7/8',
  '⅓': ' 1/3',
  '⅔': ' 2/3',
};

/**
 * What people type, in one spelling: lower case; full-width and other compatibility forms folded
 * (NFKC); prime, curly and backtick marks as `'` and `"` (two `'` are `"`); dashes as `-`; `½` and
 * friends as ` 1/2`; a comma between digits as a decimal point (`2,5 m`), or a thousands separator
 * when three digits follow (`1,200 mm`).
 */
export const normalizeLength = (input: string): string =>
  input
    .replace(/[½¼¾⅛⅜⅝⅞⅓⅔]/g, (c) => VULGAR_FRACTIONS[c] ?? c)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[′’‘`´ʹʼ]/g, "'")
    .replace(/[″“”„〃ʺ]/g, '"')
    .replace(/''/g, '"')
    .replace(/⁄/g, '/')
    .replace(/[−–—‐]/g, '-')
    .replace(/×/g, 'x')
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
    .replace(/(\d),(\d+)/g, '$1.$2')
    .trim();

// A number: `12`, `12.5`, `.5`, `12.` or a fraction (`1/2`), or a whole number and a fraction
// (`11 1/2`, `11-1/2`).
const NUMBER_RE = /(\d+(?:\.\d*)?|\.\d+)(?:(?:\s+|-)(\d+)\/(\d+)|\/(\d+))?/y;
// Its unit, if any. Word units must not be followed by another letter ("12 minutes" is not 12 m);
// a full stop after one is fine ("12 ft.").
const UNIT_RE =
  /\s*('|"|(?:feet|foot|ft|inches|inch|in|millimet(?:er|re)s?|mm|centimet(?:er|re)s?|cm|met(?:er|re)s?|m)(?![a-z])\.?)/y;
// Between two values: spaces, a comma, a plus, or a dash (`11-7`, `11'-7"`).
const GAP_RE = /\s*[,;+-]?\s*/y;
// Two sizes typed in one field: `12x10`, `12' x 10'`, `3 m by 4 m`, `12*10`.
const PAIR_RE = /\d\s*(?:'|"|[a-z]+\.?)?\s*(?:x|\*|by)\s*\.?\d/;

/**
 * Read a typed length (in feet). Every form the old parser read still works (`12'6"`, `150in`,
 * `3.5m`, `1m 20cm`, `11 7`, bare numbers in the active unit), plus the ones people actually type:
 * `11'7`, `11' 7"`, `11'7''`, `11ft7`, `11 ft 7 in`, `11-7`, `11.5'`, `11 1/2'`, `7"` or `7in`
 * alone, Unicode primes and curly quotes, `2,5 m`, and `cm` / `m` / `mm` in any unit system.
 *
 * A bare number is in the active unit system; one after a feet value is inches (`12'6`), and after
 * a meter value centimeters (`1m 20`). In feet & inches and decimal feet, a second bare number is
 * inches (`11 7` = 11'7"), as it is after a second `'` (`11'7'`). Anything else (letters that are
 * not a unit, three numbers with no units, a size pair) is not a length.
 */
export function parseLength(input: string, unitSystem: UnitSystem = 'ft-in'): LengthParse {
  const str = normalizeLength(input);
  if (!str) return { ok: false, problem: 'empty' };
  if (!/\d/.test(str)) return { ok: false, problem: 'invalid' };
  if (PAIR_RE.test(str)) return { ok: false, problem: 'pair' };
  let pos = 0;
  let negative = false;
  if (str[0] === '-' || str[0] === '+') {
    negative = str[0] === '-';
    pos = 1;
  }
  const tokens: { value: number; unit: LengthUnit | null; mark: string | null }[] = [];
  while (pos < str.length) {
    if (tokens.length) {
      GAP_RE.lastIndex = pos;
      pos += GAP_RE.exec(str)![0].length;
    } else {
      while (str[pos] === ' ') pos++;
    }
    if (pos >= str.length) break;
    NUMBER_RE.lastIndex = pos;
    const n = NUMBER_RE.exec(str);
    if (!n) return { ok: false, problem: 'invalid' };
    pos += n[0].length;
    let value = parseFloat(n[1]!);
    if (n[2] !== undefined) value += Number(n[2]) / Number(n[3]);
    if (n[4] !== undefined) value /= Number(n[4]);
    if (!Number.isFinite(value)) return { ok: false, problem: 'invalid' };
    UNIT_RE.lastIndex = pos;
    const u = UNIT_RE.exec(str);
    let mark: string | null = null;
    if (u) {
      pos += u[0].length;
      mark = u[1]!.replace(/\.$/, '');
    }
    tokens.push({ value, unit: mark ? (UNIT_ALIASES[mark] ?? null) : null, mark });
    if (tokens.length > 3) return { ok: false, problem: 'invalid' };
  }
  if (!tokens.length) return { ok: false, problem: 'invalid' };

  const feetLike = unitSystem === 'ft-in' || unitSystem === 'ft';
  /** The unit a bare number is read in, as a length unit (feet & inches: feet). */
  const systemUnit: LengthUnit = feetLike ? 'ft' : unitSystem;
  let total = 0;
  // The unit of the value before (a bare first number counts as the active unit's).
  let prev: LengthUnit | null = null;
  for (const t of tokens) {
    let unit = t.unit;
    if (prev === null) {
      unit ??= systemUnit;
    } else if (unit === null) {
      // The bare number after a value is the next unit down: inches after feet, cm after meters.
      if (prev === 'ft') unit = 'in';
      else if (prev === 'm') unit = 'cm';
      else return { ok: false, problem: 'invalid' }; // "7in 5", "20cm 3": nothing smaller
    } else if (prev === 'ft' && unit === 'ft' && t.mark === "'") {
      unit = 'in'; // 11'7' : the second mark meant inches
    } else if (FEET_PER[unit] >= FEET_PER[prev]) {
      return { ok: false, problem: 'invalid' }; // "6in 2ft", "20cm 1m": larger after smaller
    }
    total += t.value * FEET_PER[unit];
    prev = unit;
  }
  return { ok: true, feet: negative ? -total : total };
}

/**
 * Parse a user-entered length into feet (see `parseLength`); 0 for anything that is not a length.
 */
export const parseToFeet = (
  input: string | number | null | undefined,
  unitSystem: UnitSystem = 'ft-in',
): number => {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number')
    return Number.isFinite(input) ? input * SYSTEM_FEET_PER[unitSystem] : 0;
  const r = parseLength(input, unitSystem);
  return r.ok ? r.feet : 0;
};

/**
 * What a typed size looks like, with nothing of what it says: every digit becomes 9, letters and
 * marks stay, at most 12 characters (`11'7"` -> `99'9"`, `2,5 m` -> `9,9 m`). For analytics: which
 * forms people type that are not read.
 */
export const inputShape = (input: string): string =>
  input
    .trim()
    .replace(/\p{Nd}/gu, '9')
    .slice(0, 12);

/** Format the ft-in display (`12'6"`), handling negatives and inch rounding to 12. */
const formatFeetInches = (feet: number): string => {
  if (feet < 0) {
    const abs = formatFeetInches(-feet);
    return abs === "0'" ? abs : `-${abs}`;
  }
  const wholeFeet = Math.floor(feet);
  const inches = Math.round((feet - wholeFeet) * 12);
  if (inches === 12) return `${wholeFeet + 1}'`;
  if (inches === 0) return `${wholeFeet}'`;
  if (wholeFeet === 0) return `${inches}"`;
  return `${wholeFeet}'${inches}"`;
};

/** Human display with unit suffix, e.g. `12'6"`, `12.5 ft`, `3.81 m`. */
export const feetToDisplay = (feet: number, unitSystem: UnitSystem = 'ft-in'): string => {
  if (!Number.isFinite(feet)) return '0';
  switch (unitSystem) {
    case 'ft-in':
      return formatFeetInches(feet);
    case 'ft':
      return `${roundNum(feet, 2)} ft`;
    case 'in':
      return `${roundNum(feet * 12, 1)} in`;
    case 'm':
      return `${roundNum(feet / FEET_PER_METER, 2)} m`;
    case 'cm':
      return `${roundNum(feet / FEET_PER_CM, 1)} cm`;
  }
};

/** Value shown inside a dimension input (the suffix is drawn separately except for ft-in). */
export const feetToInputValue = (feet: number, unitSystem: UnitSystem = 'ft-in'): string => {
  if (!Number.isFinite(feet)) return '0';
  switch (unitSystem) {
    case 'ft-in':
      return formatFeetInches(feet);
    case 'ft':
      return roundNum(feet, 2).toString();
    case 'in':
      return roundNum(feet * 12, 1).toString();
    case 'm':
      return roundNum(feet / FEET_PER_METER, 2).toString();
    case 'cm':
      return roundNum(feet / FEET_PER_CM, 1).toString();
  }
};

/** Unit suffix drawn inside dimension inputs (ft-in values carry their own marks). */
export const unitSuffix = (unitSystem: UnitSystem): string | null =>
  unitSystem === 'ft-in' ? null : unitSystem;

/** Feet -> raw number in the target unit system (share/export format; keeps precision). */
export const feetToUnitValue = (feet: number, unitSystem: UnitSystem = 'ft-in'): number => {
  if (!feet && feet !== 0) return 0;
  switch (unitSystem) {
    case 'ft-in': // stored as decimal feet to preserve precision
    case 'ft':
      return roundNum(feet, 6);
    case 'in':
      return roundNum(feet * 12, 4);
    case 'm':
      return roundNum(feet / FEET_PER_METER, 6);
    case 'cm':
      return roundNum(feet / FEET_PER_CM, 4);
    default:
      return roundNum(feet, 6);
  }
};

/** Raw number in the source unit system -> feet (share/import format). */
export const unitValueToFeet = (value: number, unitSystem: string = 'ft-in'): number => {
  if (!value && value !== 0) return 0;
  switch (unitSystem) {
    case 'ft-in':
    case 'ft':
      return value;
    case 'in':
      return value / 12;
    case 'm':
      return value * FEET_PER_METER;
    case 'cm':
      return value * FEET_PER_CM;
    default:
      return value;
  }
};

/** Room area. Always square feet (the app's historical display). */
export const formatArea = (width: number, height: number): string =>
  `${roundNum(width * height, 1)} sq ft`;

// --- Keyboard nudge steps -----------------------------------------------------------------

/** How far one arrow-key press moves: `fine` (Alt/Option or Ctrl/Cmd), `normal`, `coarse` (Shift). */
export type NudgeSize = 'fine' | 'normal' | 'coarse';

const isMetric = (u: UnitSystem) => u === 'm' || u === 'cm';

/**
 * Arrow-key step in feet, in round numbers of the user's units: imperial 1 in / 3 in / 1 ft,
 * metric 1 cm / 5 cm / 25 cm. The single place these steps are defined (the keyboard handler,
 * help text and tests all read it).
 */
export const nudgeStep = (size: NudgeSize, unitSystem: UnitSystem): number => {
  if (isMetric(unitSystem)) {
    return { fine: 1, normal: 5, coarse: 25 }[size] * FEET_PER_CM;
  }
  return { fine: FEET_PER_INCH, normal: 0.25, coarse: 1 }[size];
};

// --- Room size limits and the "did you mean?" check -----------------------------------------

/**
 * Hard ceiling for a room side: 500 ft, or 150 m when working in metric (about 492 ft). Only a
 * safety net against nonsense; ordinary large rooms are confirmed instead (see below).
 */
export const roomMaxFeet = (unitSystem: UnitSystem): number =>
  isMetric(unitSystem) ? 150 * FEET_PER_METER : 500;

/** Above this a room side is unusual enough to ask before using it: 50 ft, or 15 m in metric. */
export const roomConfirmAboveFeet = (unitSystem: UnitSystem): number =>
  isMetric(unitSystem) ? 15 * FEET_PER_METER : 50;

/** Where a typed size goes: a room side, or anything else (a piece, a door, a position). */
export type SizeKind = 'room' | 'piece';

/** Another reading of a typed number: its length, and how to type it to mean that. */
export interface Reading {
  feet: number;
  /** The input that reads that way, e.g. `60"`, `450 cm`, `0.8 m`. */
  typed: string;
}

/**
 * A plausible other reading of a size that is out of range or unusually large, or null when there
 * is none. Only a unit-less number is reinterpreted, as the usual slip for each unit system:
 * - feet & inches: for a room, a bare 3-4 digit number is feet then inches (`117` = 11'7",
 *   `1210` = 12'10"; the inches must be 0-11); for anything else (`kind: 'piece'`) a bare number
 *   is first read as inches (`60` = 60" = 5'), people measure furniture in inches;
 * - decimal feet: for a piece, inches too;
 * - meters: a bare number is centimeters (`450` = 4.5 m); centimeters: millimeters (too large)
 *   or meters (too small: `0,8` = 0.8 m).
 * The result must itself be a sensible size: within [`min`, `max`] feet.
 */
export function otherReading(
  input: string,
  unitSystem: UnitSystem,
  { min, max }: { min: number; max: number },
  kind: SizeKind = 'room',
): Reading | null {
  const s = normalizeLength(input);
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  const ok = (feet: number, typed: string): Reading | null =>
    feet >= min - 1e-9 && feet <= max + 1e-9 ? { feet, typed } : null;
  const asInches = () => ok(n / 12, `${s}"`);
  const asFeetInches = (): Reading | null => {
    if (!/^\d{3,4}$/.test(s)) return null;
    const twoDigitInches = s.length === 4 ? Number(s.slice(2)) : NaN;
    const feet =
      twoDigitInches <= 11
        ? Number(s.slice(0, 2)) + twoDigitInches / 12
        : s.length === 3
          ? Number(s.slice(0, 2)) + Number(s.slice(2)) / 12
          : null;
    return feet === null ? null : ok(feet, feetToDisplay(feet, 'ft-in'));
  };
  if (unitSystem === 'ft-in') {
    return kind === 'piece' ? (asInches() ?? asFeetInches()) : asFeetInches();
  }
  if (unitSystem === 'ft') return kind === 'piece' ? asInches() : null;
  if (unitSystem === 'm') return ok(n * FEET_PER_CM, `${s} cm`);
  if (unitSystem === 'cm') {
    return n * FEET_PER_CM > max
      ? ok(n * FEET_PER_MM, `${s} mm`)
      : ok(n * FEET_PER_METER, `${s} m`);
  }
  return null;
}

/** `otherReading`'s length only (the room-size check's original form). */
export const suggestReading = (
  input: string,
  unitSystem: UnitSystem,
  range: { min: number; max: number },
  kind: SizeKind = 'room',
): number | null => otherReading(input, unitSystem, range, kind)?.feet ?? null;

/**
 * How to type a length in this unit system, with the user's own numbers where there are any
 * (`11 7` -> `11'7" or 11 7`), for the "couldn't read that" message.
 */
export function formatHint(input: string, unitSystem: UnitSystem): string {
  const nums = normalizeLength(input).match(/\d+(?:\.\d+)?/g) ?? [];
  const a = nums[0] ?? (unitSystem === 'cm' ? '250' : unitSystem === 'in' ? '75' : '11');
  const b = nums[1] ?? '6';
  switch (unitSystem) {
    case 'ft-in':
      return `${a}'${b}" or ${a} ${b}`;
    case 'ft':
      return `${a} ft or ${a}'${b}"`;
    case 'in':
      return `${a} in`;
    case 'm':
      return `${a} m`;
    case 'cm':
      return `${a} cm`;
  }
}

// --- Plan documents in other units ----------------------------------------------------------

/** One length from a document's unit to feet: the same factors `unitValueToFeet` uses. */
const TO_FEET: Record<Unit, (v: number) => number> = {
  ft: (v) => v,
  in: (v) => v / 12,
  m: (v) => v * FEET_PER_METER,
  cm: (v) => v * FEET_PER_CM,
};

/** One length from feet to a unit, rounded like `feetToUnitValue`. */
const FROM_FEET: Record<Unit, (feet: number) => number> = {
  ft: (f) => roundNum(f, 6),
  in: (f) => roundNum(f * 12, 4),
  m: (f) => roundNum(f / FEET_PER_METER, 6),
  cm: (f) => roundNum(f / FEET_PER_CM, 4),
};

/** The plan with every length passed through `f` and its unit set to `unit`. */
const mapLengths = (plan: Plan, f: (v: number) => number, unit: Unit): Plan => ({
  ...plan,
  unit,
  rooms: plan.rooms.map((r) => ({
    ...r,
    outline: r.outline.map((p) => ({ ...p, x: f(p.x), y: f(p.y) })),
    openings: r.openings.map((o) => ({ ...o, offset: f(o.offset), width: f(o.width) })),
  })),
  items: plan.items.map((i) => ({
    ...i,
    width: f(i.width),
    depth: f(i.depth),
    ...(i.cut ? { cut: { ...i.cut, width: f(i.cut.width), depth: f(i.cut.depth) } } : {}),
    ...(i.placement
      ? { placement: { ...i.placement, x: f(i.placement.x), y: f(i.placement.y) } }
      : {}),
  })),
});

/**
 * The plan in feet, the only unit the app holds (the last step of `loadPlan`). The same plan when
 * it already is. A plan without a display preference keeps showing its own unit: `in`, `m` or
 * `cm` becomes `settings.unitSystem`.
 */
export const toFeet = (plan: Plan): Plan => {
  if (plan.unit === 'ft') return plan;
  const out = mapLengths(plan, TO_FEET[plan.unit], 'ft');
  if (!plan.settings?.unitSystem) out.settings = { ...plan.settings, unitSystem: plan.unit };
  return out;
};

/** A plan in feet converted to `unit` for export (6 decimals for feet and metres, 4 otherwise). */
export const fromFeet = (plan: Plan, unit: Unit): Plan =>
  mapLengths(toFeet(plan), FROM_FEET[unit], unit);
