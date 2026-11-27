import { describe, expect, it } from 'vitest';
import {
  FEET_PER_CM,
  FEET_PER_METER,
  FEET_PER_MM,
  feetToDisplay,
  feetToInputValue,
  feetToUnitValue,
  formatArea,
  formatHint,
  inputShape,
  otherReading,
  parseLength,
  parseToFeet,
  roundNum,
  unitValueToFeet,
  nudgeStep,
  roomConfirmAboveFeet,
  roomMaxFeet,
  suggestReading,
} from './units';
import type { UnitSystem } from './types';

const close = (actual: number, expected: number, digits = 6) =>
  expect(actual).toBeCloseTo(expected, digits);

describe('parseToFeet', () => {
  it.each([
    [`12'6"`, 12.5],
    [`12'`, 12],
    [`6"`, 0.5],
    [`12' 6"`, 12.5],
    [`12'6`, 12.5],
    [`6'3''`, 6.25],
    ['12ft 6in', 12.5],
    ['12 ft 6 in', 12.5],
    ['12.5 ft', 12.5],
    ['5 feet', 5],
    ['1 foot', 1],
    ['150in', 12.5],
    ['150 in', 12.5],
    ['18 inches', 1.5],
    ['6 inch', 0.5],
  ])('parses imperial %s', (input, feet) => {
    close(parseToFeet(input, 'ft-in'), feet);
  });

  it.each([
    ['3.5m', 3.5 * FEET_PER_METER],
    ['3.5 m', 3.5 * FEET_PER_METER],
    ['2 meters', 2 * FEET_PER_METER],
    ['350cm', 350 * FEET_PER_CM],
    ['350 cm', 350 * FEET_PER_CM],
    ['1m 20cm', FEET_PER_METER + 20 * FEET_PER_CM],
    ['1m 20', FEET_PER_METER + 20 * FEET_PER_CM],
    ['1200mm', 120 * FEET_PER_CM],
    ['.5m', 0.5 * FEET_PER_METER],
  ])('parses metric %s', (input, feet) => {
    close(parseToFeet(input, 'ft-in'), feet);
  });

  it.each([
    ['11 7', 11 + 7 / 12],
    ['10 11', 10 + 11 / 12],
    ['11  7', 11 + 7 / 12],
    ['11 7.5', 11 + 7.5 / 12],
    ['0 6', 0.5],
    ["11' 7", 11 + 7 / 12],
    ['11 7"', 11 + 7 / 12],
    ['11 ft 7', 11 + 7 / 12],
  ])('in feet & inches, a second bare number is inches: %s', (input, feet) => {
    close(parseToFeet(input, 'ft-in'), feet);
  });

  it('a second bare number is the next unit down: inches after feet, cm after meters', () => {
    close(parseToFeet('11 7', 'ft'), 11 + 7 / 12);
    close(parseToFeet('1 20', 'm'), FEET_PER_METER + 20 * FEET_PER_CM);
    // Inches and centimeters have nothing smaller: two bare numbers are not a length.
    expect(parseLength('11 7', 'in')).toEqual({ ok: false, problem: 'invalid' });
    expect(parseLength('20 3', 'cm')).toEqual({ ok: false, problem: 'invalid' });
  });

  it('bare digits without a separator stay one number (rejected later if out of range)', () => {
    close(parseToFeet('117', 'ft-in'), 117);
  });

  it('explicit units override the active unit system', () => {
    close(parseToFeet(`12'6"`, 'cm'), 12.5);
    close(parseToFeet('150in', 'm'), 12.5);
    close(parseToFeet('3.5m', 'in'), 3.5 * FEET_PER_METER);
    // The original parser treated "12.5 ft" as a plain number in the active system.
    close(parseToFeet('12.5 ft', 'm'), 12.5);
  });

  it.each<[UnitSystem, number]>([
    ['ft-in', 12],
    ['ft', 12],
    ['in', 1],
    ['m', 12 * FEET_PER_METER],
    ['cm', 12 * FEET_PER_CM],
  ])('plain numbers use the active system (%s)', (system, feet) => {
    close(parseToFeet('12', system), feet);
    close(parseToFeet(12, system), feet);
  });

  it('handles decimals', () => {
    close(parseToFeet('12.25', 'ft'), 12.25);
    close(parseToFeet('0.75', 'ft-in'), 0.75);
    close(parseToFeet('190.5', 'cm'), 190.5 * FEET_PER_CM);
    close(parseToFeet('2.5"', 'ft-in'), 2.5 / 12);
  });

  it('accepts typographic primes and quotes', () => {
    close(parseToFeet('12′6″', 'ft-in'), 12.5);
    close(parseToFeet('12’6”', 'ft-in'), 12.5);
  });

  it('is case and whitespace insensitive', () => {
    close(parseToFeet('  3.5M ', 'ft-in'), 3.5 * FEET_PER_METER);
    close(parseToFeet('12 FT', 'm'), 12);
  });

  it('returns 0 for empty or unparseable input (the caller clamps to min)', () => {
    expect(parseToFeet('', 'ft-in')).toBe(0);
    expect(parseToFeet('abc', 'ft-in')).toBe(0);
    expect(parseToFeet('"', 'ft-in')).toBe(0); // the original returned NaN here
    expect(parseToFeet(null, 'ft-in')).toBe(0);
    expect(parseToFeet(undefined, 'ft-in')).toBe(0);
  });

  it('keeps a leading minus sign', () => {
    close(parseToFeet('-3', 'ft'), -3);
  });

  it('does not mistake words for units', () => {
    // "12 minutes" is not 12 meters, and not a length at all.
    expect(parseLength('12 minutes', 'ft')).toEqual({ ok: false, problem: 'invalid' });
    expect(parseToFeet('12 minutes', 'ft')).toBe(0);
  });
});

