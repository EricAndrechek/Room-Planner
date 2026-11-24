import { describe, expect, it } from 'vitest';
import { loadPlan } from '../core/load';
import type { FurnitureItem, Layout } from '../core/testing/v3/types';
import { changePiece, placePiece, takeOutPiece } from '../lib/edits';
import { itemWarnings } from '../lib/plans';
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
const toPlan = (l: Layout) => {
  const r = loadPlan(l, 'strict', { lengthsInFeet: true });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};
const plan = (items: FurnitureItem[]) => toPlan(layout(items));

describe('describeLayoutChange', () => {
  it('says when a piece goes to the inventory and comes back', () => {
    const a = plan([item()]);
    const out = takeOutPiece(a, 'item-1');
    expect(describeLayoutChange(a, out, 'ft-in')).toBe('Bed moved to inventory');
    expect(describeLayoutChange(out, placePiece(out, 'item-1'), 'ft-in')).toBe(
      'Bed placed in the room',
    );
    // Undoing either says the same, from the other side.
    expect(describeLayoutChange(out, a, 'ft-in')).toBe('Bed placed in the room');
  });

  it('describes moves, rotations, adds and removals', () => {
    const a = plan([item()]);
    expect(describeLayoutChange(a, changePiece(a, 'item-1', { x: 3 }), 'ft-in')).toBe(
      "Bed moved to 3', 2'",
    );
    expect(describeLayoutChange(a, changePiece(a, 'item-1', { rotation: 90 }), 'ft-in')).toBe(
      'Bed rotated 90°',
    );
    expect(describeLayoutChange(a, plan([item(), item({ id: 2, label: 'Desk' })]), 'ft-in')).toBe(
      'Desk added',
    );
    expect(describeLayoutChange(a, plan([]), 'ft-in')).toBe('Bed removed');
  });
});

describe('describeNewWarnings', () => {
  it('only reports warnings that were not there before', () => {
    const ok = plan([item(), item({ id: 2, label: 'Desk', x: 9, y: 6 })]);
    const bad = plan([item(), item({ id: 2, label: 'Desk', x: 3, y: 3 })]);
    const before = itemWarnings(ok);
    const after = itemWarnings(bad);
    expect(describeNewWarnings(before, after, bad.items)).toContain('Overlapping');
    expect(describeNewWarnings(after, after, bad.items)).toBe('');
  });
});

describe('describeOpeningsChange', () => {
  it('says which openings came back or went away', () => {
    const none = plan([]);
    const both = toPlan({
      ...layout([]),
      doors: [{ id: 1, width: 3, position: 2, wall: 'bottom', hinge: 'left', type: 'swing-in' }],
      windows: [{ id: 2, width: 3, position: 2, wall: 'top' }],
    });
    const room = both.rooms[0]!;
    const noDoor = {
      ...both,
      rooms: [{ ...room, openings: room.openings.filter((o) => o.kind !== 'door') }],
    };
    expect(describeOpeningsChange(none, both)).toBe('Door restored. Window restored');
    expect(describeOpeningsChange(both, noDoor)).toBe('Door removed');
    expect(describeOpeningsChange(both, both)).toBe('');
  });
});
