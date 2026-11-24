import { describe, expect, it } from 'vitest';
import type { Door, FurnitureItem, Layout } from '../types';
import { isItemInBounds } from './geometry';
import { defaultLayout } from './layout';
import { computeDoorBlocks, computeLayoutWarnings } from './openings';
import { findFurnitureSpot, moveInside, piecesOutside } from './placement';

const piece = (over: Partial<FurnitureItem>): FurnitureItem => ({
  id: 'p',
  label: 'Piece',
  width: 2,
  height: 2,
  x: 0,
  y: 0,
  rotation: 0,
  color: '#93c5fd',
  visible: true,
  ...over,
});

const room = (width: number, height: number, items: FurnitureItem[] = [], doors: Door[] = []) => ({
  roomDims: { width, height },
  doors,
  items,
});

describe('findFurnitureSpot', () => {
  it('goes in the middle of an empty room', () => {
    expect(findFurnitureSpot(room(12, 12), { width: 3, height: 2 })).toEqual({ x: 4.5, y: 5 });
  });

  it('takes the free spot nearest the middle (ties: upper, then left)', () => {
    const block = piece({ id: 'b', x: 4, y: 4, width: 4, height: 4 });
    expect(findFurnitureSpot(room(12, 12, [block]), { width: 2, height: 2 })).toEqual({
      x: 5,
      y: 2,
    });
  });

  it('may touch another piece but never overlaps one', () => {
    const block = piece({ id: 'b', x: 4, y: 4, width: 4, height: 4 });
    const spot = findFurnitureSpot(room(12, 12, [block]), { width: 2, height: 2 });
    const layout: Layout = {
      ...room(12, 12, [block, piece({ id: 'n', ...spot })]),
      windows: [],
    };
    expect(computeLayoutWarnings(layout).get('n')).toMatchObject({
      collision: false,
      outOfBounds: false,
    });
  });

  it("keeps clear of a door's swing and doorway", () => {
    const door: Door = {
      id: 1,
      width: 3,
      position: 1.5,
      wall: 'bottom',
      hinge: 'left',
      type: 'swing-in',
    };
    const spot = findFurnitureSpot(room(6, 6, [], [door]), { width: 2, height: 2 });
    // The middle (2, 2) reaches into the swing (y 3..6); the spot found does not.
    expect(spot).not.toEqual({ x: 2, y: 2 });
    const added = piece({ id: 'n', ...spot });
    expect(computeDoorBlocks([added], [door], { width: 6, height: 6 }).size).toBe(0);
  });

  it('in the sample room, lands in free floor: inside, no overlap, no door blocked', () => {
    const layout = defaultLayout();
    const spot = findFurnitureSpot(layout, { width: 3, height: 2 });
    const added = piece({ id: 'new', width: 3, height: 2, ...spot });
    const next = { ...layout, items: [...layout.items, added] };
    expect(isItemInBounds(added, layout.roomDims)).toBe(true);
    expect(computeLayoutWarnings(next).get('new')).toEqual({
      outOfBounds: false,
      collision: false,
    });
  });

  it('ignores hidden pieces', () => {
    const hidden = piece({ id: 'h', x: 0, y: 0, width: 12, height: 12, visible: false });
    expect(findFurnitureSpot(room(12, 12, [hidden]), { width: 3, height: 2 })).toEqual({
      x: 4.5,
      y: 5,
    });
  });

  it('falls back to the middle when the room is full or the piece is too big', () => {
    const full = piece({ id: 'f', x: 0, y: 0, width: 4, height: 4 });
    expect(findFurnitureSpot(room(4, 4, [full]), { width: 1, height: 1 })).toEqual({
      x: 1.5,
      y: 1.5,
    });
    expect(findFurnitureSpot(room(2, 2), { width: 3, height: 2 })).toEqual({ x: -0.5, y: 0 });
  });
});

describe('moveInside / piecesOutside', () => {
  const r = { width: 10, height: 8 };

  it('leaves a piece that is inside alone (same object)', () => {
    const p = piece({ x: 1, y: 1 });
    expect(moveInside(p, r)).toBe(p);
  });

  it('shifts a piece back by the least amount, keeping size and rotation', () => {
    expect(moveInside(piece({ x: 9, y: 7, width: 3, height: 2 }), r)).toMatchObject({
      x: 7,
      y: 6,
      width: 3,
      height: 2,
    });
    expect(moveInside(piece({ x: -1, y: -0.5 }), r)).toMatchObject({ x: 0, y: 0 });
  });

  it('uses the rotated footprint', () => {
    // 4 x 2 turned 90deg: its footprint is 2 wide and 4 deep, centred on (x + 2, y + 1).
    const turned = piece({ x: 8, y: 6, width: 4, height: 2, rotation: 90 });
    const moved = moveInside(turned, r);
    expect(isItemInBounds(moved, r)).toBe(true);
    expect(moved.rotation).toBe(90);
    // Flush with the right and bottom walls.
    expect(moved.x + 2 + 1).toBeCloseTo(10, 6);
    expect(moved.y + 1 + 2).toBeCloseTo(8, 6);
  });

  it('aligns a piece bigger than the room with the top/left walls', () => {
    expect(moveInside(piece({ x: 3, y: 3, width: 12, height: 2 }), r)).toMatchObject({
      x: 0,
      y: 3,
    });
  });

  it('lists only visible pieces outside the room', () => {
    const items = [
      piece({ id: 'in', x: 1, y: 1 }),
      piece({ id: 'out', x: 9, y: 1 }),
      piece({ id: 'hidden', x: 20, y: 1, visible: false }),
    ];
    expect(piecesOutside(items, r).map((i) => i.id)).toEqual(['out']);
  });
});