describe('feetToDisplay', () => {
  it('formats feet & inches', () => {
    expect(feetToDisplay(12.5, 'ft-in')).toBe(`12'6"`);
    expect(feetToDisplay(12, 'ft-in')).toBe(`12'`);
    expect(feetToDisplay(0.5, 'ft-in')).toBe(`6"`);
    expect(feetToDisplay(0, 'ft-in')).toBe(`0'`);
    expect(feetToDisplay(11.999, 'ft-in')).toBe(`12'`); // rounds up to a whole foot
  });

  it('formats negative ft-in values correctly', () => {
    expect(feetToDisplay(-0.5, 'ft-in')).toBe(`-6"`);
    expect(feetToDisplay(-1.5, 'ft-in')).toBe(`-1'6"`);
  });

  it('formats every unit system', () => {
    expect(feetToDisplay(12.5, 'ft')).toBe('12.5 ft');
    expect(feetToDisplay(12.5, 'in')).toBe('150 in');
    expect(feetToDisplay(12, 'm')).toBe('3.66 m');
    expect(feetToDisplay(12, 'cm')).toBe('365.8 cm');
  });

  it('input values omit the suffix (shown separately)', () => {
    expect(feetToInputValue(12.5, 'ft')).toBe('12.5');
    expect(feetToInputValue(12.5, 'in')).toBe('150');
    expect(feetToInputValue(12, 'm')).toBe('3.66');
    expect(feetToInputValue(12, 'cm')).toBe('365.8');
    expect(feetToInputValue(12.5, 'ft-in')).toBe(`12'6"`);
  });

  it('round-trips display -> parse within display precision', () => {
    for (const system of ['ft-in', 'ft', 'in', 'm', 'cm'] as UnitSystem[]) {
      const shown = feetToInputValue(7.3, system);
      expect(Math.abs(parseToFeet(shown, system) - 7.3)).toBeLessThan(1 / 24 + 1e-9);
    }
  });
});

