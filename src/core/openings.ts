/**
 * Doors and windows in v3 terms (a wall named top/right/bottom/left, `position` from its left or
 * top end, `hinge` left or right), for the app, which still holds v3 layouts. The shapes come
 * from core/geometry/doors.ts in the v3 wall frames, and the checks and spot finding from the
 * plan-based core through core/adapter.ts. The canvas's inline styles are in
 * components/planner/openingStyles.ts.
 */
import { wallLength, type Point } from './geometry';
import {
  doorGeometry as doorShape,
  sweptArea,
  type DoorGeometry as DoorShape,
} from './geometry/doors';
import type { Door, RoomDims, Wall } from './types';
import { clamp } from './units';

export {
  DOORWAY_DEPTH,
  SLIDING_DEPTH,
  doorSwingAngle,
  hasHingeSide,
  isSwingDoor,
  leafPoint,
  type DoorLeaf,
} from './geometry/doors';
export { CORNER_MARGIN, OPENING_GAP, PLACEMENT_STEP } from './placement';
export {
  computeDoorBlocks,
  computeLayoutWarnings,
  doorBlockText,
  findOpeningSpot,
  findOpeningSpotOnWall,
  type DoorBlock,
  type OpeningSpotOptions,
} from './adapter';

/** Position along the wall, kept on the wall even if the room shrank since. */
export const onWall = (o: { position: number; width: number }, room: RoomDims, wall: Wall) =>
  clamp(o.position, 0, Math.max(0, wallLength(room, wall) - o.width));

/**
 * A wall's frame in room feet: `origin` is the wall's start (left end of
 * top/bottom, top end of left/right, where `position` is measured from),
 * `along` runs along the wall, `inward` points from the wall into the room.
 */
export const WALL_FRAMES: Record<
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

export interface DoorGeometry extends DoorShape {
  wall: Wall;
}

/**
 * Everything about a door's shape, in room feet (interior top-left is 0,0): `doorGeometry` of
 * core/geometry/doors.ts in the door's v3 wall frame.
 */
export function doorGeometry(door: Door, room: RoomDims, faceOffset = 0): DoorGeometry {
  const wall = door.wall || 'bottom';
  const frame = { ...WALL_FRAMES[wall](room), length: wallLength(room, wall) };
  return {
    wall,
    ...doorShape(
      {
        type: door.type,
        width: door.width,
        position: door.position,
        hingeAtEnd: door.hinge === 'right',
        swingAngle: door.swingAngle,
      },
      frame,
      faceOffset,
    ),
  };
}

/** Swing door geometry in the editor's terms (one leaf): see `doorGeometry`. */
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
  /** Tip of the open leaf (perpendicular to the wall at 90deg). The arc ends here. */
  openEnd: Point;
  /** SVG `sweep-flag` for the arc from `closedEnd` towards the swing side (1 = clockwise, y down). */
  sweep: 0 | 1;
  /** Unit vector from the wall towards the side the door swings to. */
  normal: Point;
  /** Axis-aligned box the leaf sweeps through (for bounds). */
  box: { x: number; y: number; width: number; height: number };
}

/**
 * A single-leaf swing door's leaf and arc (swing-in/swing-out), in room feet. Other types (double,
 * sliding, pocket, bi-fold, opening): `null` - use `doorGeometry`.
 */
export function doorSwingGeometry(door: Door, room: RoomDims, faceOffset = 0): DoorSwing | null {
  const type = door.type || 'swing-in';
  if (type !== 'swing-in' && type !== 'swing-out') return null;
  const g = doorGeometry(door, room, faceOffset);
  const l = g.leaves[0]!;
  const pts = sweptArea(l, 15);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    wall: g.wall,
    side: g.side === 'outside' ? 'outside' : 'inside',
    radius: l.radius,
    hinge: l.hinge,
    closedEnd: l.closedEnd,
    openEnd: l.openEnd,
    sweep: l.sweep,
    normal: l.v,
    box: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
  };
}
