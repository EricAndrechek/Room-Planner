/**
 * Snapping, alignment guides and clearance measurements for furniture.
 *
 * Everything works on a piece's axis-aligned bounding box (for a rotated piece, the box around its
 * rotated outline: an L's six corners, an ellipse's curve), in feet, in room coordinates (0,0 is
 * the inner corner of the top and left walls). An L turned by a multiple of 90 degrees also offers
 * the two inner edges of its notch, to snap and measure to. Pure functions: the drag/keyboard code
 * calls them with the visible items and draws the result.
 *
 * Cost: {@link buildSnapCandidates} is O(n) once per drag; {@link snapBounds} and
 * {@link measureClearances} are O(n) per pointer move, with no allocation beyond the result.
 */
import { normalizeDegrees, pointInPolygon, type Point } from './geometry';
import { distanceToWall } from './geometry/corners';
import { isL, itemParts, notchEdges, partsBounds, shapeExtents } from './geometry/shapes';
import type { Item } from './schema';
import type { Id, RoomDims } from './types';
import { feetToDisplay } from './units';

/** Snap distance in screen pixels: the same feel at every zoom. */
export const SNAP_THRESHOLD_PX = 8;
/** A fingertip is less precise than a mouse: a slightly wider capture on touch. */
export const SNAP_THRESHOLD_TOUCH_PX = 12;

/** Lines closer than this (feet) count as the same position. */
const SAME = 1e-6;

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * A piece's unrotated box: top-left corner, size, and rotation about its centre (degrees), with its
 * shape (a rectangle when left out).
 */
type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  shape?: Item['shape'];
  cut?: Item['cut'];
};

const shapeOf = (item: Box) => ({
  shape: item.shape ?? 'rect',
  width: item.width,
  depth: item.height,
  cut: item.cut,
});

/** A piece as snapping and the measurements see it (`itemBox` of a plan's item, with its id). */
export interface SnapPiece extends Box {
  id: Id;
  label: string;
  /** False for a hidden piece, which is left out. */
  visible?: boolean;
}