describe('unit value conversion (share/export format)', () => {
  it('feet <-> unit values', () => {
    expect(feetToUnitValue(12.5, 'ft-in')).toBe(12.5);
    expect(feetToUnitValue(12.5, 'in')).toBe(150);
    expect(feetToUnitValue(14.5, 'm')).toBe(4.4196);
    expect(feetToUnitValue(3, 'cm')).toBe(91.44);
    close(unitValueToFeet(150, 'in'), 12.5);
    close(unitValueToFeet(4.4196, 'm'), 4.4196 * FEET_PER_METER);
    close(unitValueToFeet(91.44, 'cm'), 91.44 * FEET_PER_CM);
    expect(unitValueToFeet(7, 'unknown-system')).toBe(7);
  });

  it('round-trips with sub-millimeter error', () => {
    for (const system of ['ft-in', 'ft', 'in', 'm', 'cm'] as UnitSystem[]) {
      for (const feet of [0, 0.1, 2.7142857142857153, 14.5, 99.99]) {
        expect(
          Math.abs(unitValueToFeet(feetToUnitValue(feet, system), system) - feet),
        ).toBeLessThan(1e-4);
      }
    }
  });

  it('roundNum and formatArea', () => {
    expect(roundNum(1.23456, 2)).toBe(1.23);
    expect(formatArea(14.5, 11)).toBe('159.5 sq ft');
  });
});

describe('nudgeStep', () => {
  it('uses inches and feet for imperial units', () => {
    for (const u of ['ft-in', 'ft', 'in'] as const) {
      expect(nudgeStep('fine', u)).toBeCloseTo(1 / 12, 10);
      expect(nudgeStep('normal', u)).toBe(0.25);
      expect(nudgeStep('coarse', u)).toBe(1);
    }
  });
  it('uses round centimeters for metric units', () => {
    for (const u of ['m', 'cm'] as const) {
      expect(feetToDisplay(nudgeStep('fine', u), 'cm')).toBe('1 cm');
      expect(feetToDisplay(nudgeStep('normal', u), 'cm')).toBe('5 cm');
      expect(feetToDisplay(nudgeStep('coarse', u), 'cm')).toBe('25 cm');
    }
  });
  it('orders fine < normal < coarse', () => {
    for (const u of ['ft-in', 'cm'] as const) {
      expect(nudgeStep('fine', u)).toBeLessThan(nudgeStep('normal', u));
      expect(nudgeStep('normal', u)).toBeLessThan(nudgeStep('coarse', u));
    }
  });
});

describe('room size limits', () => {
  it('has a generous ceiling: 500 ft, or 150 m in metric', () => {
    expect(roomMaxFeet('ft-in')).toBe(500);
    expect(roomMaxFeet('in')).toBe(500);
    close(roomMaxFeet('m'), 150 * FEET_PER_METER);
    close(roomMaxFeet('cm'), 150 * FEET_PER_METER);
  });

  it('asks above 50 ft, or 15 m in metric', () => {
    expect(roomConfirmAboveFeet('ft')).toBe(50);
    close(roomConfirmAboveFeet('m'), 15 * FEET_PER_METER);
  });
});

describe('suggestReading', () => {
  const range = { min: 1, max: 50 };
  it.each([
    ['117', 11 + 7 / 12],
    ['1210', 12 + 10 / 12],
    ['1011', 10 + 11 / 12],
    ['120', 12],
    ['1200', 12],
    [' 117 ', 11 + 7 / 12],
  ])('feet & inches: bare %s reads as feet then inches', (input, feet) => {
    close(suggestReading(input, 'ft-in', range)!, feet);
  });

  it.each(['1015', "117'", '117 ft', '11 7', '60', '12345', '11.7', '999'])(
    'feet & inches: no reading for %s',
    (input) => {
      // 999 would be 99'9": not a sensible room either.
      expect(suggestReading(input, 'ft-in', range)).toBeNull();
    },
  );

  it('meters: a bare number reads as centimeters; centimeters: as millimeters', () => {
    const metric = { min: 1, max: 15 * FEET_PER_METER };
    close(suggestReading('450', 'm', metric)!, 450 * FEET_PER_CM);
    close(suggestReading('4500', 'cm', metric)!, 450 * FEET_PER_CM);
    expect(suggestReading('450cm', 'm', metric)).toBeNull();
    expect(suggestReading('45000', 'm', metric)).toBeNull(); // 450 m: still not sensible
  });

  it('decimal feet and inches have no reading', () => {
    expect(suggestReading('117', 'ft', range)).toBeNull();
    expect(suggestReading('1404', 'in', range)).toBeNull();
  });
});

