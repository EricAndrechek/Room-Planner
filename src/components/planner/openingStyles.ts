/**
 * The canvas's drawing of doors and windows on any wall: inline styles for the wall gap, jambs,
 * panes and drag handles, and SVG path data for door leaves and swings, in canvas pixels (floor
 * coordinates times PIXELS_PER_UNIT). Everything is laid out in the wall's drawing frame
 * (core/geometry/walls.ts): along the wall from its left (or top) end, and into the room from its
 * inner face; on a horizontal or vertical wall that is exactly the v3 drawing. The door shapes
 * come from `openingDoorGeometry` in core/geometry/doors.ts (the same shapes the export draws).
 */
import type { CSSProperties } from 'react';
import { PIXELS_PER_UNIT as P } from '../../lib/constants';
import type { Point } from '../../core/geometry';
import { openingDoorGeometry } from '../../core/geometry/doors';
import { frameAt, openingInFrame, type WallFrame } from '../../core/geometry/walls';
import type { Opening, Room } from '../../types';

const WALL_THICKNESS = 4;
const JAMB_LENGTH = 12;
const JAMB_WIDTH = 2;
const JAMB_COLOR = '#334155';

export interface OpeningStyles {
  gap: CSSProperties;
  jamb1: CSSProperties;
  jamb2: CSSProperties;
  handle: CSSProperties;
}

export interface WindowStyles extends OpeningStyles {
  pane: CSSProperties;
}

const num = (n: number) => +n.toFixed(3);

/**
 * A box in a wall's frame: `a0` to `a1` along the wall (feet), `d0` to `d1` into the room (canvas
 * px, negative = into the wall). On a wall at an angle the box is turned with it.
 */
const frameBox = (f: WallFrame, a0: number, a1: number, d0: number, d1: number): CSSProperties => {
  const angle = (Math.atan2(f.along.y, f.along.x) * 180) / Math.PI;
  // The box's own y axis (the along vector turned 90 degrees clockwise) is either the inward
  // normal or its opposite (a wall drawn against the outline): start from the matching side.
  const flipped = -f.along.y * f.inward.x + f.along.x * f.inward.y < 0;
  const o = frameAt(f, a0, (flipped ? d1 : d0) / P);
  const deg = num(((angle % 360) + 360) % 360);
  return {
    position: 'absolute',
    left: num(o.x * P),
    top: num(o.y * P),
    width: num((a1 - a0) * P),
    height: num(d1 - d0),
    ...(deg !== 0 && deg !== 360 ? { transform: `rotate(${deg}deg)`, transformOrigin: '0 0' } : {}),
  };
};

/** The resize cursor for dragging along a wall at this angle. */
const cursorFor = (f: WallFrame) => {
  const deg = ((((Math.atan2(f.along.y, f.along.x) * 180) / Math.PI) % 180) + 180) % 180;
  if (deg < 22.5 || deg >= 157.5) return 'ew-resize';
  if (deg < 67.5) return 'nwse-resize';
  if (deg < 112.5) return 'ns-resize';
  return 'nesw-resize';
};

/** White wall gap, the jambs at both ends, and the round drag handle in the middle. */
const parts = (f: WallFrame, pos: number, width: number, handleSize: number, inset: number) => {
  const base = { backgroundColor: 'white', zIndex: 10 } as const;
  const jamb = (a: number): CSSProperties => ({
    ...frameBox(
      f,
      a - JAMB_WIDTH / 2 / P,
      a + JAMB_WIDTH / 2 / P,
      -JAMB_LENGTH / 2,
      JAMB_LENGTH / 2,
    ),
    backgroundColor: JAMB_COLOR,
    zIndex: 11,
  });
  const c = frameAt(f, pos + width / 2, inset / P);
  return {
    gap: { ...frameBox(f, pos, pos + width, -WALL_THICKNESS / 2, WALL_THICKNESS / 2), ...base },
    jamb1: jamb(pos),
    jamb2: jamb(pos + width),
    handle: {
      position: 'absolute',
      left: num(c.x * P - handleSize / 2),
      top: num(c.y * P - handleSize / 2),
      width: handleSize,
      height: handleSize,
      zIndex: 20,
      cursor: cursorFor(f),
    } as CSSProperties,
  };
};

