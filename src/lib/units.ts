import type { UnitSystem } from '../types';

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

// Word units must not be followed by another letter ("12 minutes" is not "12 m").
const TOKEN_RE =
  /(\d*\.?\d+)\s*(''|'|"|(?:feet|foot|ft|inches|inch|in|millimet(?:er|re)s?|mm|centimet(?:er|re)s?|cm|met(?:er|re)s?|m)(?![a-z]))?/g;

/**
 * Parse a user-entered length into feet.
 *
 * Accepts anything the original parser accepted (`12'6"`, `12'`, `6"`, `150in`,
 * `3.5m`, `350cm`, plain numbers in the active unit system) plus compound and
 * spelled-out forms (`12 ft 6 in`, `1m 20cm`, `5 feet`, `12.5 ft` in any unit
 * system). A bare number after a feet value is inches (`12'6`), after a meter
 * value is centimeters (`1m 20`). Unparseable input yields 0, like before.
 */
export const parseToFeet = (
  input: string | number | null | undefined,
  unitSystem: UnitSystem = 'ft-in',
): number => {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number')
    return Number.isFinite(input) ? input * SYSTEM_FEET_PER[unitSystem] : 0;

  const str = input
    .trim()
    .toLowerCase()
    .replace(/[′’‘`]/g, "'") // prime / curly apostrophes
    .replace(/[″“”]/g, '"'); // double prime / curly quotes
  const negative = /^-/.test(str);

  let total = 0;
  let matched = false;
  let prevUnit: LengthUnit | null = null;
  for (const match of str.matchAll(TOKEN_RE)) {
    const value = parseFloat(match[1]!);
    const rawUnit = match[2];
    let unit: LengthUnit | null = rawUnit ? (UNIT_ALIASES[rawUnit] ?? null) : null;
    if (!unit) {
      if (prevUnit === 'ft') unit = 'in';
      else if (prevUnit === 'm') unit = 'cm';
    }
    total += unit ? value * FEET_PER[unit] : value * SYSTEM_FEET_PER[unitSystem];
    prevUnit = unit;
    matched = true;
  }
  if (!matched) return 0;
  return negative ? -total : total;
};

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
