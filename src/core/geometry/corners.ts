/**
 * Editing a room's corners (docs/design/plan-format.md, section 9): where a dragged corner snaps
 * (walls at 90 and 45 degrees to their neighbours, the lines of the other corners, whole steps),
 * the lines furniture snaps to in a room that is not a rectangle, and how far a wall is along a
 * straight line (the measurements).
 */
import type { SnapCandidates, SnapLine } from '../snapping';
import type { Point } from './index';
import { roomBounds, wallFrame } from './walls';

type Outline = { outline: readonly Point[] };

/** A guide drawn while a corner snaps: a line from the corner it lines up with to the new spot. */
export interface CornerGuide {
  from: Point;
  to: Point;
  /** `align`: the same x or y as another corner; `square`/`diagonal`: a wall at 90 or 45 degrees. */
  kind: 'align' | 'square' | 'diagonal';
}

export interface CornerSnap {
  point: Point;
  guides: CornerGuide[];
}

export interface CornerSnapOptions {
  /** Capture distance (feet) for lining up. */
  threshold: number;
  /** Positions that line up with nothing are rounded to this step (feet); 0 for none. */
  step?: number;
}

const clean = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
const roundTo = (v: number, step: number) => (step > 0 ? clean(Math.round(v / step) * step) : v);

/**
 * Where corner `i` goes when dragged to `raw`. Each axis lines up, within `threshold`, with a
 * neighbouring corner (a wall at 90 degrees) or any other corner (the line of another wall). A
 * free axis then tries a 45-degree wall to a neighbour, and is otherwise rounded to `step`.
 */
export function snapCorner(
  room: Outline,
  i: number,
  raw: Point,
  { threshold, step = 0 }: CornerSnapOptions,
): CornerSnap {
  const o = room.outline;
  const n = o.length;
  const prev = o[(i - 1 + n) % n]!;
  const next = o[(i + 1) % n]!;
  const others = o.filter((_, k) => k !== i);
  const guides: CornerGuide[] = [];

  /** The nearest line on one axis: the neighbours first (they make a square wall). */
  const axis = (key: 'x' | 'y') => {
    let best: { value: number; from: Point; d: number; square: boolean } | null = null;
    for (const p of [prev, next, ...others]) {
      const d = Math.abs(p[key] - raw[key]);
      if (d > threshold) continue;
      const square = p === prev || p === next;
      if (!best || d < best.d - 1e-9) best = { value: p[key], from: p, d, square };
    }
    return best;
  };
  const sx = axis('x');
  const sy = axis('y');
  let x = sx ? sx.value : raw.x;
  let y = sy ? sy.value : raw.y;

  // 45 degrees to a neighbour, on an axis that did not line up.
  if (!sx || !sy) {
    let best: { p: Point; from: Point; d: number } | null = null;
    for (const from of [prev, next]) {
      for (const sign of [1, -1]) {
        let p: Point;
        if (sx) p = { x, y: from.y + sign * (x - from.x) };
        else if (sy) p = { x: from.x + sign * (y - from.y), y };
        else {
          // Project the raw point onto the diagonal through `from`, in whole steps along it.
          const t = roundTo((raw.x - from.x + sign * (raw.y - from.y)) / 2, step);
          p = { x: from.x + t, y: from.y + sign * t };
        }
        const d = Math.hypot(p.x - raw.x, p.y - raw.y);
        if (d <= threshold && Math.hypot(p.x - from.x, p.y - from.y) > 1e-6) {
          if (!best || d < best.d) best = { p, from, d };
        }
      }
    }
    if (best) {
      x = clean(best.p.x);
      y = clean(best.p.y);
      guides.push({ from: best.from, to: { x, y }, kind: 'diagonal' });
      return { point: { x, y }, guides: withAxisGuides() };
    }
  }
  if (!sx) x = roundTo(x, step);
  if (!sy) y = roundTo(y, step);
  return { point: { x, y }, guides: withAxisGuides() };

  function withAxisGuides() {
    const at = { x, y };
    if (sx) guides.push({ from: sx.from, to: at, kind: sx.square ? 'square' : 'align' });
    if (sy) guides.push({ from: sy.from, to: at, kind: sy.square ? 'square' : 'align' });
    return guides;
  }
}

/**
 * The lines furniture snaps to in a room: the inner face of every horizontal or vertical wall
 * (snapping only the side of a piece that faces it, as the four walls of a rectangle do), and the
 * centre lines of the room's bounding box. Angled walls take no part (section 3).
 */
export function roomSnapLines(room: Outline): SnapCandidates {
  const b = roomBounds({ outline: [...room.outline] });
  const x: SnapLine[] = [];
  const y: SnapLine[] = [];
  const n = room.outline.length;
  for (let i = 0; i < n; i++) {
    const f = wallFrame({ outline: [...room.outline] }, i);
    const a = room.outline[i]!;
    const c = room.outline[(i + 1) % n]!;
    if (a.x === c.x) {
      // A vertical wall: the room is to its right (inward +x) or its left.
      const start = f.inward.x > 0;
      x.push({
        pos: a.x,
        edge: start ? 'start' : 'end',
        source: { kind: 'wall', wall: start ? 'left' : 'right' },
        span: [Math.min(a.y, c.y), Math.max(a.y, c.y)],
      });
    } else if (a.y === c.y) {
      const start = f.inward.y > 0;
      y.push({
        pos: a.y,
        edge: start ? 'start' : 'end',
        source: { kind: 'wall', wall: start ? 'top' : 'bottom' },
        span: [Math.min(a.x, c.x), Math.max(a.x, c.x)],
      });
    }
  }
  x.push({
    pos: (b.left + b.right) / 2,
    edge: 'center',
    source: { kind: 'room-center' },
    span: [b.top, b.bottom],
  });
  y.push({
    pos: (b.top + b.bottom) / 2,
    edge: 'center',
    source: { kind: 'room-center' },
    span: [b.left, b.right],
  });
  return { x, y };
}

/**
 * How far from `from` the first wall is in direction `dir` (a unit vector along an axis), or null
 * if the ray meets no wall. A point outside the room meets its outline too: callers check.
 */
export function distanceToWall(room: Outline, from: Point, dir: Point): number | null {
  const o = room.outline;
  let best: number | null = null;
  for (let i = 0; i < o.length; i++) {
    const a = o[i]!;
    const b = o[(i + 1) % o.length]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - from.x) * ey - (a.y - from.y) * ex) / den;
    const u = ((a.x - from.x) * dir.y - (a.y - from.y) * dir.x) / den;
    if (t >= -1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && (best === null || t < best)) best = t;
  }
  return best === null ? null : Math.max(0, best);
}