/** Canvas swing arc stroke (the export uses its own palette in core/render/scene/nodes.ts). */
export const SWING_ARC_STROKE = { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '4 3' };
const LEAF_THICKNESS = 4;

export const doorStyles = (door: Opening, room: Pick<Room, 'outline'>): OpeningStyles => {
  const { frame, position, width } = openingInFrame(room, door);
  return parts(frame, position, width, 20, 0);
};

/** SVG path data for the canvas door drawing, in canvas pixels (room interior top-left = 0,0). */
export interface DoorSvg {
  /** Dashed swing arcs (one per leaf). */
  arcs: string[];
  /** Filled shapes: open leaves, bi-fold panels, sliding panels. */
  panels: string[];
  /** Dashed pocket cavity inside the wall (pocket doors). */
  pocket: string | null;
  /** The door's clearance areas and doorway, for highlighting when a piece blocks them. */
  clearance: string[];
  doorway: string;
}

const px = (p: Point) => `${+(p.x * P).toFixed(2)} ${+(p.y * P).toFixed(2)}`;
const polyPath = (pts: Point[]) => `M ${pts.map(px).join(' L ')} Z`;

/** A thin rectangle from `a` to `b`, `thickPx` wide on the `towards` side (a unit vector). */
const barPath = (a: Point, b: Point, towards: Point, thickPx: number) => {
  const t = thickPx / P;
  const o = { x: towards.x * t, y: towards.y * t };
  return polyPath([a, b, { x: b.x + o.x, y: b.y + o.y }, { x: a.x + o.x, y: a.y + o.y }]);
};

/** The canvas drawing of a door, from `doorGeometry` (the same shapes the export draws). */
export const doorSvg = (door: Opening, room: Pick<Room, 'outline'>): DoorSvg => {
  const g = openingDoorGeometry(room, door);
  const arcs = g.leaves.map((l) => {
    const r = +(l.radius * P).toFixed(2);
    return `M ${px(l.closedEnd)} A ${r} ${r} 0 0 ${l.sweep} ${px(l.openEnd)}`;
  });
  const panels: string[] = [];
  for (const l of g.leaves) {
    // The open leaf, thickened towards the strike side (90deg) or into the swing side (180deg).
    panels.push(barPath(l.hinge, l.openEnd, l.angle === 90 ? l.u : l.v, LEAF_THICKNESS));
  }
  if (g.bifold) {
    const { hinge, fold, end } = g.bifold;
    const thin = (a: Point, b: Point) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      return barPath(a, b, { x: -dy / d, y: dx / d }, 3);
    };
    panels.push(thin(hinge, fold), thin(fold, end));
  }
  for (const poly of g.slidingPanels) panels.push(polyPath(poly));
  return {
    arcs,
    panels,
    pocket: g.pocket
      ? (() => {
          // In the middle of the canvas's 4px wall, so it reads as a cavity inside the wall.
          const { inward } = g.frame;
          const k = -WALL_THICKNESS / 2 / P;
          const shift = (p: Point) => ({ x: p.x + inward.x * k, y: p.y + inward.y * k });
          return `M ${px(shift(g.pocket.from))} L ${px(shift(g.pocket.to))}`;
        })()
      : null,
    clearance: g.clearance.map(polyPath),
    doorway: polyPath(g.doorway),
  };
};

export const windowStyles = (win: Opening, room: Pick<Room, 'outline'>): WindowStyles => {
  const { frame, position, width } = openingInFrame(room, win);
  return {
    ...parts(frame, position, width, 16, 2),
    pane: {
      ...frameBox(frame, position, position + width, -2, 6),
      backgroundColor: '#93c5fd',
      border: '2px solid #3b82f6',
      borderRadius: 2,
      zIndex: 11,
      cursor: cursorFor(frame),
    },
  };
};
