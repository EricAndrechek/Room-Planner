import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CORNERS } from '../schema';
import { getRotatedCorners, pointInPolygon } from './index';
import {
  ELLIPSE_SIDES,
  MIN_CUT,
  clampCut,
  defaultCut,
  itemBox,
  itemParts,
  labelArea,
  lOutline,
  notchEdges,
  partsBounds,
  shapeExtents,
} from './shapes';

const base = { width: 4, depth: 2, placement: { x: 5, y: 3, rotation: 30 } };

describe('itemParts', () => {
  it('a rectangle is the same four corners the v3 app used', () => {
    const parts = itemParts({ ...base, shape: 'rect' });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual(getRotatedCorners(itemBox(base)!));
  });

  it('an L is its box without the cut corner, as two rectangles', () => {
    const l = {
      shape: 'l' as const,
      width: 4,
      depth: 3,
      cut: { corner: 'tr' as const, width: 1, depth: 1 },
      placement: { x: 2, y: 1.5, rotation: 0 },
    };
    const parts = itemParts(l);
    expect(parts).toEqual([
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
        { x: 0, y: 3 },
      ],
      [
        { x: 3, y: 1 },
        { x: 4, y: 1 },
        { x: 4, y: 3 },
        { x: 3, y: 3 },
      ],
    ]);
    const area = parts.reduce((a, p) => a + (p[1]!.x - p[0]!.x) * (p[2]!.y - p[1]!.y), 0);
    expect(area).toBe(4 * 3 - 1);
    for (const corner of ['tl', 'tr', 'br', 'bl'] as const) {
      expect(partsBounds(itemParts({ ...l, cut: { ...l.cut, corner } }))).toEqual({
        left: 0,
        top: 0,
        right: 4,
        bottom: 3,
      });
    }
  });

  it('an ellipse is a 32-sided polygon on the curve', () => {
    const [poly] = itemParts({ ...base, shape: 'ellipse', placement: { x: 0, y: 0, rotation: 0 } });
    expect(poly).toHaveLength(ELLIPSE_SIDES);
    for (const p of poly!) expect((p.x / 2) ** 2 + (p.y / 1) ** 2).toBeCloseTo(1, 12);
  });

  it('has no parts in the inventory', () => {
    expect(itemParts({ shape: 'rect', width: 1, depth: 1 })).toEqual([]);
    expect(itemBox({ width: 1, depth: 1 })).toBeNull();
  });
});

describe('L cuts', () => {
  it('a new L gets 3 ft arms (half the box when smaller), cut at the top right', () => {
    expect(defaultCut(9, 7)).toEqual({ corner: 'tr', width: 6, depth: 4 });
    expect(defaultCut(3, 2)).toEqual({ corner: 'tr', width: 2, depth: 1 });
    expect(defaultCut(1, 1)).toEqual({ corner: 'tr', width: 0.5, depth: 0.5 });
  });

  it('a cut stays at least MIN_CUT inside its box, and is the same object when it fits', () => {
    const cut = { corner: 'bl' as const, width: 6, depth: 4 };
    expect(clampCut(cut, 9, 7)).toBe(cut);
    expect(clampCut(cut, 5, 3)).toEqual({ corner: 'bl', width: 5 - MIN_CUT, depth: 3 - MIN_CUT });
    expect(clampCut({ ...cut, width: 0, depth: -1 }, 9, 7)).toMatchObject({
      width: MIN_CUT,
      depth: MIN_CUT,
    });
    expect(clampCut(cut, 0.1, 0.1)).toMatchObject({ width: 0.05, depth: 0.05 });
  });

  it('the outline is the two parts: six corners, the box minus the cut', () => {
    const area = (pts: { x: number; y: number }[]) =>
      Math.abs(
        pts.reduce((a, p, i) => {
          const q = pts[(i + 1) % pts.length]!;
          return a + p.x * q.y - q.x * p.y;
        }, 0),
      ) / 2;
    for (const corner of CORNERS) {
      const cut = { corner, width: 3, depth: 1 };
      const outline = lOutline(5, 4, cut);
      expect(outline).toHaveLength(6);
      expect(area(outline)).toBeCloseTo(5 * 4 - 3, 12);
      const parts = itemParts({
        shape: 'l',
        width: 5,
        depth: 4,
        cut,
        placement: { x: 2.5, y: 2, rotation: 0 },
      });
      // Every corner of the outline is a corner of a part.
      for (const p of outline) {
        expect(parts.some((part) => part.some((q) => q.x === p.x && q.y === p.y))).toBe(true);
      }
    }
  });
});

