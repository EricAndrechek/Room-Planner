/**
 * Furniture outlines (docs/design/plan-format.md, section 3, "Geometry"): every shape as convex
 * parts in floor coordinates, so overlaps are the same separating-axis test whatever the shape.
 * A rectangle is one part, an L two rectangles, an ellipse one 32-sided polygon (at most 0.5%
 * inside the true curve; the drawing uses the true ellipse).
 */
import type { Item } from '../schema';
import type { Point } from './index';

export const ELLIPSE_SIDES = 32;

/**
 * The piece's unrotated box as the v3 app stored it (top-left corner, width, height, rotation
 * about the centre), or null for a piece in the inventory. Snapping works on this box.
 */
export function itemBox(
  item: Pick<Item, 'width' | 'depth' | 'placement'>,
): { x: number; y: number; width: number; height: number; rotation: number } | null {
  const p = item.placement;
  if (!p) return null;
  return {
    x: p.x - item.width / 2,
    y: p.y - item.depth / 2,
    width: item.width,
    height: item.depth,
    rotation: p.rotation,
  };
}

/** Local rectangles (centre at 0,0, before rotation) that make up the shape. */
const localParts = (item: Pick<Item, 'shape' | 'width' | 'depth' | 'cut'>): Point[][] => {
  const w = item.width / 2;
  const h = item.depth / 2;
  const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  if (item.shape === 'ellipse') {
    return [
      Array.from({ length: ELLIPSE_SIDES }, (_, k) => {
        const a = (2 * Math.PI * k) / ELLIPSE_SIDES;
        return { x: w * Math.cos(a), y: h * Math.sin(a) };
      }),
    ];
  }
  if (item.shape === 'l' && item.cut) {
    const { corner, width: cw, depth: cd } = item.cut;
    const right = corner === 'tr' || corner === 'br';
    const bottom = corner === 'br' || corner === 'bl';
    // The full-depth strip beside the cut, and the strip below (or above) the cut.
    const full = right ? rect(-w, -h, w - cw, h) : rect(-w + cw, -h, w, h);
    const under = bottom
      ? rect(right ? w - cw : -w, -h, right ? w : -w + cw, h - cd)
      : rect(right ? w - cw : -w, -h + cd, right ? w : -w + cw, h);
    return [full, under];
  }
  return [rect(-w, -h, w, h)];
};

/**
 * The piece's outline as convex polygons in floor coordinates, rotated clockwise about its centre
 * (as the canvas and the export draw it). Empty for a piece in the inventory.
 */
export function itemParts(
  item: Pick<Item, 'shape' | 'width' | 'depth' | 'cut' | 'placement'>,
): Point[][] {
  const p = item.placement;
  if (!p) return [];
  const rad = (p.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return localParts(item).map((part) =>
    part.map(({ x: dx, y: dy }) => ({
      x: p.x + dx * cos - dy * sin,
      y: p.y + dx * sin + dy * cos,
    })),
  );
}

/** Axis-aligned bounds of a piece's parts. */
export function partsBounds(parts: Point[][]) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const part of parts) {
    for (const q of part) {
      if (q.x < left) left = q.x;
      if (q.x > right) right = q.x;
      if (q.y < top) top = q.y;
      if (q.y > bottom) bottom = q.y;
    }
  }
  return { left, top, right, bottom };
}
