/**
 * Door shapes (docs/design/plan-format.md, section 3): the single source of truth for every door
 * type's shape (leaves and arcs, bi-fold and sliding panels, the pocket), the clearance it needs
 * and its doorway. The canvas, the export and the checks all draw from it. Shapes are built in a
 * wall's frame (`geometry/walls.ts`), so they come out in floor coordinates on any wall.
 */
import type { Opening, Room } from '../schema';
import { frameAt, openingInFrame, type WallFrame } from './walls';
import type { Point } from './index';

export type DoorType = Opening['type'];
export type SwingAngle = 90 | 180;

/** Hinged doors with a swing (one leaf, or two for double/French doors). */
export const isSwingDoor = (type: DoorType | undefined): boolean =>
  type === undefined ||
  type === 'swing-in' ||
  type === 'swing-out' ||
  type === 'double-in' ||
  type === 'double-out';

/** Doors whose `hinge` means something: the hinge side, the side a bi-fold folds to, the pocket. */
export const hasHingeSide = (type: DoorType | undefined): boolean =>
  type === undefined ||
  type === 'swing-in' ||
  type === 'swing-out' ||
  type === 'bifold' ||
  type === 'pocket';

/** How far a swing door opens: 90 degrees (default), or 180 (flat against the wall). */
export const doorSwingAngle = (door: { type?: DoorType; swingAngle?: number }): SwingAngle =>
  isSwingDoor(door.type) && door.swingAngle === 180 ? 180 : 90;

/** Depth (feet) of the passage kept clear inside the room in front of every door. */
export const DOORWAY_DEPTH = 1.5;
/** Depth (feet) of the strip a sliding (bypass/barn) door's panels run in, inside the room. */
export const SLIDING_DEPTH = 0.33;
/** Opening angle at which a bi-fold is drawn (half folded). */
const BIFOLD_DRAWN_ANGLE = 55;

// --- Door geometry (shared by the canvas, the export and the clearance checks) -----------

export interface DoorLeaf {
  /** Pivot of the leaf. */
  hinge: Point;
  /** Where the closed leaf ends (the strike side). The arc starts here. */
  closedEnd: Point;
  /** Tip of the fully open leaf (90deg: perpendicular to the wall; 180deg: back along it). */
  openEnd: Point;
  /** Leaf length = arc radius. */
  radius: number;
  angle: SwingAngle;
  /** Unit vectors: `u` along the closed leaf (hinge -> strike), `v` towards the swing side. */
  u: Point;
  v: Point;
  /** SVG `sweep-flag` for an arc from `closedEnd` towards the swing side (1 = clockwise, y down). */
  sweep: 0 | 1;
}

/** What `doorGeometry` needs of a door: along its wall's frame, and the frame's far end as `hingeAtEnd`. */
export interface DoorSpec {
  type?: DoorType;
  width: number;
  position: number;
  hingeAtEnd: boolean;
  swingAngle?: SwingAngle;
}

export interface DoorGeometry {
  type: DoorType;
  /** Opening width (capped to the wall) and position along it (kept on the wall). */
  width: number;
  position: number;
  /** Where the door swings: into the room, out of it, or not at all. */
  side: 'inside' | 'outside' | 'none';
  /** Swing leaves: one, two (double), or none. */
  leaves: DoorLeaf[];
  /** Bi-fold: the two panels, drawn half folded (hinge jamb -> fold -> the end on the track). */
  bifold: { hinge: Point; fold: Point; end: Point } | null;
  /** Sliding: the two bypass panels along the inside face (polygons). */
  slidingPanels: Point[][];
  /** Pocket: the cavity in the wall the door slides into (a line along the wall). */
  pocket: { from: Point; to: Point } | null;
  /** Areas inside the room the door itself sweeps or runs in (polygons; outward swings: none). */
  clearance: Point[][];
  /** The passage in front of the opening, `DOORWAY_DEPTH` into the room (every type). */
  doorway: Point[];
}

/** Point on a leaf's arc, `deg` degrees from closed towards open. */
export const leafPoint = (leaf: DoorLeaf, deg: number): Point => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return {
    x: leaf.hinge.x + leaf.radius * (c * leaf.u.x + sn * leaf.v.x) + 0,
    y: leaf.hinge.y + leaf.radius * (c * leaf.u.y + sn * leaf.v.y) + 0,
  };
};

/** The area a leaf sweeps (a quarter or half disc), as a polygon. */
export const sweptArea = (leaf: DoorLeaf, step = 7.5): Point[] => {
  const pts: Point[] = [leaf.hinge];
  for (let d = 0; d < leaf.angle; d += step) pts.push(leafPoint(leaf, d));
  pts.push(leaf.openEnd);
  return pts;
};

/**
 * The region a bi-fold's two panels (each half the opening) sweep while folding towards the hinge
 * jamb: under the fold's arc near the jamb and under the second panel further along. In the wall
 * frame (a from the jamb towards the strike, d into the room).
 */
const bifoldEnvelope = (half: number): [number, number][] => {
  const n = 24;
  const out: [number, number][] = [];
  for (let i = n; i >= 0; i--) {
    const a = (2 * half * i) / n;
    let d = a <= half ? Math.sqrt(Math.max(0, half * half - a * a)) : 0;
    for (let deg = 1; deg < 90; deg += 1) {
      const c = Math.cos((deg * Math.PI) / 180);
      const t = Math.tan((deg * Math.PI) / 180);
      if (half * c <= a && a <= 2 * half * c) d = Math.max(d, (2 * half * c - a) * t);
    }
    out.push([a, d]);
  }
  return out;
};

