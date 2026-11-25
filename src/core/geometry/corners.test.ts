import { describe, expect, it } from 'vitest';
import { distanceToWall, roomSnapLines, snapCorner } from './corners';
import { lOutline } from './walls';

// An L: the bottom-right 4 x 3 cut from a 12 x 10 box.
const L = { outline: lOutline({ width: 12, height: 10, corner: 'br', cutWidth: 4, cutHeight: 3 }) };
// (0,0) (12,0) (12,7) (8,7) (8,10) (0,10): corner 3 is the inner corner at (8, 7).

describe('snapCorner', () => {
  const opts = { threshold: 0.3, step: 0.25 };

  it('lines a corner up with its neighbours (square walls) and other corners', () => {
    const r = snapCorner(L, 3, { x: 8.2, y: 6.85 }, opts);
    expect(r.point).toEqual({ x: 8, y: 7 });
    expect(r.guides.map((g) => g.kind).sort()).toEqual(['square', 'square']);
    // Another corner's line: x = 12 is a far corner, not a neighbour of corner 4 (8, 10).
    const far = snapCorner(L, 4, { x: 11.9, y: 10.1 }, opts);
    expect(far.point).toEqual({ x: 12, y: 10 });
    expect(far.guides.map((g) => g.kind)).toContain('align');
  });

  it('makes a 45-degree wall to a neighbour when no axis lines up', () => {
    // Corner 3's neighbours are (12, 7) and (8, 10). 45 degrees from (8, 10): (10, 8).
    const r = snapCorner(L, 3, { x: 10.1, y: 7.95 }, opts);
    expect(r.point).toEqual({ x: 10, y: 8 });
    expect(r.guides).toEqual([{ from: { x: 8, y: 10 }, to: { x: 10, y: 8 }, kind: 'diagonal' }]);
  });

  it('rounds a free position to the step', () => {
    const r = snapCorner(L, 3, { x: 9.61, y: 5.13 }, opts);
    expect(r.point).toEqual({ x: 9.5, y: 5.25 });
    expect(r.guides).toEqual([]);
    expect(snapCorner(L, 3, { x: 9.61, y: 5.13 }, { threshold: 0.3 }).point).toEqual({
      x: 9.61,
      y: 5.13,
    });
  });
});

describe('roomSnapLines', () => {
  it('gives every straight wall of an L, each facing into the room, and the centre lines', () => {
    const { x, y } = roomSnapLines(L);
    const walls = (lines: typeof x) =>
      lines
        .filter((l) => l.source.kind === 'wall')
        .map((l) => [l.pos, l.edge])
        .sort();
    // The inner walls of the cut face out of the cut: x = 8 is a right wall, y = 7 a bottom wall.
    expect(walls(x)).toEqual(
      [
        [0, 'start'],
        [12, 'end'],
        [8, 'end'],
      ].sort(),
    );
    expect(walls(y)).toEqual(
      [
        [0, 'start'],
        [10, 'end'],
        [7, 'end'],
      ].sort(),
    );
    expect(x.find((l) => l.edge === 'center')?.pos).toBe(6);
    expect(y.find((l) => l.edge === 'center')?.pos).toBe(5);
  });
});

describe('distanceToWall', () => {
  it('finds the first wall along an axis, inside a concave room', () => {
    expect(distanceToWall(L, { x: 2, y: 8 }, { x: 1, y: 0 })).toBe(6);
    expect(distanceToWall(L, { x: 10, y: 2 }, { x: 0, y: 1 })).toBe(5);
    expect(distanceToWall(L, { x: 2, y: 2 }, { x: -1, y: 0 })).toBe(2);
  });
});