/** Axis-aligned bounds of a (possibly rotated) piece; exact for multiples of 90 degrees. */
export const itemBounds = (item: Box): Bounds => {
  const rot = (((item.rotation ?? 0) % 360) + 360) % 360;
  // Unrotated (or upside down): the stored edges, exactly (no round trip through the center).
  if (rot % 180 === 0) {
    return { left: item.x, top: item.y, right: item.x + item.width, bottom: item.y + item.height };
  }
  let halfW = item.height / 2;
  let halfH = item.width / 2;
  if (rot % 90 !== 0 && (item.shape === 'ellipse' || isL(item))) {
    const e = shapeExtents(shapeOf(item), rot);
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    return { left: cx + e.left, top: cy + e.top, right: cx + e.right, bottom: cy + e.bottom };
  }
  if (rot % 90 !== 0) {
    const rad = (rot * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    halfW = (item.width * cos + item.height * sin) / 2;
    halfH = (item.width * sin + item.height * cos) / 2;
  }
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  return { left: cx - halfW, top: cy - halfH, right: cx + halfW, bottom: cy + halfH };
};

/**
 * The axis-aligned rectangles a piece is measured against: its two parts for an L turned by a
 * multiple of 90 degrees (so a gap into its notch is measured to the notch), else its bounds.
 */
export const itemRects = (item: Box): Bounds[] => {
  if (!isL(item) || normalizeDegrees(item.rotation) % 90 !== 0) return [itemBounds(item)];
  return itemParts({
    ...shapeOf(item),
    placement: {
      x: item.x + item.width / 2,
      y: item.y + item.height / 2,
      rotation: item.rotation,
    },
  }).map((part) => partsBounds([part]));
};

/** Which feature of a box a line belongs to (left/top = start, right/bottom = end). */
export type Edge = 'start' | 'center' | 'end';

export type SnapSource =
  | { kind: 'wall'; wall: 'left' | 'right' | 'top' | 'bottom' }
  | { kind: 'room-center' }
  | { kind: 'item'; id: Id; label: string };

/** A position on one axis that a moving piece can snap to. */
export interface SnapLine {
  pos: number;
  edge: Edge;
  source: SnapSource;
  /** Extent of the source along the other axis (for drawing the guide). */
  span: [number, number];
}

export interface SnapCandidates {
  /** Vertical lines (x positions). */
  x: SnapLine[];
  /** Horizontal lines (y positions). */
  y: SnapLine[];
}

/** The four walls of a rectangular room from the origin, and its centre lines. */
const rectangleLines = (room: RoomDims): SnapCandidates => {
  const x: SnapLine[] = [
    { pos: 0, edge: 'start', source: { kind: 'wall', wall: 'left' }, span: [0, room.height] },
    {
      pos: room.width,
      edge: 'end',
      source: { kind: 'wall', wall: 'right' },
      span: [0, room.height],
    },
    {
      pos: room.width / 2,
      edge: 'center',
      source: { kind: 'room-center' },
      span: [0, room.height],
    },
  ];
  const y: SnapLine[] = [
    { pos: 0, edge: 'start', source: { kind: 'wall', wall: 'top' }, span: [0, room.width] },
    {
      pos: room.height,
      edge: 'end',
      source: { kind: 'wall', wall: 'bottom' },
      span: [0, room.width],
    },
    {
      pos: room.height / 2,
      edge: 'center',
      source: { kind: 'room-center' },
      span: [0, room.width],
    },
  ];
  return { x, y };
};

/**
 * Every line a moving piece can snap to: the inner faces of the four walls, the room's center
 * lines, and the edges and centers of every other *visible* piece. Built once when a drag starts
 * (the other pieces do not move meanwhile).
 */
export function buildSnapCandidates(
  items: readonly SnapPiece[],
  room: RoomDims,
  movingId: Id,
  /** A room that is not a rectangle: its own wall and centre lines (`roomSnapLines`). */
  roomLines?: SnapCandidates,
): SnapCandidates {
  const { x, y } = roomLines ? { x: [...roomLines.x], y: [...roomLines.y] } : rectangleLines(room);
  for (const item of items) {
    if (item.id === movingId || item.visible === false) continue;
    const b = itemBounds(item);
    const source: SnapSource = { kind: 'item', id: item.id, label: item.label };
    x.push(
      { pos: b.left, edge: 'start', source, span: [b.top, b.bottom] },
      { pos: (b.left + b.right) / 2, edge: 'center', source, span: [b.top, b.bottom] },
      { pos: b.right, edge: 'end', source, span: [b.top, b.bottom] },
    );
    y.push(
      { pos: b.top, edge: 'start', source, span: [b.left, b.right] },
      { pos: (b.top + b.bottom) / 2, edge: 'center', source, span: [b.left, b.right] },
      { pos: b.bottom, edge: 'end', source, span: [b.left, b.right] },
    );
    const centre = { x: item.x + item.width / 2, y: item.y + item.height / 2 };
    for (const e of notchEdges(shapeOf(item), centre, item.rotation)) {
      (e.axis === 'x' ? x : y).push({ pos: e.pos, edge: e.facing, source, span: e.span });
    }
  }
  return { x, y };
}

/**
 * Whether the moving piece's `edge` may snap to `line`: edges to edges (flush or aligned), centers
 * to centers; a wall only to the side that faces it (never pulling a piece through the wall).
 */
const compatible = (edge: Edge, line: SnapLine): boolean => {
  if (line.source.kind === 'wall') return edge === line.edge;
  if (edge === 'center' || line.edge === 'center') return edge === line.edge;
  return true;
};

/** Lower is preferred when two lines are equally close. */
const priority = (m: { edge: Edge; line: SnapLine }): number => {
  const s = m.line.source;
  if (s.kind === 'wall') return 0;
  if (s.kind === 'item' && m.edge !== 'center') return m.edge !== m.line.edge ? 1 : 2;
  if (s.kind === 'item') return 3;
  return 4; // room center
};

export interface SnapMatch {
  /** The moving piece's edge that snapped. */
  edge: Edge;
  line: SnapLine;
}

export interface AxisSnap {
  /** Correction (feet) added to the piece's position on this axis. */
  delta: number;
  /** Every line the piece lines up with after the correction, best first. */
  matches: SnapMatch[];
}

/**
 * The best snap on one axis: the line closest to any of the piece's `start`/`center`/`end` within
 * `threshold` (feet), and every other line that coincides with the piece once it has snapped.
 */
export function snapAxis(
  start: number,
  end: number,
  lines: readonly SnapLine[],
  threshold: number,
): AxisSnap | null {
  const features: [Edge, number][] = [
    ['start', start],
    ['center', (start + end) / 2],
    ['end', end],
  ];
  let best: { delta: number; prio: number } | null = null;
  for (const line of lines) {
    for (const [edge, pos] of features) {
      if (!compatible(edge, line)) continue;
      const delta = line.pos - pos;
      const dist = Math.abs(delta);
      if (dist > threshold) continue;
      const prio = priority({ edge, line });
      if (
        !best ||
        dist < Math.abs(best.delta) - SAME ||
        (Math.abs(dist - Math.abs(best.delta)) <= SAME && prio < best.prio)
      ) {
        best = { delta, prio };
      }
    }
  }
  if (!best) return null;
  const delta = best.delta;
  const matches: SnapMatch[] = [];
  for (const line of lines) {
    for (const [edge, pos] of features) {
      if (compatible(edge, line) && Math.abs(pos + delta - line.pos) <= SAME) {
        matches.push({ edge, line });
      }
    }
  }
  matches.sort((a, b) => priority(a) - priority(b));
  return { delta, matches };
}

export interface SnapResult {
  /** Snapped top-left of the piece (its stored `x`/`y`). */
  x: number;
  y: number;
  /** Bounds after snapping. */
  bounds: Bounds;
  snapX: AxisSnap | null;
  snapY: AxisSnap | null;
}

/** Drop float noise so a flush piece sits exactly on the line (12 - 3 is 9, not 8.999…). */
const clean = (v: number): number => Math.round(v * 1e9) / 1e9;

/**
 * Snap a piece (at `item.x`/`item.y`) on x and y independently. `threshold` is in feet (convert
 * from screen pixels with {@link thresholdFeet}). `axes` limits snapping to one axis (keyboard).
 */
export function snapItem(
  item: Box,
  candidates: SnapCandidates,
  threshold: number,
  axes: { x?: boolean; y?: boolean } = { x: true, y: true },
): SnapResult {
  const b = itemBounds(item);
  const snapX = axes.x ? snapAxis(b.left, b.right, candidates.x, threshold) : null;
  const snapY = axes.y ? snapAxis(b.top, b.bottom, candidates.y, threshold) : null;
  const dx = snapX?.delta ?? 0;
  const dy = snapY?.delta ?? 0;
  const x = snapX ? clean(item.x + dx) : item.x;
  const y = snapY ? clean(item.y + dy) : item.y;
  return {
    x,
    y,
    bounds: { left: b.left + dx, right: b.right + dx, top: b.top + dy, bottom: b.bottom + dy },
    snapX,
    snapY,
  };
}

/** Feet that `px` screen pixels cover at this zoom (`pixelsPerUnit` = CSS px per foot at 100%). */
export const thresholdFeet = (px: number, zoom: number, pixelsPerUnit: number): number =>
  px / (pixelsPerUnit * zoom);

/**
 * Keyboard nudge: the piece moves by (dx, dy) feet; if it then lies within `threshold` of a line on
 * the moved axis it snaps onto it, but never back to (or behind) where it started, so the next key
 * press always gets it moving again.
 */
export function snapNudge(
  item: Box,
  dx: number,
  dy: number,
  candidates: SnapCandidates,
  threshold: number,
): SnapResult {
  const moved = { ...item, x: item.x + dx, y: item.y + dy };
  const plain: SnapResult = {
    x: moved.x,
    y: moved.y,
    bounds: itemBounds(moved),
    snapX: null,
    snapY: null,
  };
  const r = snapItem(moved, candidates, threshold, { x: dx !== 0, y: dy !== 0 });
  const forward = (from: number, to: number, step: number) =>
    step === 0 || (to - from) * Math.sign(step) > SAME;
  if (!forward(item.x, r.x, dx) || !forward(item.y, r.y, dy)) return plain;
  return r;
}

// --- Guides -----------------------------------------------------------------------------------

export interface Guide {
  /** `x`: a vertical line at x = pos; `y`: a horizontal line at y = pos. */
  axis: 'x' | 'y';
  pos: number;
  from: number;
  to: number;
  /** Drawing style: walls highlighted, centers dashed, edges solid. */
  kind: 'wall' | 'center' | 'edge';
}

/**
 * Guide lines for the active snaps: one per snapped position on each axis, running along the
 * aligned pieces (from the moving piece across every piece it lines up with), or along the wall.
 */
export function snapGuides(result: Pick<SnapResult, 'bounds' | 'snapX' | 'snapY'>): Guide[] {
  const guides: Guide[] = [];
  const add = (axis: 'x' | 'y', snap: AxisSnap | null) => {
    if (!snap) return;
    const own: [number, number] =
      axis === 'x'
        ? [result.bounds.top, result.bounds.bottom]
        : [result.bounds.left, result.bounds.right];
    // Group coincident matches into one line per position.
    const byPos = new Map<number, Guide>();
    for (const { edge, line } of snap.matches) {
      const key = Math.round(line.pos * 1e6);
      const kind: Guide['kind'] =
        line.source.kind === 'wall' ? 'wall' : edge === 'center' ? 'center' : 'edge';
      const g = byPos.get(key);
      if (!g) {
        byPos.set(key, {
          axis,
          pos: line.pos,
          from: Math.min(own[0], line.span[0]),
          to: Math.max(own[1], line.span[1]),
          kind,
        });
      } else {
        g.from = Math.min(g.from, line.span[0]);
        g.to = Math.max(g.to, line.span[1]);
        if (kind === 'wall' || (kind === 'edge' && g.kind === 'center')) g.kind = kind;
      }
    }
    guides.push(...byPos.values());
  };
  add('x', result.snapX);
  add('y', result.snapY);
  return guides;
}

/** Spoken description of a snap ("Against left wall", "Aligned with Bed"), or ''. */
export function describeSnap(result: Pick<SnapResult, 'snapX' | 'snapY'>): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const snap of [result.snapX, result.snapY]) {
    const m = snap?.matches[0];
    if (!m) continue;
    const s = m.line.source;
    const text =
      s.kind === 'wall'
        ? `Against ${s.wall} wall`
        : s.kind === 'room-center'
          ? 'Centered in the room'
          : m.edge !== 'center' && m.edge !== m.line.edge
            ? `Against ${s.label}`
            : `Aligned with ${s.label}`;
    if (!seen.has(text)) {
      seen.add(text);
      parts.push(text);
    }
  }
  return parts.join(', ');
}

