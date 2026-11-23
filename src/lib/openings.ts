/**
 * Door and window geometry. `doorGeometry` is the single source of truth for
 * every door type's shape (leaves and arcs, bi-fold and sliding panels, the
 * pocket), the clearance it needs and its doorway; the canvas, the export
 * (export/scene.ts) and the "Blocks door" checks all use it. The rest are pure functions returning
 * the canvas's inline styles, so the components only render.
 */
import type { CSSProperties } from 'react';
import type {
  Door,
  DoorType,
  FurnitureItem,
  Id,
  Layout,
  RoomDims,
  RoomWindow,
  SwingAngle,
  Wall,
} from '../types';
import { PIXELS_PER_UNIT as P, WALL_OPTIONS } from './constants';
import {
  GEOMETRY_EPSILON,
  computeItemWarnings,
  type ItemWarning,
  getRotatedCorners,
  isHorizontalWall,
  polygonsOverlap,
  shrinkPolygon,
  wallLength,
  type Point,
} from './geometry';
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

export interface WindowStyles extends OpeningStyles {
  pane: CSSProperties;
}

/** Position along the wall, kept on the wall even if the room shrank since. */
export const onWall = (o: { position: number; width: number }, room: RoomDims, wall: Wall) =>
  clamp(o.position, 0, Math.max(0, wallLength(room, wall) - o.width));

// --- Placing a new opening ------------------------------------------------------

/** Clear space (feet) kept between a new door/window and the openings next to it. */
export const OPENING_GAP = 0.5;
/** Distance (feet) a new opening keeps from the wall's ends (the room's corners), when it can. */
export const CORNER_MARGIN = 0.5;
/** Spacing (feet) of the positions tried along each wall. */
export const PLACEMENT_STEP = 0.5;

export interface OpeningSpotOptions {
  /** For a door: its type, hinge and angle, so its swing and doorway can be kept clear of furniture. */
  swing?: Pick<Door, 'type' | 'hinge' | 'swingAngle'>;
  gap?: number;
  margin?: number;
  step?: number;
}

/**
 * Where a new door/window of `width` goes. Walls are tried in order:
 * `preferred.wall` first, then the rest in `WALL_OPTIONS` order (top, right,
 * bottom, left); along a wall, `preferred.position` first, then from the start
 * of the wall in `step` increments (plus the spots just past each opening).
 * A spot must not overlap another door or window (`gap` feet apart). Of those,
 * the first spot that also keeps `margin` from the corners and, for a door,
 * whose swing (or track) and doorway miss every visible furniture piece wins; failing that, the
 * first that keeps the corner margin; then any free spot. If nothing fits
 * anywhere, the preferred spot is returned unchanged.
 */
export function findOpeningSpot(
  layout: SpotLayout,
  width: number,
  preferred: { wall: Wall; position: number },
  options: OpeningSpotOptions = {},
): { wall: Wall; position: number } {
  const walls = [preferred.wall, ...WALL_OPTIONS.filter((w) => w !== preferred.wall)];
  const spots = openingSpots(layout, width, preferred, walls, options);
  const best =
    spots.find((s) => s.inMargin && s.clear) ?? spots.find((s) => s.inMargin) ?? spots[0];
  return best ? { wall: best.wall, position: best.position } : preferred;
}

/**
 * Where an existing door/window goes when it moves to `wall`: the same choice as
 * {@link findOpeningSpot} (its current `position` first), but on that wall only. `layout` must not
 * contain the opening itself. Null if it fits nowhere on that wall without overlapping another
 * opening (or the wall is shorter than it).
 */
export function findOpeningSpotOnWall(
  layout: SpotLayout,
  width: number,
  wall: Wall,
  position: number,
  options: OpeningSpotOptions = {},
): number | null {
  const spots = openingSpots(layout, width, { wall, position }, [wall], options);
  const best =
    spots.find((s) => s.inMargin && s.clear) ?? spots.find((s) => s.inMargin) ?? spots[0];
  return best ? best.position : null;
}

type SpotLayout = Pick<Layout, 'roomDims' | 'doors' | 'windows'> & Partial<Pick<Layout, 'items'>>;

/** Every free spot on `walls`, in preference order, with what it is good for. */
function openingSpots(
  layout: SpotLayout,
  width: number,
  preferred: { wall: Wall; position: number },
  walls: Wall[],
  { swing, gap = OPENING_GAP, margin = CORNER_MARGIN, step = PLACEMENT_STEP }: OpeningSpotOptions,
): { wall: Wall; position: number; inMargin: boolean; clear: boolean }[] {
  const eps = 1e-9;
  const room = layout.roomDims;
  const items = (layout.items ?? []).filter((i) => i.visible !== false);

  // Every free spot, in preference order, with what it is good for.
  const spots: { wall: Wall; position: number; inMargin: boolean; clear: boolean }[] = [];
  for (const wall of walls) {
    const len = wallLength(room, wall);
    if (width > len + eps) continue;
    const taken = [...layout.doors, ...layout.windows]
      .filter((o) => o.wall === wall)
      .map((o) => {
        const start = onWall(o, room, wall);
        return [start, start + Math.min(o.width, len)] as const;
      });
    const free = (p: number) =>
      p >= -eps &&
      p + width <= len + eps &&
      taken.every(([a, b]) => p + width + gap <= a + eps || p >= b + gap - eps);
    const scan: number[] = [len - width, len - width - margin, margin];
    for (let p = 0; p <= len - width + eps; p += step) scan.push(p);
    for (const [, b] of taken) scan.push(b + gap);
    const candidates = [
      clamp(preferred.position, 0, Math.max(0, len - width)),
      ...scan.map((p) => Math.round(p * 1e6) / 1e6).sort((x, y) => x - y),
    ];
    const seen = new Set<number>();
    for (const position of candidates) {
      if (seen.has(position) || !free(position)) continue;
      seen.add(position);
      // A door's own swing/track and its doorway must be clear of furniture to count as clear.
      const zones = swing
        ? (() => {
            const g = doorGeometry(
              {
                id: 0,
                width,
                position,
                wall,
                type: swing.type,
                hinge: swing.hinge,
                swingAngle: swing.swingAngle,
              },
              room,
            );
            return [...g.clearance, g.doorway];
          })()
        : [];
      const shapes = items.map((i) => shrinkPolygon(getRotatedCorners(i), GEOMETRY_EPSILON));
      spots.push({
        wall,
        position,
        inMargin: position >= margin - eps && position + width <= len - margin + eps,
        clear: !zones.some((z) => shapes.some((sh) => polygonsOverlap(sh, z))),
      });
    }
  }
  return spots;
}

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

