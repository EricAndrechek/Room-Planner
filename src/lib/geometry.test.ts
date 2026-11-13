import { describe, expect, it } from 'vitest';
import {
  angleAround,
  angleDelta,
  checkItemsCollision,
  computeFitZoom,
  computeItemWarnings,
  constrainOpening,
  getRotatedCorners,
  isItemInBounds,
  snapRotation,
  wallLength,
} from './geometry';
import type { Door, FurnitureItem } from '../types';

const item = (over: Partial<FurnitureItem>): FurnitureItem => ({
  id: 1,
  label: 'x',
  width: 2,
  height: 2,
  x: 0,
  y: 0,
  rotation: 0,
  color: '#93c5fd',
  visible: true,
  ...over,
});

const room = { width: 12, height: 12 };

describe('getRotatedCorners', () => {
  it('returns the box when unrotated', () => {
    expect(getRotatedCorners(item({ x: 1, y: 2, width: 4, height: 2 }))).toEqual([
      { x: 1, y: 2 },
      { x: 5, y: 2 },
      { x: 5, y: 4 },
      { x: 1, y: 4 },
    ]);
  });

  it('rotates about the center (CSS transform-origin: center)', () => {
    // 4x2 box at (1,2): center (3,3). Rotated 90deg it spans x 2..4, y 1..5.
    const corners = getRotatedCorners(item({ x: 1, y: 2, width: 4, height: 2, rotation: 90 }));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    expect(Math.min(...xs)).toBeCloseTo(2);
    expect(Math.max(...xs)).toBeCloseTo(4);
    expect(Math.min(...ys)).toBeCloseTo(1);
    expect(Math.max(...ys)).toBeCloseTo(5);
  });

  it('treats a missing rotation as 0', () => {
    const { rotation: _rotation, ...noRotation } = item({ x: 1, y: 1 });
    expect(getRotatedCorners(noRotation)).toEqual(getRotatedCorners(item({ x: 1, y: 1 })));
  });
});

describe('checkItemsCollision', () => {
  it('detects axis-aligned overlap', () => {
    expect(checkItemsCollision(item({ x: 0 }), item({ x: 1 }))).toBe(true);
    expect(checkItemsCollision(item({ x: 0 }), item({ x: 3 }))).toBe(false);
  });

  it('does not flag pieces that only touch', () => {
    expect(checkItemsCollision(item({ x: 0 }), item({ x: 2 }))).toBe(false);
    expect(checkItemsCollision(item({ y: 0 }), item({ y: 2 }))).toBe(false);
  });

  it('uses the rotated footprint, not the unrotated box', () => {
    // A 6x1 bar at (0,0) rotated 90deg occupies x 2.5..3.5, y -2.5..3.5.
    const bar = item({ width: 6, height: 1, rotation: 90 });
    // Overlaps the unrotated box but not the rotated one:
    expect(checkItemsCollision(bar, item({ x: 4.5, y: 0, width: 1, height: 1 }))).toBe(false);
    // Doesn't overlap the unrotated box but does overlap the rotated one:
    expect(checkItemsCollision(bar, item({ x: 2.6, y: 2, width: 0.5, height: 1 }))).toBe(true);
  });

  it('handles 45deg diamonds (SAT, not bounding boxes)', () => {
    const diamond = item({ x: 0, y: 0, width: 2, height: 2, rotation: 45 });
    // AABB of the diamond reaches the corner region, but the diamond itself doesn't.
    const corner = item({ x: 1.8, y: 1.8, width: 0.4, height: 0.4 });
    expect(checkItemsCollision(diamond, corner)).toBe(false);
    expect(checkItemsCollision(diamond, item({ x: 0.9, y: 0.9, width: 0.2, height: 0.2 }))).toBe(
      true,
    );
  });

  it('is symmetric', () => {
    const a = item({ x: 1, y: 1, width: 3, height: 1, rotation: 30 });
    const b = item({ x: 2, y: 1.5, width: 1, height: 2, rotation: 110 });
    expect(checkItemsCollision(a, b)).toBe(checkItemsCollision(b, a));
  });
});

