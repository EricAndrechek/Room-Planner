/**
 * The room in the exported plan: the floor and its grid, the wall band, and the doors and windows
 * in it. Geometry follows the editor exactly: the room interior is (0,0)-(width,height) in feet,
 * doors and windows sit at `position` along their wall (clamped onto it as in core/openings.ts),
 * and walls are drawn OUTSIDE the interior so interior dimensions stay true.
 */
import type { Door, RoomDims, RoomWindow, Wall } from '../../types';
import type { Point } from '../../geometry';
import { doorGeometry, leafPoint, onWall, type DoorLeaf } from '../../openings';
import { wallLength } from '../../geometry';
import {
  DOOR_FILL,
  DOOR_STROKE,
  GLASS,
  GLASS_FILL,
  GRID,
  SWING,
  WALL,
  type GroupNode,
  type PathCommand,
  type PathNode,
  type SceneNode,
} from './nodes';

/**
 * Floor (with a grid every `grid` plan units, when that is at least 10) inside the wall band, `T`
 * thick, for a `W` x `H` interior.
 */
export const roomNode = (
  room: RoomDims,
  W: number,
  H: number,
  T: number,
  grid: number,
): GroupNode => {
  const gridPath: PathCommand[] = [];
  if (grid >= 10) {
    for (let gx = grid; gx < W - 0.5; gx += grid) gridPath.push(['M', gx, 0], ['L', gx, H]);
    for (let gy = grid; gy < H - 0.5; gy += grid) gridPath.push(['M', 0, gy], ['L', W, gy]);
  }
  return {
    kind: 'group',
    role: 'room',
    attrs: { width: String(room.width), height: String(room.height) },
    children: [
      // Wall band: outer rectangle in wall color, interior floor on top.
      { kind: 'rect', x: -T, y: -T, w: W + 2 * T, h: H + 2 * T, fill: WALL },
      { kind: 'rect', x: 0, y: 0, w: W, h: H, fill: '#ffffff' },
      ...(gridPath.length
        ? [{ kind: 'path', d: gridPath, stroke: GRID, strokeWidth: 0.75 } as PathNode]
        : []),
    ],
  };
};

interface Vec {
  x: number;
  y: number;
}

/**
 * A wall's local frame: `a` runs along the wall from its start (left end of
 * top/bottom, top end of left/right - the same origin `position` uses), `d`
 * points into the room from the interior face (negative = into the wall/outside).
 */
const wallFrame = (wall: Wall, room: RoomDims, s: number) => {
  const W = room.width * s;
  const H = room.height * s;
  const frames: Record<Wall, { o: Vec; u: Vec; n: Vec }> = {
    top: { o: { x: 0, y: 0 }, u: { x: 1, y: 0 }, n: { x: 0, y: 1 } },
    bottom: { o: { x: 0, y: H }, u: { x: 1, y: 0 }, n: { x: 0, y: -1 } },
    left: { o: { x: 0, y: 0 }, u: { x: 0, y: 1 }, n: { x: 1, y: 0 } },
    right: { o: { x: W, y: 0 }, u: { x: 0, y: 1 }, n: { x: -1, y: 0 } },
  };
  const { o, u, n } = frames[wall];
  return (a: number, d: number): [number, number] => [
    o.x + u.x * a + n.x * d,
    o.y + u.y * a + n.y * d,
  ];
};

type Pt = (a: number, d: number) => [number, number];

const quad = (pt: Pt, a0: number, a1: number, d0: number, d1: number): PathCommand[] => [
  ['M', ...pt(a0, d0)],
  ['L', ...pt(a1, d0)],
  ['L', ...pt(a1, d1)],
  ['L', ...pt(a0, d1)],
  ['Z'],
];

const line = (pt: Pt, a0: number, d0: number, a1: number, d1: number): PathCommand[] => [
  ['M', ...pt(a0, d0)],
  ['L', ...pt(a1, d1)],
];

/** The wall gap for a door (drawn with the walls, under the furniture). */
export const doorCutNode = (door: Door, room: RoomDims, s: number, T: number): GroupNode => {
  const wall = door.wall || 'bottom';
  const pt = wallFrame(wall, room, s);
  const w = Math.min(door.width, wallLength(room, wall)) * s;
  const p = onWall(door, room, wall) * s;
  return {
    kind: 'group',
    role: 'door-opening',
    attrs: { wall },
    // Slightly over-drawn so no hairline of wall remains.
    children: [{ kind: 'path', d: quad(pt, p, p + w, 0.6, -T - 0.6), fill: '#ffffff' }],
  };
};

/** Cubic Beziers for a leaf's arc from `fromDeg` to `toDeg` (in <= 90deg pieces), in plan units. */
const arcCommands = (leaf: DoorLeaf, fromDeg: number, toDeg: number, s: number): PathCommand[] => {
  const at = (p: Point): [number, number] => [p.x * s, p.y * s];
  const tangent = (deg: number): Point => {
    const a = (deg * Math.PI) / 180;
    const dir = Math.sign(toDeg - fromDeg);
    return {
      x: dir * leaf.radius * (-Math.sin(a) * leaf.u.x + Math.cos(a) * leaf.v.x),
      y: dir * leaf.radius * (-Math.sin(a) * leaf.u.y + Math.cos(a) * leaf.v.y),
    };
  };
  const pieces = Math.max(1, Math.ceil(Math.abs(toDeg - fromDeg) / 90));
  const step = (toDeg - fromDeg) / pieces;
  // Bezier handle length for a circular arc of `step` degrees.
  const k = (4 / 3) * Math.tan((Math.abs(step) * Math.PI) / 720);
  const cmds: PathCommand[] = [['M', ...at(leafPoint(leaf, fromDeg))]];
  for (let i = 0; i < pieces; i++) {
    const a0 = fromDeg + step * i;
    const a1 = a0 + step;
    const p0 = leafPoint(leaf, a0);
    const p1 = leafPoint(leaf, a1);
    const t0 = tangent(a0);
    const t1 = tangent(a1);
    cmds.push([
      'C',
      ...at({ x: p0.x + k * t0.x, y: p0.y + k * t0.y }),
      ...at({ x: p1.x - k * t1.x, y: p1.y - k * t1.y }),
      ...at(p1),
    ]);
  }
  return cmds;
};

