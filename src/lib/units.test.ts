import { describe, expect, it } from 'vitest';
import {
  FEET_PER_CM,
  FEET_PER_METER,
  feetToDisplay,
  feetToInputValue,
  feetToUnitValue,
  formatArea,
  parseToFeet,
  roundNum,
  unitValueToFeet,
} from './units';
import type { UnitSystem } from '../types';

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
    // "12 minutes" is not 12 meters - falls back to the active unit.
    close(parseToFeet('12 minutes', 'ft'), 12);
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