/**
 * Everything about a door's shape, in floor coordinates, given its wall's frame: swing leaves
 * (with their opening angle), bi-fold panels, sliding panels, the pocket, the clearance it needs
 * inside the room, and the doorway in front of it. `position` runs along the frame and is kept on
 * the wall, as is `width`; `hingeAtEnd` puts the hinge at the far end of the frame. `faceOffset`
 * is the wall thickness: outward swings hinge on the exterior face (the canvas draws walls as a
 * line and passes 0).
 */
export function doorGeometry(door: DoorSpec, frame: WallFrame, faceOffset = 0): DoorGeometry {
  const type: DoorType = door.type || 'swing-in';
  const len = frame.length;
  const width = Math.min(door.width, len);
  const position = Math.min(Math.max(door.position, 0), Math.max(0, len - width));
  const hingeRight = door.hingeAtEnd;
  const at = (a: number, d: number): Point => frameAt(frame, a, d);
  const quad = (a0: number, a1: number, d0: number, d1: number): Point[] => [
    at(a0, d0),
    at(a1, d0),
    at(a1, d1),
    at(a0, d1),
  ];
  const angle = doorSwingAngle(door);
  const outward = type === 'swing-out' || type === 'double-out';

  const leaf = (hingeAt: number, toStrike: 1 | -1, radius: number): DoorLeaf => {
    const face = outward ? -faceOffset : 0;
    const out = outward ? -1 : 1;
    const hinge = at(hingeAt, face);
    const closedEnd = at(hingeAt + toStrike * radius, face);
    const perp = at(hingeAt, face + out * radius);
    const unit = (p: Point): Point => ({
      x: (p.x - hinge.x) / (radius || 1) + 0,
      y: (p.y - hinge.y) / (radius || 1) + 0,
    });
    const u = unit(closedEnd);
    const v = unit(perp);
    const openEnd = angle === 90 ? perp : at(hingeAt - toStrike * radius, face);
    return {
      hinge,
      closedEnd,
      openEnd,
      radius,
      angle,
      u,
      v,
      sweep: u.x * v.y - u.y * v.x > 0 ? 1 : 0,
    };
  };

  const geo: DoorGeometry = {
    type,
    width,
    position,
    side: 'none',
    leaves: [],
    bifold: null,
    slidingPanels: [],
    pocket: null,
    clearance: [],
    doorway: quad(position, position + width, 0, DOORWAY_DEPTH),
  };

  switch (type) {
    case 'swing-in':
    case 'swing-out':
    case 'double-in':
    case 'double-out': {
      geo.side = outward ? 'outside' : 'inside';
      geo.leaves =
        type === 'double-in' || type === 'double-out'
          ? [leaf(position, 1, width / 2), leaf(position + width, -1, width / 2)]
          : [hingeRight ? leaf(position + width, -1, width) : leaf(position, 1, width)];
      if (!outward) geo.clearance = geo.leaves.map((l) => sweptArea(l));
      break;
    }
    case 'bifold': {
      geo.side = 'inside';
      const half = width / 2;
      const jamb = hingeRight ? position + width : position;
      const dir = hingeRight ? -1 : 1;
      const c = Math.cos((BIFOLD_DRAWN_ANGLE * Math.PI) / 180);
      const sn = Math.sin((BIFOLD_DRAWN_ANGLE * Math.PI) / 180);
      geo.bifold = {
        hinge: at(jamb, 0),
        fold: at(jamb + dir * half * c, half * sn),
        end: at(jamb + dir * 2 * half * c, 0),
      };
      geo.clearance = [
        [at(jamb, 0), ...bifoldEnvelope(half).map(([a, d]) => at(jamb + dir * a, d))],
      ];
      break;
    }
    case 'sliding': {
      // Two bypass panels on tracks along the inside face, overlapping in the middle.
      const t = 0.1;
      geo.slidingPanels = [
        quad(position, position + width * 0.55, 0.03, 0.03 + t),
        quad(position + width * 0.45, position + width, 0.06 + t, 0.06 + 2 * t),
      ];
      geo.clearance = [quad(position, position + width, 0, SLIDING_DEPTH)];
      break;
    }
    case 'pocket': {
      // The cavity in the wall on the hinge side, as long as the door (as far as the wall allows).
      const d = -faceOffset / 2;
      geo.pocket = hingeRight
        ? { from: at(position + width, d), to: at(Math.min(len, position + 2 * width), d) }
        : { from: at(Math.max(0, position - width), d), to: at(position, d) };
      break;
    }
    case 'opening':
      break;
  }
  return geo;
}

/** An opening's door shape in its room, in floor coordinates (in the wall's drawing frame). */
export function openingDoorGeometry(
  room: Pick<Room, 'outline'>,
  o: Pick<Opening, 'wall' | 'offset' | 'width' | 'type' | 'hinge' | 'swingAngle'>,
  faceOffset = 0,
): DoorGeometry & { frame: WallFrame } {
  const { frame, position, width, hingeAtEnd } = openingInFrame(room, o);
  return {
    ...doorGeometry(
      { type: o.type, width, position, hingeAtEnd, swingAngle: o.swingAngle },
      frame,
      faceOffset,
    ),
    frame,
  };
}
