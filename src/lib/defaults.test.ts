import { describe, expect, it } from 'vitest';
import { checkItemsCollision, isItemInBounds } from '../core/geometry';
import { openingDoorGeometry, sweptArea } from '../core/geometry/doors';
import { loadPlan } from '../core/load';
import {
  INITIAL_DOORS,
  INITIAL_ITEMS,
  INITIAL_ROOM,
  INITIAL_WINDOWS,
} from '../core/testing/v3/constants';
import type { Layout } from '../core/testing/v3/types';
import { boxOf, doorsOf, itemWarnings, mainRoom, roomSize, starterPlan } from './plans';

const toPlan = (layout: Layout) => {
  const r = loadPlan(layout, 'strict', { lengthsInFeet: true });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};

describe('default (first-visit) plan', () => {
  const plan = starterPlan();
  const room = mainRoom(plan);
  const dims = roomSize(room);
  const boxes = plan.items.map((i) => ({ ...boxOf(i), label: i.label }));

  it('has no collisions or out-of-bounds pieces', () => {
    expect(plan.items.length).toBeGreaterThan(3);
    for (const [id, w] of itemWarnings(plan)) {
      expect({ id, ...w }).toEqual({ id, outOfBounds: false, collision: false });
    }
  });

  it('keeps every piece inside the room', () => {
    for (const box of boxes) expect(isItemInBounds(box, dims)).toBe(true);
  });

  it('leaves each door swing area clear', () => {
    let swings = 0;
    for (const door of doorsOf(room)) {
      for (const leaf of openingDoorGeometry(room, door).leaves) {
        swings++;
        // The leaf's swept area as the box it fits in (what the v3 swing geometry's `box` was).
        const pts = sweptArea(leaf, 15);
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const swing = {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
          rotation: 0,
        };
        for (const box of boxes) expect(checkItemsCollision(box, swing), box.label).toBe(false);
      }
    }
    expect(swings).toBeGreaterThan(0);
  });

  it('is the v3 starter room, read as the app reads stored v3 data', () => {
    const v3 = toPlan({
      roomDims: INITIAL_ROOM,
      doors: INITIAL_DOORS,
      windows: INITIAL_WINDOWS,
      items: INITIAL_ITEMS,
    });
    expect(plan.rooms).toEqual(v3.rooms);
    expect(plan.items).toEqual(v3.items);
  });
});
