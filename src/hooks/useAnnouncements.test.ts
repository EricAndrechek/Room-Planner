import { describe, expect, it } from 'vitest';
import { computeItemWarnings } from '../core/geometry';
import type { FurnitureItem, Layout } from '../types';
import {
  describeLayoutChange,
  describeNewWarnings,
  describeOpeningsChange,
} from './useAnnouncements';

const item = (over: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id: 1,
  label: 'Bed',
  width: 6,
  height: 4,
  x: 2,
  y: 2,
  rotation: 0,
  color: '#93c5fd',
  ...over,
});
const layout = (items: FurnitureItem[]): Layout => ({
  roomDims: { width: 12, height: 10 },
  doors: [],
  windows: [],
  items,
});

describe('describeLayoutChange', () => {
  it('describes moves, rotations, adds and removals', () => {
    const a = layout([item()]);
    expect(describeLayoutChange(a, layout([item({ x: 3 })]), 'ft-in')).toBe("Bed moved to 3', 2'");
    expect(describeLayoutChange(a, layout([item({ rotation: 90 })]), 'ft-in')).toBe(
      'Bed rotated 90°',
    );
    expect(describeLayoutChange(a, layout([item(), item({ id: 2, label: 'Desk' })]), 'ft-in')).toBe(
      'Desk added',
    );
    expect(describeLayoutChange(a, layout([]), 'ft-in')).toBe('Bed removed');
  });
});

describe('describeNewWarnings', () => {
  it('only reports warnings that were not there before', () => {
    const ok = layout([item(), item({ id: 2, label: 'Desk', x: 9, y: 6 })]);
    const bad = layout([item(), item({ id: 2, label: 'Desk', x: 3, y: 3 })]);
    const before = computeItemWarnings(ok.items, ok.roomDims);
    const after = computeItemWarnings(bad.items, bad.roomDims);
    expect(describeNewWarnings(before, after, bad.items)).toContain('Overlapping');
    expect(describeNewWarnings(after, after, bad.items)).toBe('');
  });
});

describe('describeOpeningsChange', () => {
  it('says which openings came back or went away', () => {
    const none = layout([]);
    const door = {
      id: 1,
      width: 3,
      position: 2,
      wall: 'bottom' as const,
      hinge: 'left' as const,
      type: 'swing-in' as const,
    };
    const win = { id: 2, width: 3, position: 2, wall: 'top' as const };
    const both = { ...none, doors: [door], windows: [win] };
    expect(describeOpeningsChange(none, both)).toBe('Door restored. Window restored');
    expect(describeOpeningsChange(both, { ...both, doors: [] })).toBe('Door removed');
    expect(describeOpeningsChange(both, both)).toBe('');
  });
});
