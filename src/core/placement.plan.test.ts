import { describe, expect, it } from 'vitest';
import { checkLayout } from './check';
import { loadPlan } from './load';
import { addItem } from './ops';
import {
  findFurnitureSpot,
  findOpeningSpot,
  findOpeningSpotOnWall,
  moveInside,
  piecesOutside,
} from './placement';
import type { Plan, PlanInput } from './schema';

const L = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 4 },
  { x: 12, y: 4 },
  { x: 12, y: 10 },
  { x: 0, y: 10 },
];
const load = (p: Partial<PlanInput>): Plan => {
  const r = loadPlan(
    { version: 4, unit: 'ft', rooms: [{ id: 'room-1', outline: L, openings: [] }], ...p },
    'strict',
  );
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};

describe('placement on a plan', () => {
  it('puts new pieces inside an L-shaped room, free of each other', () => {
    let p = load({});
    for (let k = 0; k < 6; k++) {
      const placement = findFurnitureSpot(p, p.rooms[0]!, { width: 3, depth: 2 });
      p = addItem(p, { label: `Box ${k}`, width: 3, depth: 2, placement });
    }
    expect(checkLayout(p, { codes: ['item_overlap', 'item_outside_room'] })).toEqual([]);
  });

  it('finds door spots on any wall of a polygon, as offsets from its start', () => {
    const p = load({});
    // Wall 2 runs from (6,4) to (12,4): 6 ft. A 3 ft door on it, kept off the corners.
    const spot = findOpeningSpot(
      p,
      p.rooms[0]!,
      3,
      { wall: 2, offset: 0 },
      { swing: { type: 'swing-in' } },
    );
    expect(spot.wall).toBe(2);
    expect(spot.offset).toBeGreaterThanOrEqual(0.5);
    expect(spot.offset + 3).toBeLessThanOrEqual(5.5);
    // Too wide for wall 1 (4 ft) with its corner margin: still placed on it, at its start.
    expect(findOpeningSpotOnWall(p, p.rooms[0]!, 3.5, 1, 0)).toBe(0);
    expect(findOpeningSpotOnWall(p, p.rooms[0]!, 5, 1, 0)).toBeNull();
  });

  it('measures offsets on a reversed wall from its own start corner', () => {
    const p = load({
      rooms: [
        {
          id: 'room-1',
          outline: L.slice(0, 4).concat([
            { x: 12, y: 10 },
            { x: 0, y: 10 },
          ]),
          openings: [{ id: 'door-1', kind: 'door', wall: 4, offset: 1, width: 3 }],
        },
      ],
    });
    // Bottom wall (4) runs right to left from (12,10); the door at offset 1 spans x 8..11. A
    // window placed there must leave it free.
    const spot = findOpeningSpotOnWall(p, p.rooms[0]!, 3, 4, 1);
    expect(spot).not.toBeNull();
    expect(spot! >= 4.5 || spot! + 3 <= 0.5).toBe(true);
  });

  it('moves a piece back inside, and lists pieces outside', () => {
    const p = load({
      items: [{ id: 'bed', label: 'Bed', width: 4, depth: 3, placement: { x: 11.5, y: 8 } }],
    });
    expect(piecesOutside(p).map((i) => i.id)).toEqual(['bed']);
    const moved = moveInside(p.items[0]!, p.rooms[0]!);
    expect(moved.placement).toMatchObject({ x: 10, y: 8 });
    expect(moveInside(moved, p.rooms[0]!)).toBe(moved);
  });
});