describe('isItemInBounds', () => {
  it('accepts items inside and flush with the walls', () => {
    expect(isItemInBounds(item({ x: 0, y: 0 }), room)).toBe(true);
    expect(isItemInBounds(item({ x: 10, y: 10 }), room)).toBe(true);
  });

  it('rejects items crossing a wall', () => {
    expect(isItemInBounds(item({ x: -0.1 }), room)).toBe(false);
    expect(isItemInBounds(item({ x: 10.5 }), room)).toBe(false);
  });

  it('accounts for rotation', () => {
    // 6x2 at (0,5) fits unrotated but rotated 90deg its top-left corner leaves the room.
    expect(isItemInBounds(item({ x: 0, y: 5, width: 6, height: 2 }), room)).toBe(true);
    expect(isItemInBounds(item({ x: 0, y: 0, width: 6, height: 2, rotation: 90 }), room)).toBe(
      false,
    );
    // A 2x2 rotated 45deg in a corner pokes out.
    expect(isItemInBounds(item({ x: 0, y: 0, rotation: 45 }), room)).toBe(false);
  });
});

describe('computeItemWarnings', () => {
  it('ignores hidden items both ways', () => {
    const a = item({ id: 'a', x: 0 });
    const b = item({ id: 'b', x: 1, visible: false });
    const warnings = computeItemWarnings([a, b], room);
    expect(warnings.get('a')).toEqual({ outOfBounds: false, collision: false });
    expect(warnings.has('b')).toBe(false);
  });

  it('flags overlaps and out-of-bounds', () => {
    const warnings = computeItemWarnings(
      [item({ id: 1, x: 0 }), item({ id: 2, x: 1 }), item({ id: 3, x: 11 })],
      room,
    );
    expect(warnings.get(1)).toEqual({ outOfBounds: false, collision: true });
    expect(warnings.get(3)).toEqual({ outOfBounds: true, collision: false });
  });
});

describe('openings', () => {
  const door: Door = {
    id: 1,
    width: 3,
    position: 6,
    wall: 'bottom',
    hinge: 'left',
    type: 'swing-in',
  };
  const rect = { width: 14, height: 10 };

  it('wallLength', () => {
    expect(wallLength(rect, 'top')).toBe(14);
    expect(wallLength(rect, 'left')).toBe(10);
  });

  it('clamps width and position to the wall', () => {
    expect(constrainOpening(door, { position: 20 }, rect).position).toBe(11);
    expect(constrainOpening(door, { width: 50 }, rect)).toMatchObject({ width: 14, position: 0 });
    expect(constrainOpening(door, { width: 0.2 }, rect).width).toBe(1);
    expect(constrainOpening(door, { width: 0.2 }, rect, 0.5).width).toBe(0.5);
    // moving to a shorter wall re-clamps the position
    expect(constrainOpening({ ...door, position: 11 }, { wall: 'left' }, rect)).toMatchObject({
      wall: 'left',
      position: 7,
    });
  });
});

describe('rotation helpers', () => {
  it('angleAround uses screen (clockwise) degrees', () => {
    const c = { x: 0, y: 0 };
    expect(angleAround(c, { x: 1, y: 0 })).toBeCloseTo(0);
    expect(angleAround(c, { x: 0, y: 1 })).toBeCloseTo(90); // down the screen = clockwise
    expect(angleAround(c, { x: 0, y: -1 })).toBeCloseTo(-90);
  });

  it('angleDelta takes the short way around', () => {
    expect(angleDelta(350, 10)).toBeCloseTo(20);
    expect(angleDelta(10, 350)).toBeCloseTo(-20);
    expect(angleDelta(-170, 170)).toBeCloseTo(-20);
  });

  it('snapRotation normalizes and snaps within 5deg of a 15deg step', () => {
    expect(snapRotation(43)).toBe(45);
    expect(snapRotation(48)).toBe(45);
    expect(snapRotation(52)).toBe(52);
    expect(snapRotation(-2)).toBe(0);
    expect(snapRotation(358)).toBe(0);
    expect(snapRotation(450)).toBe(90);
    expect(snapRotation(37.5)).toBe(37.5);
  });
});

describe('computeFitZoom', () => {
  it('fits the room and clamps', () => {
    expect(computeFitZoom({ width: 960, height: 480 }, { width: 12, height: 12 }, 40)).toBe(1);
    expect(computeFitZoom({ width: 100, height: 100 }, { width: 100, height: 100 }, 40)).toBe(0.25);
    expect(computeFitZoom({ width: 5000, height: 5000 }, { width: 1, height: 1 }, 40)).toBe(2);
  });
});
