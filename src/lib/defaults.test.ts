import { describe, expect, it } from 'vitest';
import { INITIAL_DOORS, INITIAL_ROOM } from './constants';
import { checkItemsCollision, computeItemWarnings, isItemInBounds } from './geometry';
import { defaultLayout } from './layout';
import { computeDoorBlocks, doorSwingGeometry } from './openings';
import { createMemoryStorage, loadPersistedState } from './storage';

describe('default (first-visit) layout', () => {
  const layout = defaultLayout();

  it('has no collisions or out-of-bounds pieces', () => {
    expect(layout.items.length).toBeGreaterThan(3);
    for (const [id, w] of computeItemWarnings(layout.items, layout.roomDims)) {
      expect({ id, ...w }).toEqual({ id, outOfBounds: false, collision: false });
    }
  });

  it('keeps every piece inside the room', () => {
    for (const item of layout.items) expect(isItemInBounds(item, INITIAL_ROOM)).toBe(true);
  });

  it('leaves each door swing area clear', () => {
    for (const door of INITIAL_DOORS) {
      const swing = doorSwingGeometry(door, INITIAL_ROOM);
      if (!swing) continue;
      for (const item of layout.items) {
        expect(checkItemsCollision(item, { ...swing.box, rotation: 0 }), item.label).toBe(false);
      }
    }
  });

  it('blocks no door or doorway', () => {
    expect(computeDoorBlocks(layout.items, layout.doors, layout.roomDims).size).toBe(0);
  });

  it('only applies to empty storage; stored layouts win, including an empty one', () => {
    expect(loadPersistedState(createMemoryStorage()).layout.items).toHaveLength(
      layout.items.length,
    );
    const stored = createMemoryStorage({ 'room-sim-v3-items': '[]' });
    expect(loadPersistedState(stored).layout.items).toEqual([]);
  });
});
