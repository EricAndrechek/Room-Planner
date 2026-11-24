import { describe, expect, it } from 'vitest';
import { WALL_FRAMES } from '../openings';
import { drawingFrame, isRectangle, openingInFrame, outlineArea, wallFrame } from './walls';

const rect = {
  outline: [
    { x: 0, y: 0 },
    { x: 14, y: 0 },
    { x: 14, y: 10 },
    { x: 0, y: 10 },
  ],
};
const room = { width: 14, height: 10 };

describe('wallFrame', () => {
  it('runs from outline[i] to outline[i + 1] with the room on its right-hand side', () => {
    expect(wallFrame(rect, 0)).toEqual({
      origin: { x: 0, y: 0 },
      along: { x: 1, y: 0 },
      inward: { x: 0, y: 1 },
      length: 14,
    });
    expect(wallFrame(rect, 1)).toEqual({
      origin: { x: 14, y: 0 },
      along: { x: 0, y: 1 },
      inward: { x: -1, y: 0 },
      length: 10,
    });
    expect(wallFrame(rect, 2)).toEqual({
      origin: { x: 14, y: 10 },
      along: { x: -1, y: 0 },
      inward: { x: 0, y: -1 },
      length: 14,
    });
    expect(wallFrame(rect, 3)).toEqual({
      origin: { x: 0, y: 10 },
      along: { x: 0, y: -1 },
      inward: { x: 1, y: 0 },
      length: 10,
    });
  });

  it('points inward on an angled wall too', () => {
    const tri = {
      outline: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    };
    const f = wallFrame(tri, 0);
    expect(f.length).toBeCloseTo(Math.SQRT2 * 10, 12);
    expect(f.inward.x).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(f.inward.y).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

describe('drawingFrame', () => {
  it("is exactly the v3 app's frame for each wall of a rectangle", () => {
    for (const [i, wall] of (['top', 'right', 'bottom', 'left'] as const).entries()) {
      const { origin, along, inward } = drawingFrame(rect, i);
      expect({ origin, along, inward }).toEqual(WALL_FRAMES[wall](room));
    }
    expect([0, 1, 2, 3].map((i) => drawingFrame(rect, i).reversed)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('maps an offset on a reversed wall to the same place on the floor', () => {
    const o = openingInFrame(rect, { wall: 2, offset: 2, width: 3, hinge: 'start' });
    expect(o).toMatchObject({ position: 9, width: 3, hingeAtEnd: true });
  });
});

describe('isRectangle', () => {
  it('needs four axis-aligned corners clockwise from the top left', () => {
    expect(isRectangle(rect)).toBe(true);
    expect(isRectangle({ outline: [...rect.outline].reverse() })).toBe(false);
    expect(
      isRectangle({
        outline: [
          { x: 0, y: 0 },
          { x: 5, y: 1 },
          { x: 5, y: 5 },
          { x: 0, y: 5 },
        ],
      }),
    ).toBe(false);
    expect(outlineArea(rect)).toBe(140);
  });
});
