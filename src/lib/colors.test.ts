import { describe, expect, it } from 'vitest';
import {
  COLOR_PRESETS,
  DARK_TEXT,
  blendOnWhite,
  contrastRatio,
  readableTextOn,
  relativeLuminance,
} from './colors';

describe('contrast', () => {
  it('computes WCAG luminance and ratios', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrastRatio('#64748b', '#ffffff')).toBeCloseTo(4.76, 2); // slate-500 on white
  });

  it('labels every preset in dark text with at least AA contrast', () => {
    for (const p of COLOR_PRESETS) {
      expect(readableTextOn(p.hex)).toBe(DARK_TEXT);
      expect(contrastRatio(DARK_TEXT, p.hex)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('switches to white on dark custom colors, and always picks the better of the two', () => {
    expect(readableTextOn('#123abc')).toBe('#ffffff');
    expect(readableTextOn('#000000')).toBe('#ffffff');
    expect(readableTextOn('#ffff00')).toBe(DARK_TEXT);
    for (const hex of ['#123abc', '#7c3aed', '#16a34a', '#dc2626', '#808080', '#f0abfc']) {
      const chosen = readableTextOn(hex);
      const other = chosen === DARK_TEXT ? '#ffffff' : DARK_TEXT;
      expect(contrastRatio(chosen, hex)).toBeGreaterThanOrEqual(contrastRatio(other, hex));
    }
  });

  it('blends a fill over white', () => {
    expect(blendOnWhite('#000000', 0.5)).toBe('#808080');
    expect(blendOnWhite('#93c5fd', 1)).toBe('#93c5fd');
    expect(blendOnWhite('#93c5fd', 0)).toBe('#ffffff');
  });
});
