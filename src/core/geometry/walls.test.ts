import { describe, expect, it } from 'vitest';
import { WALL_FRAMES } from '../testing/v3/openings';
import {
  drawingFrame,
  firstCorner,
  isRectangle,
  lOutline,
  lShapeOf,
  openingInFrame,
  outlineArea,
  roomShapeOf,
  wallAngle,
  wallFrame,
} from './walls';

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

describe('room shapes', () => {
  const L = { width: 12, height: 10, cutWidth: 4, cutHeight: 3 };
  const corners = ['tl', 'tr', 'br', 'bl'] as const;

  it('lOutline is a clockwise six-corner outline listed from its top-left-most corner', () => {
    for (const corner of corners) {
      const outline = lOutline({ ...L, corner });
      expect(outline).toHaveLength(6);
      expect(firstCorner(outline)).toBe(0);
      expect(outlineArea({ outline })).toBe(12 * 10 - 4 * 3);
      // Clockwise as drawn (y down): positive signed area.
      let a = 0;
      outline.forEach((p, i) => {
        const q = outline[(i + 1) % 6]!;
        a += p.x * q.y - q.x * p.y;
      });
      expect(a).toBeGreaterThan(0);
    }
  });

  it('lShapeOf reads an L back from any starting corner and anywhere on the floor', () => {
    for (const corner of corners) {
      const outline = lOutline({ ...L, corner }, { x: 3, y: -2 });
      for (let k = 0; k < 6; k++) {
        const turned = [...outline.slice(k), ...outline.slice(0, k)];
        expect(lShapeOf({ outline: turned })).toEqual({ ...L, corner });
        expect(roomShapeOf({ outline: turned })).toBe('l');
      }
    }
  });

  it('lShapeOf is null for rectangles, counter-clockwise outlines and other six-corner shapes', () => {
    expect(lShapeOf(rect)).toBeNull();
    expect(lShapeOf({ outline: [...lOutline({ ...L, corner: 'tr' })].reverse() })).toBeNull();
    // A U-ish notch in the middle of a side: six corners, but not a cut-out corner.
    const notch = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 8, y: 2 },
      { x: 8, y: 6 },
      { x: 0, y: 6 },
    ];
    expect(lShapeOf({ outline: notch })).toEqual({
      width: 8,
      height: 6,
      corner: 'tr',
      cutWidth: 4,
      cutHeight: 2,
    });
    const angled = [...notch];
    angled[1] = { x: 4, y: 1 };
    expect(lShapeOf({ outline: angled })).toBeNull();
    expect(roomShapeOf({ outline: angled })).toBe('custom');
    expect(roomShapeOf(rect)).toBe('rect');
  });

  it('wallAngle is clockwise from pointing right', () => {
    expect([0, 1, 2, 3].map((i) => wallAngle(rect, i))).toEqual([0, 90, 180, 270]);
    const tri = {
      outline: [
        { x: 0, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
    };
    expect(wallAngle(tri, 0)).toBe(45);
  });
});