// --- Door types ------------------------------------------------------------------------

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
export const doorSwingAngle = (door: Pick<Door, 'type' | 'swingAngle'>): SwingAngle =>
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

export interface DoorGeometry {
  wall: Wall;
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
const sweptArea = (leaf: DoorLeaf, step = 7.5): Point[] => {
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
 * Everything about a door's shape, in room feet (interior top-left is 0,0): swing leaves (with
 * their opening angle), bi-fold panels, sliding panels, the pocket, the clearance it needs inside
 * the room, and the doorway in front of it. `faceOffset` is the wall thickness in feet: outward
 * swings hinge on the exterior face (the canvas draws walls as a line and passes 0).
 */
export function doorGeometry(door: Door, room: RoomDims, faceOffset = 0): DoorGeometry {
  const type: DoorType = door.type || 'swing-in';
  const wall = door.wall || 'bottom';
  const len = wallLength(room, wall);
  const width = Math.min(door.width, len);
  const position = onWall({ position: door.position, width }, room, wall);
  const hingeRight = door.hinge === 'right';
  const { origin, along, inward } = WALL_FRAMES[wall](room);
  // `+ 0` turns -0 into 0 so results compare cleanly.
  const at = (a: number, d: number): Point => ({
    x: origin.x + along.x * a + inward.x * d + 0,
    y: origin.y + along.y * a + inward.y * d + 0,
  });
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
    wall,
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

// --- Furniture blocking doors ------------------------------------------------------------

export interface DoorBlock {
  /** The piece is in a door's swing / fold / sliding track (inside the room). */
  door: boolean;
  /** The piece stands in a doorway (the passage in front of an opening), any door type. */
  doorway: boolean;
  /** Ids of the doors concerned. */
  doorIds: Id[];
}

/**
 * Which visible pieces block a door: in its clearance (inward swings incl. both leaves of a
 * double, a bi-fold's fold, a sliding door's track) or in its doorway (every type, also openings,
 * pockets and outward swings, whose swing itself is outside). Touching an edge does not count.
 * Hidden pieces never block.
 */
export function computeDoorBlocks(
  items: readonly FurnitureItem[],
  doors: readonly Door[],
  room: RoomDims,
): Map<Id, DoorBlock> {
  const result = new Map<Id, DoorBlock>();
  if (doors.length === 0) return result;
  const geos = doors.map((d) => ({ id: d.id, g: doorGeometry(d, room) }));
  for (const item of items) {
    if (item.visible === false) continue;
    const shape = shrinkPolygon(getRotatedCorners(item), GEOMETRY_EPSILON);
    let block: DoorBlock | null = null;
    for (const { id, g } of geos) {
      const inSwing = g.clearance.some((zone) => polygonsOverlap(shape, zone));
      const inDoorway = !inSwing && polygonsOverlap(shape, g.doorway);
      if (!inSwing && !inDoorway) continue;
      block ??= { door: false, doorway: false, doorIds: [] };
      block.door ||= inSwing;
      block.doorway ||= inDoorway;
      block.doorIds.push(id);
    }
    if (block) result.set(item.id, block);
  }
  return result;
}

/**
 * Every visible piece's warnings: out of the room and overlapping furniture (red, see
 * `computeItemWarnings`), plus blocking a door or doorway (amber).
 */
export function computeLayoutWarnings(
  layout: Pick<Layout, 'items' | 'doors' | 'roomDims'>,
): Map<Id, ItemWarning> {
  const warnings = computeItemWarnings(layout.items, layout.roomDims);
  for (const [id, b] of computeDoorBlocks(layout.items, layout.doors, layout.roomDims)) {
    const w = warnings.get(id);
    if (w) {
      warnings.set(id, { ...w, blocksDoor: b.door, blocksDoorway: b.doorway, doorIds: b.doorIds });
    }
  }
  return warnings;
}

/** Short warning for a piece that blocks a door ("Blocks door" wins over "Blocks doorway"). */
export const doorBlockText = (b: Pick<DoorBlock, 'door' | 'doorway'>): string =>
  b.door ? 'Blocks door' : 'Blocks doorway';

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

export const doorStyles = (door: Door, room: RoomDims): OpeningStyles => {
  const wall = door.wall || 'bottom';
  const pos = onWall(door, room, wall);
  const widthPx = door.width * P;
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
export const doorSvg = (door: Door, room: RoomDims): DoorSvg => {
  const g = doorGeometry(door, room);
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
          const { inward } = WALL_FRAMES[g.wall](room);
          const k = -WALL_THICKNESS / 2 / P;
          const shift = (p: Point) => ({ x: p.x + inward.x * k, y: p.y + inward.y * k });
          return `M ${px(shift(g.pocket.from))} L ${px(shift(g.pocket.to))}`;
        })()
      : null,
    clearance: g.clearance.map(polyPath),
    doorway: polyPath(g.doorway),
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
