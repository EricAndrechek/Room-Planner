/**
 * Door and window geometry. `doorSwingGeometry` is the single source of truth
 * for where a swing door's leaf and arc go; the canvas (below) and the export
 * (export/scene.ts) both draw from it. The rest are pure functions returning
 * the canvas's inline styles, so the components only render.
 */
import type { CSSProperties } from 'react';
import type { Door, RoomDims, RoomWindow, Wall } from '../types';
import { PIXELS_PER_UNIT as P } from './constants';
import { isHorizontalWall, wallLength, type Point } from './geometry';
import { clamp } from './units';

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

export interface DoorStyles extends OpeningStyles {
  sliding: boolean;
  /** Box of the swing arc's <svg>; `arcPath` is drawn in its local pixel coordinates. */
  arc: CSSProperties;
  arcPath: string;
  panel: CSSProperties;
  track: CSSProperties;
}

export interface WindowStyles extends OpeningStyles {
  pane: CSSProperties;
}

/** Position along the wall, kept on the wall even if the room shrank since. */
export const onWall = (o: { position: number; width: number }, room: RoomDims, wall: Wall) =>
  clamp(o.position, 0, Math.max(0, wallLength(room, wall) - o.width));

// --- Door swing geometry (shared by the canvas and the export) -----------------

/**
 * A wall's frame in room feet: `origin` is the wall's start (left end of
 * top/bottom, top end of left/right, where `position` is measured from),
 * `along` runs along the wall, `inward` points from the wall into the room.
 */
const WALL_FRAMES: Record<
  Wall,
  (room: RoomDims) => { origin: Point; along: Point; inward: Point }
> = {
  top: () => ({ origin: { x: 0, y: 0 }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 } }),
  bottom: (r) => ({
    origin: { x: 0, y: r.height },
    along: { x: 1, y: 0 },
    inward: { x: 0, y: -1 },
  }),
  left: () => ({ origin: { x: 0, y: 0 }, along: { x: 0, y: 1 }, inward: { x: 1, y: 0 } }),
  right: (r) => ({ origin: { x: r.width, y: 0 }, along: { x: 0, y: 1 }, inward: { x: -1, y: 0 } }),
};

export interface DoorSwing {
  wall: Wall;
  /** Swing-in doors open into the room, swing-out doors away from it. */
  side: 'inside' | 'outside';
  /** Leaf length = arc radius: the door width (capped to the wall). */
  radius: number;
  /** Pivot of the leaf: the `hinge` end of the opening (left = wall start, right = wall end). */
  hinge: Point;
  /** Where the closed leaf ends: the strike end of the opening. The arc starts here. */
  closedEnd: Point;
  /** Tip of the leaf opened 90 degrees, perpendicular to the wall. The arc ends here. */
  openEnd: Point;
  /**
   * SVG `sweep-flag` for the arc from `closedEnd` to `openEnd` around `hinge`
   * (1 = clockwise on screen, y down).
   */
  sweep: 0 | 1;
  /** Unit vector from the wall towards the side the door swings to. */
  normal: Point;
  /** Axis-aligned square the leaf sweeps through (for clearance checks and bounds). */
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Geometry of a swing door's leaf and arc, in room feet (interior top-left is
 * 0,0). `faceOffset` is the wall thickness in feet: swing-out doors hinge on
 * the exterior face, `faceOffset` outside the interior one (the canvas draws
 * walls as a line and passes 0). Sliding doors have no swing: `null`.
 */