describe('parseLength: the forms people type (production rejections, Nov 2026)', () => {
  const ft = (f: number, i = 0) => f + i / 12;
  it.each<[string, UnitSystem, number]>([
    // Feet and inches, every way they are written.
    [`11'7`, 'ft-in', ft(11, 7)],
    [`11'7"`, 'ft-in', ft(11, 7)],
    [`11' 7"`, 'ft-in', ft(11, 7)],
    [`11'-7"`, 'ft-in', ft(11, 7)],
    [`11'7''`, 'ft-in', ft(11, 7)],
    [`11'7'`, 'ft-in', ft(11, 7)],
    ['11ft 7in', 'ft-in', ft(11, 7)],
    ['11 ft 7 in', 'ft-in', ft(11, 7)],
    ['11ft7', 'ft-in', ft(11, 7)],
    ['11ft7in', 'ft-in', ft(11, 7)],
    ['11 feet 7 inches', 'ft-in', ft(11, 7)],
    ['11 ft. 7 in.', 'ft-in', ft(11, 7)],
    ['11-7', 'ft-in', ft(11, 7)],
    ['11 7', 'ft-in', ft(11, 7)],
    ['11, 7', 'ft-in', ft(11, 7)],
    // Decimal and fractional feet.
    [`11.5'`, 'ft-in', 11.5],
    ['11.5 ft', 'ft-in', 11.5],
    ['11.5', 'ft-in', 11.5],
    [`11 1/2'`, 'ft-in', 11.5],
    [`11-1/2'`, 'ft-in', 11.5],
    ['11 1/2 ft', 'ft-in', 11.5],
    [`11½'`, 'ft-in', 11.5],
    [`5'6 1/2"`, 'ft-in', ft(5, 6.5)],
    // Inches alone.
    ['7"', 'ft-in', ft(0, 7)],
    ['7in', 'ft-in', ft(0, 7)],
    ['7 in', 'ft-in', ft(0, 7)],
    ['7 inches', 'ft-in', ft(0, 7)],
    ['7½"', 'ft-in', ft(0, 7.5)],
    ['1/2"', 'ft-in', ft(0, 0.5)],
    // Unicode primes, curly quotes, full-width characters.
    ['11′7″', 'ft-in', ft(11, 7)],
    ['11’7”', 'ft-in', ft(11, 7)],
    ['11‘7“', 'ft-in', ft(11, 7)],
    ['11′ 7′′', 'ft-in', ft(11, 7)],
    ['１１\'７"', 'ft-in', ft(11, 7)],
    // Spaces around.
    ['  11\'7"  ', 'ft-in', ft(11, 7)],
    ['\t12 ', 'ft-in', 12],
    // Metric with a decimal comma, and metric in any unit system.
    ['2,5 m', 'm', 2.5 * FEET_PER_METER],
    ['2,5', 'm', 2.5 * FEET_PER_METER],
    ['2,5m', 'ft-in', 2.5 * FEET_PER_METER],
    ['80,5', 'cm', 80.5 * FEET_PER_CM],
    ['1,200 mm', 'cm', 1200 * FEET_PER_MM],
    ['250 cm', 'ft-in', 250 * FEET_PER_CM],
    ['250cm', 'in', 250 * FEET_PER_CM],
    ['2.5 m', 'ft', 2.5 * FEET_PER_METER],
    ['900 mm', 'm', 900 * FEET_PER_MM],
    ['1 m 20 cm', 'cm', FEET_PER_METER + 20 * FEET_PER_CM],
    ['2 metres', 'cm', 2 * FEET_PER_METER],
    // Imperial in a metric system.
    [`11'7"`, 'cm', ft(11, 7)],
    ['30 in', 'm', 2.5],
    // Decimal feet system: a second number is inches.
    ['11 7', 'ft', ft(11, 7)],
    // Signs (room positions can be negative).
    ['-3', 'ft', -3],
    ['−3 ft', 'ft-in', -3],
    ['+3', 'ft', 3],
  ])('%j in %s', (input, system, feet) => {
    const r = parseLength(input, system);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) close(r.feet, feet);
  });

  it.each<[string, 'pair' | 'invalid' | 'empty']>([
    ['12x10', 'pair'],
    ['12 x 10', 'pair'],
    [`12' x 10'`, 'pair'],
    [`12'6" x 10'`, 'pair'],
    ['3m x 4m', 'pair'],
    ['3 m × 4 m', 'pair'],
    ['12 by 10', 'pair'],
    ['12*10', 'pair'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['abc', 'invalid'],
    ['"', 'invalid'],
    ['twelve feet', 'invalid'],
    ['12 minutes', 'invalid'],
    ['12 pies', 'invalid'],
    ['11 7 3', 'invalid'],
    ['6in 2ft', 'invalid'],
    ['20cm 1m', 'invalid'],
    ['7in 5', 'invalid'],
    ['12 ft ft', 'invalid'],
    ['1 2 3 4', 'invalid'],
  ])('%j is not a length (%s)', (input, problem) => {
    expect(parseLength(input, 'ft-in')).toEqual({ ok: false, problem });
  });
});

