import { describe, expect, it } from 'vitest';
import { labelSpot } from './labels';
import { lOutline } from './walls';

const rect = (w: number, h: number) => ({
  outline: [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ],
});

describe('room label placement (canvas and export)', () => {
  const half = { w: 2, h: 0.5 };
  it('takes the middle when it is free', () => {
    expect(labelSpot(rect(12, 10), [], half)).toEqual({ x: 6, y: 5, width: 12, clear: true });
  });

  it('moves to the free spot nearest the middle, the whole label inside the walls', () => {
    const bed = { left: 3, top: 2, right: 9, bottom: 8 };
    const s = labelSpot(rect(12, 10), [bed], half);
    expect(s.clear).toBe(true);
    const clearOfBed =
      s.x + half.w <= bed.left ||
      s.x - half.w >= bed.right ||
      s.y + half.h <= bed.top ||
      s.y - half.h >= bed.bottom;
    expect(clearOfBed).toBe(true);
    expect(s.x - half.w).toBeGreaterThanOrEqual(0);
    expect(s.x + half.w).toBeLessThanOrEqual(12);
    expect(s.y - half.h).toBeGreaterThanOrEqual(0);
    expect(s.y + half.h).toBeLessThanOrEqual(10);
  });

  it('says when nothing is clear, so the label can go over the furniture', () => {
    const rug = { left: -1, top: -1, right: 13, bottom: 11 };
    const s = labelSpot(rect(12, 10), [rug], half);
    expect(s).toMatchObject({ x: 6, y: 5, clear: false });
  });

  it('stays inside an L-shaped room whose middle is outside it', () => {
    const l = {
      outline: lOutline({ width: 10, height: 10, corner: 'br', cutWidth: 6, cutHeight: 6 }),
    };
    const s = labelSpot(l, [{ left: 0, top: 0, right: 1, bottom: 1 }], { w: 1, h: 0.4 });
    expect(s.clear).toBe(true);
    // Inside the L: in its top band or its left band.
    expect(s.y <= 4 || s.x <= 4).toBe(true);
  });
});