// --- Measurements -----------------------------------------------------------------------------

export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface Measurement {
  side: Side;
  /** Gap in feet (> 0). */
  distance: number;
  /** What the gap is measured to. */
  to: 'wall' | 'item';
  /** The measuring line, in room coordinates (feet). Horizontal for left/right, else vertical. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Below this (feet, ~1/16") a gap is flush: nothing to measure. */
const MIN_GAP = 0.005;

/**
 * Clear distance from the piece to the nearest wall or visible piece on each of its four sides.
 * A side is measured only if there is a clear straight line: the nearest piece whose bounds
 * overlap the piece's extent across that side and lie fully beyond it, else the wall (when the
 * piece is inside the room on that side). Hidden pieces are ignored.
 */
export function measureClearances(
  bounds: Bounds,
  items: readonly SnapPiece[],
  room: RoomDims,
  movingId: Id,
  /** A room that is not a rectangle: the wall on each side is found along the measuring line. */
  outline?: readonly Point[],
): Measurement[] {
  const nearest: Record<Side, { gap: number; lo: number; hi: number; item: boolean }> = {
    left: { gap: bounds.left, lo: bounds.top, hi: bounds.bottom, item: false },
    right: { gap: room.width - bounds.right, lo: bounds.top, hi: bounds.bottom, item: false },
    top: { gap: bounds.top, lo: bounds.left, hi: bounds.right, item: false },
    bottom: { gap: room.height - bounds.bottom, lo: bounds.left, hi: bounds.right, item: false },
  };
  if (outline) {
    const midY = (bounds.top + bounds.bottom) / 2;
    const midX = (bounds.left + bounds.right) / 2;
    const quarterX = bounds.left + (bounds.right - bounds.left) / 4;
    const rays: Record<Side, [Point, Point]> = {
      left: [
        { x: bounds.left, y: midY },
        { x: -1, y: 0 },
      ],
      right: [
        { x: bounds.right, y: midY },
        { x: 1, y: 0 },
      ],
      top: [
        { x: quarterX, y: bounds.top },
        { x: 0, y: -1 },
      ],
      bottom: [
        { x: midX, y: bounds.bottom },
        { x: 0, y: 1 },
      ],
    };
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const [from, dir] = rays[side];
      // Just inside the piece's edge: outside the room there is no wall to measure to.
      const probe = { x: from.x - dir.x * 1e-6, y: from.y - dir.y * 1e-6 };
      const d = pointInPolygon(probe, [...outline]) ? distanceToWall({ outline }, from, dir) : null;
      nearest[side].gap = d ?? -1;
    }
  }
  const consider = (side: Side, gap: number, lo: number, hi: number) => {
    if (gap < -SAME || gap >= nearest[side].gap) return;
    nearest[side] = { gap: Math.max(0, gap), lo, hi, item: true };
  };
  for (const other of items) {
    if (other.id === movingId || other.visible === false) continue;
    for (const o of itemRects(other)) {
      // Overlap across the side (strictly positive, so a corner-to-corner touch is no clear line).
      const vLo = Math.max(bounds.top, o.top);
      const vHi = Math.min(bounds.bottom, o.bottom);
      if (vHi - vLo > SAME) {
        consider('left', bounds.left - o.right, vLo, vHi);
        consider('right', o.left - bounds.right, vLo, vHi);
      }
      const hLo = Math.max(bounds.left, o.left);
      const hHi = Math.min(bounds.right, o.right);
      if (hHi - hLo > SAME) {
        consider('top', bounds.top - o.bottom, hLo, hHi);
        consider('bottom', o.top - bounds.bottom, hLo, hHi);
      }
    }
  }
  const out: Measurement[] = [];
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const n = nearest[side];
    if (!(n.gap > MIN_GAP)) continue; // flush, overlapping, or outside the room on that side
    // The top line runs a quarter of the way along instead of through the middle, where the
    // selected piece's rotate handle sits.
    const mid = side === 'top' ? n.lo + (n.hi - n.lo) / 4 : (n.lo + n.hi) / 2;
    const to = n.item ? 'item' : 'wall';
    if (side === 'left')
      out.push({
        side,
        distance: n.gap,
        to,
        x1: bounds.left - n.gap,
        y1: mid,
        x2: bounds.left,
        y2: mid,
      });
    else if (side === 'right')
      out.push({
        side,
        distance: n.gap,
        to,
        x1: bounds.right,
        y1: mid,
        x2: bounds.right + n.gap,
        y2: mid,
      });
    else if (side === 'top')
      out.push({
        side,
        distance: n.gap,
        to,
        x1: mid,
        y1: bounds.top - n.gap,
        x2: mid,
        y2: bounds.top,
      });
    else
      out.push({
        side,
        distance: n.gap,
        to,
        x1: mid,
        y1: bounds.bottom,
        x2: mid,
        y2: bounds.bottom + n.gap,
      });
  }
  return out;
}

