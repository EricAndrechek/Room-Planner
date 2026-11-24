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

type Shape = Pick<Item, 'shape' | 'width' | 'depth' | 'cut'>;
type Cut = NonNullable<Item['cut']>;

/** Whether a piece is drawn and checked as an L (an L needs its cut). */
export const isL = (item: {
  shape?: Item['shape'];
  cut?: Item['cut'];
}): item is { shape: 'l'; cut: Cut } => item.shape === 'l' && !!item.cut;

/** Smallest cut, and smallest arm an L keeps beside its cut (feet): 1.2 in, the size fields' min. */
export const MIN_CUT = 0.1;

/**
 * The cut kept inside a `width` x `depth` box: at least MIN_CUT, and at least MIN_CUT smaller than
 * the box on each side (`checkIntegrity` wants it strictly smaller). Half the box for a box too
 * small for both.
 */
export function clampCut(cut: Cut, width: number, depth: number): Cut {
  const fit = (v: number, size: number) => {
    const m = Math.min(MIN_CUT, size / 2);
    return Math.min(Math.max(v, m), size - m);
  };
  const w = fit(cut.width, width);
  const d = fit(cut.depth, depth);
  return w === cut.width && d === cut.depth ? cut : { ...cut, width: w, depth: d };
}

/**
 * The cut a piece gets when it becomes an L: arms 3 ft deep (a sectional's seat), or half the box
 * when it is smaller, with the top-right corner removed so it reads as the letter L. A 9' x 7'
 * piece gets a 6' x 4' cut.
 */
export function defaultCut(width: number, depth: number): Cut {
  const arm = Math.min(3, width / 2, depth / 2);
  return clampCut({ corner: 'tr', width: width - arm, depth: depth - arm }, width, depth);
}

/**
 * An L's outline in its unrotated box (top-left corner at 0,0; `width` x `depth`), clockwise from
 * the first corner after the cut (the drawing on the canvas and in the export).
 */
export function lOutline(width: number, depth: number, cut: Cut): Point[] {
  const cw = cut.width;
  const cd = cut.depth;
  const r = width;
  const b = depth;
  const pts: [number, number][] = {
    tl: [
      [cw, 0],
      [r, 0],
      [r, b],
      [0, b],
      [0, cd],
      [cw, cd],
    ],
    tr: [
      [0, 0],
      [r - cw, 0],
      [r - cw, cd],
      [r, cd],
      [r, b],
      [0, b],
    ],
    br: [
      [0, 0],
      [r, 0],
      [r, b - cd],
      [r - cw, b - cd],
      [r - cw, b],
      [0, b],
    ],
    bl: [
      [0, 0],
      [r, 0],
      [r, b],
      [cw, b],
      [cw, b - cd],
      [0, b - cd],
    ],
  }[cut.corner] as [number, number][];
  return pts.map(([x, y]) => ({ x, y }));
}

/** A rectangle in a piece's unrotated box (top-left corner at 0,0). */
export interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a piece's name goes, in its unrotated box: the whole box for a rectangle, the rectangle
 * inscribed in an ellipse, and the larger of an L's two arms (each the full length of its side of
 * the box; the full-depth arm on a tie).
 */
export function labelArea(item: Shape): BoxRect {
  const { width: w, depth: h } = item;
  if (item.shape === 'ellipse') {
    const k = Math.SQRT1_2;
    return { x: (w * (1 - k)) / 2, y: (h * (1 - k)) / 2, width: w * k, height: h * k };
  }
  if (isL(item)) {
    const { corner, width: cw, depth: cd } = item.cut;
    const right = corner === 'tr' || corner === 'br';
    const bottom = corner === 'br' || corner === 'bl';
    const tall = { x: right ? 0 : cw, y: 0, width: w - cw, height: h };
    const wide = { x: 0, y: bottom ? 0 : cd, width: w, height: h - cd };
    return wide.width * wide.height > tall.width * tall.height ? wide : tall;
  }
  return { x: 0, y: 0, width: w, height: h };
}

/** Local rectangles (centre at 0,0, before rotation) that make up the shape. */
const localParts = (item: Shape): Point[][] => {
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

/**
 * The axis-aligned bounds of a piece turned by `rotation` degrees (clockwise), relative to its
 * centre: the true curve for an ellipse (not its 32-sided polygon), the six corners for an L.
 */
export function shapeExtents(
  item: Shape,
  rotation: number,
): { left: number; top: number; right: number; bottom: number } {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  if (item.shape === 'ellipse') {
    const a = item.width / 2;
    const b = item.depth / 2;
    const hw = Math.hypot(a * cos, b * sin);
    const hh = Math.hypot(a * sin, b * cos);
    return { left: -hw, top: -hh, right: hw, bottom: hh };
  }
  const local = isL(item)
    ? lOutline(item.width, item.depth, item.cut).map((p) => ({
        x: p.x - item.width / 2,
        y: p.y - item.depth / 2,
      }))
    : localParts(item)[0]!;
  return partsBounds([local.map(({ x, y }) => ({ x: x * cos - y * sin, y: x * sin + y * cos }))]);
}

/** A straight edge of a piece parallel to an axis, as snapping uses it. */
export interface AxisEdge {
  /** `x`: a vertical edge at x = pos; `y`: a horizontal one at y = pos. */
  axis: 'x' | 'y';
  pos: number;
  /** Which way the piece's outside is: `start` towards -x (or -y), `end` towards +x (or +y). */
  facing: 'start' | 'end';
  /** Extent along the other axis. */
  span: [number, number];
}

/**
 * The two inner edges of an L's notch, for a piece turned by a multiple of 90 degrees (other
 * angles have no axis-parallel edges): `centre` is the piece's centre. Empty for other shapes.
 */
export function notchEdges(item: Shape, centre: Point, rotation: number): AxisEdge[] {
  const quarters = Math.round(rotation / 90);
  if (!isL(item) || Math.abs(rotation - quarters * 90) > 1e-9) return [];
  // Exact quarter turns (no float noise in the edge positions).
  const c = Math.round(Math.cos((quarters * Math.PI) / 2));
  const s = Math.round(Math.sin((quarters * Math.PI) / 2));
  const { corner, width: cw, depth: cd } = item.cut;
  const sx = corner === 'tr' || corner === 'br' ? 1 : -1;
  const sy = corner === 'br' || corner === 'bl' ? 1 : -1;
  const w = item.width / 2;
  const h = item.depth / 2;
  // The notch's inner corner, and the far ends of its two edges (on the box's outline).
  const inner = { x: sx * (w - cw), y: sy * (h - cd) };
  const turn = (p: Point): Point => ({
    x: centre.x + p.x * c - p.y * s,
    y: centre.y + p.x * s + p.y * c,
  });
  const edge = (end: Point, normal: Point): AxisEdge => {
    const a = turn(inner);
    const b = turn(end);
    const n = { x: turn(normal).x - centre.x, y: turn(normal).y - centre.y };
    const vertical = Math.abs(a.x - b.x) < 1e-9;
    return vertical
      ? {
          axis: 'x',
          pos: a.x,
          facing: n.x > 0 ? 'end' : 'start',
          span: [Math.min(a.y, b.y), Math.max(a.y, b.y)],
        }
      : {
          axis: 'y',
          pos: a.y,
          facing: n.y > 0 ? 'end' : 'start',
          span: [Math.min(a.x, b.x), Math.max(a.x, b.x)],
        };
  };
  return [
    edge({ x: inner.x, y: sy * h }, { x: sx, y: 0 }),
    edge({ x: sx * w, y: inner.y }, { x: 0, y: sy }),
  ];
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
