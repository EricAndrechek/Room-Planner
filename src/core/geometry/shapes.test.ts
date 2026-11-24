import { describe, expect, it } from 'vitest';
import { getRotatedCorners } from './index';
import { ELLIPSE_SIDES, itemBox, itemParts, partsBounds } from './shapes';

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