export interface MeasurementLabel extends Measurement {
  text: string;
}

/** Approximate rendered size (screen px) of a measurement label at 11px. */
export const labelSize = (text: string) => ({ w: text.length * 6.5 + 12, h: 18 });

/**
 * Which measurements to label at this zoom: each needs room on screen for its label along its
 * line, and where two labels would overlap the smaller distance is dropped.
 */
export function fitMeasurementLabels(
  measurements: readonly Measurement[],
  zoom: number,
  pixelsPerUnit: number,
  unitSystem: Parameters<typeof feetToDisplay>[1],
): MeasurementLabel[] {
  const scale = pixelsPerUnit * zoom;
  const labeled = measurements
    .map((m) => ({ ...m, text: feetToDisplay(m.distance, unitSystem) }))
    .filter((m) => {
      const { w, h } = labelSize(m.text);
      const need = m.side === 'left' || m.side === 'right' ? w + 6 : h + 6;
      return m.distance * scale >= need;
    })
    .sort((a, b) => b.distance - a.distance);
  const kept: MeasurementLabel[] = [];
  const box = (m: MeasurementLabel) => {
    const { w, h } = labelSize(m.text);
    const cx = ((m.x1 + m.x2) / 2) * scale;
    const cy = ((m.y1 + m.y2) / 2) * scale;
    return { l: cx - w / 2, r: cx + w / 2, t: cy - h / 2, b: cy + h / 2 };
  };
  for (const m of labeled) {
    const a = box(m);
    const hit = kept.some((k) => {
      const b = box(k);
      return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    });
    if (!hit) kept.push(m);
  }
  return kept;
}