describe('inputShape (analytics: the form, never the numbers)', () => {
  it.each([
    [`11'7"`, `99'9"`],
    ['2,5 m', '9,9 m'],
    ['12x10', '99x99'],
    ['  117 ', '999'],
    ['１１ft', '99ft'],
    ['123456789012345', '999999999999'],
    ['', ''],
  ])('%j -> %j', (input, shape) => {
    expect(inputShape(input)).toBe(shape);
  });
});

describe('otherReading', () => {
  it('a bare number for a piece in feet & inches is first read as inches', () => {
    expect(otherReading('60', 'ft-in', { min: 0.1, max: 12 }, 'piece')).toEqual({
      feet: 5,
      typed: '60"',
    });
    // A room keeps its feet-then-inches reading, and never inches.
    expect(otherReading('117', 'ft-in', { min: 1, max: 50 }, 'room')).toEqual({
      feet: 11 + 7 / 12,
      typed: `11'7"`,
    });
    expect(otherReading('75', 'ft-in', { min: 1, max: 50 }, 'room')).toBeNull();
    // Inches out of range too: the feet-then-inches reading, if that fits.
    expect(otherReading('117', 'ft-in', { min: 0.1, max: 12 }, 'piece')?.feet).toBeCloseTo(9.75, 6);
    expect(otherReading('1404', 'ft-in', { min: 0.1, max: 12 }, 'piece')).toBeNull();
  });

  it('metric: too small in cm reads as meters, too large as mm; m reads as cm', () => {
    expect(otherReading('0,8', 'cm', { min: 1, max: 12 }, 'piece')).toEqual({
      feet: 0.8 * FEET_PER_METER,
      typed: '0.8 m',
    });
    expect(otherReading('4500', 'cm', { min: 1, max: 100 }, 'piece')?.typed).toBe('4500 mm');
    expect(otherReading('80', 'm', { min: 1, max: 12 }, 'piece')).toEqual({
      feet: 80 * FEET_PER_CM,
      typed: '80 cm',
    });
  });

  it('decimal feet: inches for a piece only', () => {
    expect(otherReading('30', 'ft', { min: 0.1, max: 12 }, 'piece')?.feet).toBe(2.5);
    expect(otherReading('30', 'ft', { min: 1, max: 12 }, 'room')).toBeNull();
  });

  it('only a bare number is reinterpreted', () => {
    expect(otherReading(`60'`, 'ft-in', { min: 0.1, max: 12 }, 'piece')).toBeNull();
    expect(otherReading('60 ft', 'ft-in', { min: 0.1, max: 12 }, 'piece')).toBeNull();
  });
});

describe('formatHint', () => {
  it('uses the numbers the user typed', () => {
    expect(formatHint('11 pies 7', 'ft-in')).toBe(`11'7" or 11 7`);
    expect(formatHint('12 pies', 'ft-in')).toBe(`12'6" or 12 6`);
    expect(formatHint('two', 'ft-in')).toBe(`11'6" or 11 6`);
    expect(formatHint('2,5 metros', 'm')).toBe('2.5 m');
    expect(formatHint('80 centimetros', 'cm')).toBe('80 cm');
  });
});