describe('labelArea', () => {
  it('is the box, the larger part of an L, or the rectangle inside an ellipse', () => {
    expect(labelArea({ shape: 'rect', width: 3, depth: 2 })).toEqual({
      x: 0,
      y: 0,
      width: 3,
      height: 2,
    });
    // 9 x 7 with a 6 x 4 cut: the 9 x 3 arm (27) beats the 3 x 7 one (21).
    expect(
      labelArea({ shape: 'l', width: 9, depth: 7, cut: { corner: 'tr', width: 6, depth: 4 } }),
    ).toEqual({ x: 0, y: 4, width: 9, height: 3 });
    expect(
      labelArea({ shape: 'l', width: 9, depth: 7, cut: { corner: 'tr', width: 2, depth: 4 } }),
    ).toEqual({ x: 0, y: 0, width: 7, height: 7 });
    const e = labelArea({ shape: 'ellipse', width: 4, depth: 2 });
    expect(e.width).toBeCloseTo(4 * Math.SQRT1_2, 12);
    expect(e.x + e.width / 2).toBeCloseTo(2, 12);
    expect(e.y + e.height / 2).toBeCloseTo(1, 12);
  });
});

describe('shapeExtents', () => {
  it('a circle has the same bounds at every angle; a rectangle and an L follow their corners', () => {
    for (const rotation of [0, 17, 45, 90, 133, 270]) {
      const c = shapeExtents({ shape: 'ellipse', width: 4, depth: 4 }, rotation);
      expect(c.right).toBeCloseTo(2, 12);
      expect(c.bottom).toBeCloseTo(2, 12);
    }
    const r = shapeExtents({ shape: 'rect', width: 2, depth: 2 }, 45);
    expect(r.right).toBeCloseTo(Math.SQRT2, 12);
  });

  it('matches the polygon parts (an ellipse is never inside its 32-gon)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('rect' as const, 'l' as const, 'ellipse' as const),
        fc.double({ min: 0.5, max: 12, noNaN: true }),
        fc.double({ min: 0.5, max: 12, noNaN: true }),
        fc.constantFrom(...CORNERS),
        fc.double({ min: 0, max: 359.99, noNaN: true }),
        (shape, width, depth, corner, rotation) => {
          const item = {
            shape,
            width,
            depth,
            ...(shape === 'l' && { cut: { corner, width: width / 2, depth: depth / 3 } }),
          };
          const e = shapeExtents(item, rotation);
          const b = partsBounds(itemParts({ ...item, placement: { x: 0, y: 0, rotation } }));
          const tol = shape === 'ellipse' ? 0.006 * Math.max(width, depth) : 1e-9;
          for (const k of ['left', 'top'] as const) {
            expect(e[k]).toBeLessThanOrEqual(b[k] + 1e-9);
            expect(b[k] - e[k]).toBeLessThanOrEqual(tol);
          }
          for (const k of ['right', 'bottom'] as const) {
            expect(e[k]).toBeGreaterThanOrEqual(b[k] - 1e-9);
            expect(e[k] - b[k]).toBeLessThanOrEqual(tol);
          }
        },
      ),
    );
  });
});

describe('notchEdges', () => {
  const sofa = {
    shape: 'l' as const,
    width: 9,
    depth: 7,
    cut: { corner: 'tr' as const, width: 6, depth: 4 },
  };

  it('gives the two inner edges of the notch, facing into it', () => {
    // Box from (0,0) to (9,7): the notch is x 3..9, y 0..4.
    expect(notchEdges(sofa, { x: 4.5, y: 3.5 }, 0)).toEqual([
      { axis: 'x', pos: 3, facing: 'end', span: [0, 4] },
      { axis: 'y', pos: 4, facing: 'start', span: [3, 9] },
    ]);
    // A quarter turn clockwise about the centre (box x 1..8, y -1..8): the notch is at the
    // bottom right, x 4..8, y 2..8.
    expect(notchEdges(sofa, { x: 4.5, y: 3.5 }, 90)).toEqual([
      { axis: 'y', pos: 2, facing: 'end', span: [4, 8] },
      { axis: 'x', pos: 4, facing: 'end', span: [2, 8] },
    ]);
  });

  it('lie on the outline of the turned L, at every corner and quarter turn', () => {
    for (const corner of CORNERS) {
      for (const rotation of [0, 90, 180, 270]) {
        const item = { ...sofa, cut: { ...sofa.cut, corner } };
        const parts = itemParts({ ...item, placement: { x: 4.5, y: 3.5, rotation } });
        for (const e of notchEdges(item, { x: 4.5, y: 3.5 }, rotation)) {
          const mid = (e.span[0] + e.span[1]) / 2;
          const p = e.axis === 'x' ? { x: e.pos, y: mid } : { x: mid, y: e.pos };
          // Just outside the edge (towards its facing) is outside the L, just inside is in it.
          const step = e.facing === 'end' ? 0.01 : -0.01;
          const out = e.axis === 'x' ? { ...p, x: p.x + step } : { ...p, y: p.y + step };
          const inn = e.axis === 'x' ? { ...p, x: p.x - step } : { ...p, y: p.y - step };
          expect(parts.some((part) => pointInPolygon(out, part))).toBe(false);
          expect(parts.some((part) => pointInPolygon(inn, part))).toBe(true);
        }
      }
    }
  });

  it('has none for other shapes or angles', () => {
    expect(notchEdges(sofa, { x: 0, y: 0 }, 30)).toEqual([]);
    expect(notchEdges({ shape: 'rect', width: 2, depth: 2 }, { x: 0, y: 0 }, 0)).toEqual([]);
  });
});