export function doorSwingGeometry(door: Door, room: RoomDims, faceOffset = 0): DoorSwing | null {
  const type = door.type || 'swing-in';
  if (type === 'sliding') return null;
  const wall = door.wall || 'bottom';
  const radius = Math.min(door.width, wallLength(room, wall));
  const position = onWall({ position: door.position, width: radius }, room, wall);
  const inside = type !== 'swing-out';
  const face = inside ? 0 : -faceOffset; // distance from the interior face, into the room
  const out = inside ? 1 : -1; // towards the swing side
  const hingeRight = door.hinge === 'right';
  const hingeAt = hingeRight ? position + radius : position;
  const toStrike = hingeRight ? -1 : 1;

  const { origin, along, inward } = WALL_FRAMES[wall](room);
  // `+ 0` turns -0 into 0 so results compare cleanly.
  const at = (a: number, d: number): Point => ({
    x: origin.x + along.x * a + inward.x * d + 0,
    y: origin.y + along.y * a + inward.y * d + 0,
  });
  const hinge = at(hingeAt, face);
  const closedEnd = at(hingeAt + toStrike * radius, face);
  const openEnd = at(hingeAt, face + out * radius);
  const cross =
    (closedEnd.x - hinge.x) * (openEnd.y - hinge.y) -
    (closedEnd.y - hinge.y) * (openEnd.x - hinge.x);
  const xs = [hinge.x, closedEnd.x, openEnd.x];
  const ys = [hinge.y, closedEnd.y, openEnd.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    wall,
    side: inside ? 'inside' : 'outside',
    radius,
    hinge,
    closedEnd,
    openEnd,
    sweep: cross > 0 ? 1 : 0,
    normal: { x: inward.x * out + 0, y: inward.y * out + 0 },
    box: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
  };
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

/** Canvas swing arc stroke (the export uses its own palette in export/scene.ts). */
export const SWING_ARC_STROKE = { stroke: '#94a3b8', strokeWidth: 2, strokeDasharray: '4 3' };
const LEAF_THICKNESS = 4;

export const doorStyles = (door: Door, room: RoomDims): DoorStyles => {
  const wall = door.wall || 'bottom';
  const pos = onWall(door, room, wall);
  const widthPx = door.width * P;
  const sliding = (door.type || 'swing-in') === 'sliding';
  const [jamb1, jamb2] = jambStyles(wall, pos, widthPx, room);

  let arc: CSSProperties = {};
  let arcPath = '';
  let panel: CSSProperties = {};
  let track: CSSProperties = {};
  const swing = doorSwingGeometry(door, room);
  if (swing) {
    const { box, hinge, closedEnd, openEnd, radius, sweep } = swing;
    const r = radius * P;
    // Arc: a quarter circle around the hinge, from the closed leaf to the open one.
    const local = (p: Point) => `${(p.x - box.x) * P} ${(p.y - box.y) * P}`;
    arc = {
      position: 'absolute',
      left: box.x * P,
      top: box.y * P,
      width: box.width * P,
      height: box.height * P,
      overflow: 'visible',
      opacity: 0.5,
      pointerEvents: 'none',
    };
    arcPath = `M ${local(closedEnd)} A ${r} ${r} 0 0 ${sweep} ${local(openEnd)}`;
    // Leaf: the open door, from the hinge to the open end, thickened towards the strike side.
    const sx = ((closedEnd.x - hinge.x) / (radius || 1)) * LEAF_THICKNESS;
    const sy = ((closedEnd.y - hinge.y) / (radius || 1)) * LEAF_THICKNESS;
    const xs = [hinge.x * P, openEnd.x * P, hinge.x * P + sx];
    const ys = [hinge.y * P, openEnd.y * P, hinge.y * P + sy];
    panel = {
      position: 'absolute',
      backgroundColor: '#cbd5e1',
      border: '1px solid #64748b',
      left: Math.min(...xs),
      top: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  } else {
    const trackBase = {
      position: 'absolute',
      backgroundColor: '#94a3b8',
      borderRadius: 2,
      opacity: 0.6,
    } as const;
    switch (wall) {
      case 'bottom':
        track = {
          ...trackBase,
          left: pos * P,
          top: room.height * P - 8,
          width: widthPx,
          height: 6,
        };
        break;
      case 'top':
        track = { ...trackBase, left: pos * P, top: 2, width: widthPx, height: 6 };
        break;
      case 'left':
        track = { ...trackBase, left: 2, top: pos * P, width: 6, height: widthPx };
        break;
      case 'right':
        track = { ...trackBase, left: room.width * P - 8, top: pos * P, width: 6, height: widthPx };
        break;
    }
  }

  return {
    sliding,
    gap: gapStyle(wall, pos, widthPx, room),
    jamb1,
    jamb2,
    arc,
    arcPath,
    panel,
    track,
    handle: handleStyle(wall, pos, widthPx, room, 20, 0),
  };
};

export const windowStyles = (win: RoomWindow, room: RoomDims): WindowStyles => {
  const wall = win.wall || 'top';
  const pos = onWall(win, room, wall);
  const widthPx = win.width * P;
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