/** A filled panel from `a` to `b`, `thick` (plan units) wide towards unit vector `side`. */
const panelPath = (a: Point, b: Point, side: Point, thick: number, s: number): PathNode => {
  const o = { x: (side.x * thick) / s, y: (side.y * thick) / s };
  const at = (p: Point): [number, number] => [p.x * s, p.y * s];
  return {
    kind: 'path',
    d: [
      ['M', ...at(a)],
      ['L', ...at({ x: a.x + o.x, y: a.y + o.y })],
      ['L', ...at({ x: b.x + o.x, y: b.y + o.y })],
      ['L', ...at(b)],
      ['Z'],
    ],
    fill: DOOR_FILL,
    stroke: DOOR_STROKE,
    strokeWidth: 0.9,
  };
};

/**
 * The door itself (drawn over the furniture), from the same `doorGeometry` the editor draws:
 * swing arcs and open leaves (one or two, 90 or 180 degrees), a half-folded bi-fold, sliding
 * panels along the inside face, a pocket in the wall, or nothing for a plain opening.
 */
export const doorNode = (door: Door, room: RoomDims, s: number, T: number): GroupNode => {
  const wall = door.wall || 'bottom';
  const type = door.type || 'swing-in';
  const pt = wallFrame(wall, room, s);
  // Outward swings hinge on the exterior face, a wall thickness (T) outside the interior.
  const g = doorGeometry(door, room, T / s);
  const p = g.position * s;
  const w = g.width * s;
  const children: SceneNode[] = [];
  // Arcs first (dashed), drawn from each open leaf's tip back to where it closes.
  for (const leaf of g.leaves) {
    children.push({
      kind: 'path',
      d: arcCommands(leaf, leaf.angle, 0, s),
      stroke: SWING,
      strokeWidth: 1,
      dash: [5, 3.5],
    });
  }
  const leafThick = Math.max(2.5, Math.min(T * 0.45, 0.14 * s));
  for (const leaf of g.leaves) {
    children.push(
      panelPath(leaf.hinge, leaf.openEnd, leaf.angle === 90 ? leaf.u : leaf.v, leafThick, s),
    );
  }
  if (g.bifold) {
    const { hinge, fold, end } = g.bifold;
    const normal = (a: Point, b: Point): Point => {
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: -(b.y - a.y) / d, y: (b.x - a.x) / d };
    };
    const t = Math.max(1.5, leafThick * 0.7);
    children.push(panelPath(hinge, fold, normal(hinge, fold), t, s));
    children.push(panelPath(fold, end, normal(fold, end), t, s));
  }
  for (const poly of g.slidingPanels) {
    children.push({
      kind: 'path',
      d: [...poly.map((q, i): PathCommand => [i === 0 ? 'M' : 'L', q.x * s, q.y * s]), ['Z']],
      fill: DOOR_FILL,
      stroke: DOOR_STROKE,
      strokeWidth: 0.9,
    });
  }
  if (g.pocket) {
    // The cavity in the wall, and the door's edge showing at the mouth of the pocket.
    const along = (q: Point) => (wall === 'top' || wall === 'bottom' ? q.x : q.y) * s;
    const from = along(g.pocket.from);
    const to = along(g.pocket.to);
    children.push({
      kind: 'path',
      d: line(pt, from, -T / 2, to, -T / 2),
      stroke: DOOR_STROKE,
      strokeWidth: 1.2,
      dash: [4, 3],
    });
  }
  if (type === 'sliding' || type === 'pocket' || type === 'opening' || type === 'bifold') {
    // Jamb lines on both faces make the opening read as a doorway.
    children.push({
      kind: 'path',
      d: [...line(pt, p, 0, p, -T), ...line(pt, p + w, 0, p + w, -T)],
      stroke: WALL,
      strokeWidth: 1,
    });
  }
  return { kind: 'group', role: 'door', attrs: { wall, type, hinge: door.hinge }, children };
};

export const windowNode = (win: RoomWindow, room: RoomDims, s: number, T: number): GroupNode => {
  const wall = win.wall || 'top';
  const pt = wallFrame(wall, room, s);
  const w = Math.min(win.width, wallLength(room, wall)) * s;
  const p = onWall(win, room, wall) * s;
  return {
    kind: 'group',
    role: 'window',
    attrs: { wall },
    children: [
      { kind: 'path', d: quad(pt, p, p + w, 0.6, -T - 0.6), fill: '#ffffff' },
      { kind: 'path', d: quad(pt, p, p + w, 0, -T), fill: GLASS_FILL },
      // Sill lines on both faces, jambs at the ends, and the glass in the middle.
      {
        kind: 'path',
        d: [
          ...line(pt, p, 0, p + w, 0),
          ...line(pt, p, -T, p + w, -T),
          ...line(pt, p, 0, p, -T),
          ...line(pt, p + w, 0, p + w, -T),
        ],
        stroke: WALL,
        strokeWidth: 1,
      },
      { kind: 'path', d: line(pt, p, -T / 2, p + w, -T / 2), stroke: GLASS, strokeWidth: 1.6 },
    ],
  };
};
