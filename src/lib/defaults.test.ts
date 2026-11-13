import { describe, expect, it } from 'vitest';
import { INITIAL_DOORS, INITIAL_ROOM } from './constants';
import { checkItemsCollision, computeItemWarnings, isItemInBounds } from './geometry';
import { defaultLayout } from './layout';
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
      const r = door.width;
      const box =
        door.wall === 'bottom'
          ? { x: door.position, y: INITIAL_ROOM.height - r, width: r, height: r }
          : door.wall === 'top'
            ? { x: door.position, y: 0, width: r, height: r }
            : door.wall === 'left'
              ? { x: 0, y: door.position, width: r, height: r }
              : { x: INITIAL_ROOM.width - r, y: door.position, width: r, height: r };
      for (const item of layout.items) {
        expect(checkItemsCollision(item, { ...box, rotation: 0 }), item.label).toBe(false);
      }
    }
  });

  it('only applies to empty storage; stored layouts win, including an empty one', () => {
    expect(loadPersistedState(createMemoryStorage()).layout.items).toHaveLength(
      layout.items.length,
    );
    const stored = createMemoryStorage({ 'room-sim-v3-items': '[]' });
    expect(loadPersistedState(stored).layout.items).toEqual([]);
  });
});
