/**
 * Where a room's name goes: the same rule for the canvas and the export, so the two agree. The
 * middle of the room when the label fits there clear of the furniture; else the free spot nearest
 * the middle where the whole label is inside the walls and clear of every piece; else (no such
 * spot) the middle, or for a room whose middle is outside it the point farthest from its walls,
 * marked not clear, so the caller can draw it over the furniture.
 */
import { pointInPolygon, type Point } from './index';
import { roomBounds } from './walls';
import type { Room } from '../schema';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The label's spot (its middle), the room's width at that height, and whether it is clear. */
export interface LabelSpot {
  x: number;
  y: number;
  width: number;
  clear: boolean;
}

export const labelSpot = (
  room: Pick<Room, 'outline'>,
  /** Boxes the label should keep clear of (the furniture). */
  avoid: readonly Box[] = [],
  /** Half the label's width and height, in floor units. */
  half: { w: number; h: number } = { w: 0, h: 0 },
): LabelSpot => {
  const poly = room.outline;
  const b = roomBounds(room);
  const centre = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  const edgeDist = (p: Point) => {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const c = poly[(i + 1) % poly.length]!;
      const ex = c.x - a.x;
      const ey = c.y - a.y;
      const l2 = ex * ex + ey * ey || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2));
      best = Math.min(best, Math.hypot(p.x - (a.x + t * ex), p.y - (a.y + t * ey)));
    }
    return best;
  };
  const free = (p: Point) =>
    !avoid.some(
      (a) =>
        p.x - half.w < a.right &&
        p.x + half.w > a.left &&
        p.y - half.h < a.bottom &&
        p.y + half.h > a.top,
    );
  // The whole label inside the walls: its corners in the room, and its middle not near a wall.
  const fits = (p: Point) =>
    pointInPolygon(p, poly) &&
    edgeDist(p) >= half.h &&
    [
      { x: p.x - half.w, y: p.y - half.h },
      { x: p.x + half.w, y: p.y - half.h },
      { x: p.x + half.w, y: p.y + half.h },
      { x: p.x - half.w, y: p.y + half.h },
    ].every((q) => pointInPolygon(q, poly));
  let at = centre;
  let clear = pointInPolygon(centre, poly) && free(centre) && (avoid.length === 0 || fits(centre));
  if (!clear && avoid.length) {
    // The free spot nearest the middle, with room for the label inside the walls.
    const N = 24;
    let best = Infinity;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const p = {
          x: b.left + ((i + 0.5) / N) * (b.right - b.left),
          y: b.top + ((j + 0.5) / N) * (b.bottom - b.top),
        };
        if (!free(p) || !fits(p)) continue;
        const d = Math.hypot(p.x - centre.x, p.y - centre.y);
        if (d < best) {
          best = d;
          at = p;
          clear = true;
        }
      }
    }
  }
  if (!clear && !pointInPolygon(centre, poly)) {
    const N = 24;
    let best = -1;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const p = {
          x: b.left + ((i + 0.5) / N) * (b.right - b.left),
          y: b.top + ((j + 0.5) / N) * (b.bottom - b.top),
        };
        if (!pointInPolygon(p, poly)) continue;
        const d = edgeDist(p);
        if (d > best) {
          best = d;
          at = p;
        }
      }
    }
  }
  // The room's width at that height: the stretch of the horizontal line through it that holds it.
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const c = poly[(i + 1) % poly.length]!;
    if (a.y > at.y !== c.y > at.y) xs.push(a.x + ((at.y - a.y) / (c.y - a.y)) * (c.x - a.x));
  }
  xs.sort((m, n) => m - n);
  let width = b.right - b.left;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (at.x >= xs[i]! && at.x <= xs[i + 1]!) width = xs[i + 1]! - xs[i]!;
  }
  return { x: at.x, y: at.y, width, clear: clear || avoid.length === 0 };
};
