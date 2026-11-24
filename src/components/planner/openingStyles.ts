/**
 * The canvas's drawing of doors and windows on a rectangular room: inline styles for the wall
 * gap, jambs, panes and drag handles, and SVG path data for door leaves and swings, in canvas
 * pixels. The shapes come from `openingDoorGeometry` in core/geometry/doors.ts (the same shapes
 * the export draws).
 */
import type { CSSProperties } from 'react';
import { PIXELS_PER_UNIT as P } from '../../lib/constants';
import { isHorizontalWall, type Point } from '../../core/geometry';
import { openingDoorGeometry } from '../../core/geometry/doors';
import { openingPlace, roomSize } from '../../lib/plans';
import type { Opening, Room, RoomDims, Wall } from '../../types';

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

/** White wall gap where the opening is. */
const gapStyle = (wall: Wall, pos: number, widthPx: number, room: RoomDims): CSSProperties => {
  const base = { position: 'absolute', backgroundColor: 'white', zIndex: 10 } as const;
  switch (wall) {
    case 'bottom':
      return {
        ...base,
        left: pos * P,
        top: room.height * P - WALL_THICKNESS / 2,
        width: widthPx,
        height: WALL_THICKNESS,
      };
    case 'top':
      return {
        ...base,
        left: pos * P,
        top: -WALL_THICKNESS / 2,
        width: widthPx,
        height: WALL_THICKNESS,
      };
    case 'left':
      return {
        ...base,
        left: -WALL_THICKNESS / 2,
        top: pos * P,
        width: WALL_THICKNESS,
        height: widthPx,
      };
    case 'right':
      return {
        ...base,
        left: room.width * P - WALL_THICKNESS / 2,
        top: pos * P,
        width: WALL_THICKNESS,
        height: widthPx,
      };
  }
};

/** Architectural jamb lines at both ends of the opening. */
const jambStyles = (
  wall: Wall,
  pos: number,
  widthPx: number,
  room: RoomDims,
): [CSSProperties, CSSProperties] => {
  const base = { position: 'absolute', backgroundColor: JAMB_COLOR, zIndex: 11 } as const;
  if (isHorizontalWall(wall)) {
    const top = wall === 'top' ? -JAMB_LENGTH / 2 : room.height * P - JAMB_LENGTH / 2;
    const jamb = (x: number): CSSProperties => ({
      ...base,
      left: x - JAMB_WIDTH / 2,
      top,
      width: JAMB_WIDTH,
      height: JAMB_LENGTH,
    });
    return [jamb(pos * P), jamb(pos * P + widthPx)];
  }
  const left = wall === 'left' ? -JAMB_LENGTH / 2 : room.width * P - JAMB_LENGTH / 2;
  const jamb = (y: number): CSSProperties => ({
    ...base,
    left,
    top: y - JAMB_WIDTH / 2,
    width: JAMB_LENGTH,
    height: JAMB_WIDTH,
  });
  return [jamb(pos * P), jamb(pos * P + widthPx)];
};

/** Round drag handle centered on the opening. `inset` nudges window handles 2px into the room. */
const handleStyle = (
  wall: Wall,
  pos: number,
  widthPx: number,
  room: RoomDims,
  size: number,
  inset: number,
): CSSProperties => {
  const along = pos * P + widthPx / 2 - size / 2;
  const base = { position: 'absolute', width: size, height: size, zIndex: 20 } as const;
  switch (wall) {
    case 'bottom':
      return { ...base, left: along, top: room.height * P - size / 2, cursor: 'ew-resize' };
    case 'top':
      return { ...base, left: along, top: -size / 2 + inset, cursor: 'ew-resize' };
    case 'left':
      return { ...base, left: -size / 2 + inset, top: along, cursor: 'ns-resize' };
    case 'right':
      return { ...base, left: room.width * P - size / 2, top: along, cursor: 'ns-resize' };
  }
};

/** Canvas swing arc stroke (the export uses its own palette in core/render/scene/nodes.ts). */
export const SWING_ARC_STROKE = { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '4 3' };
const LEAF_THICKNESS = 4;

export const doorStyles = (door: Opening, plan: Pick<Room, 'outline'>): OpeningStyles => {
  const room = roomSize(plan);
  const { wall, position: pos, width } = openingPlace(plan, door);
  const widthPx = width * P;
  const [jamb1, jamb2] = jambStyles(wall, pos, widthPx, room);
  return {
    gap: gapStyle(wall, pos, widthPx, room),
    jamb1,
    jamb2,
    handle: handleStyle(wall, pos, widthPx, room, 20, 0),
  };
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

export const windowStyles = (win: Opening, plan: Pick<Room, 'outline'>): WindowStyles => {
  const room: RoomDims = roomSize(plan);
  const { wall, position: pos, width } = openingPlace(plan, win);
  const widthPx = width * P;
  const [jamb1, jamb2] = jambStyles(wall, pos, widthPx, room);
  const paneBase = {
    position: 'absolute',
    backgroundColor: '#93c5fd',
    border: '2px solid #3b82f6',
    borderRadius: 2,
    zIndex: 11,
  } as const;
  let pane: CSSProperties;
  switch (wall) {
    case 'top':
      pane = {
        ...paneBase,
        left: pos * P,
        top: -2,
        width: widthPx,
        height: 8,
        cursor: 'ew-resize',
      };
      break;
    case 'bottom':
      pane = {
        ...paneBase,
        left: pos * P,
        top: room.height * P - 6,
        width: widthPx,
        height: 8,
        cursor: 'ew-resize',
      };
      break;
    case 'left':
      pane = {
        ...paneBase,
        left: -2,
        top: pos * P,
        width: 8,
        height: widthPx,
        cursor: 'ns-resize',
      };
      break;
    case 'right':
      pane = {
        ...paneBase,
        left: room.width * P - 6,
        top: pos * P,
        width: 8,
        height: widthPx,
        cursor: 'ns-resize',
      };
      break;
  }
  return {
    gap: gapStyle(wall, pos, widthPx, room),
    jamb1,
    jamb2,
    pane,
    handle: handleStyle(wall, pos, widthPx, room, 16, 2),
  };
};
