/**
 * The rooms in the exported plan: each floor and its grid, the wall band, and the doors and
 * windows in it, in floor coordinates times the scale `s`. Walls are drawn OUTSIDE the interior
 * so interior dimensions stay true. Doors and windows are drawn in their wall's drawing frame
 * (core/geometry/walls.ts), which for a rectangle is the frame the v3 app drew in, so a
 * rectangular room draws exactly as it always has.
 */
import { leafPoint, openingDoorGeometry, type DoorLeaf } from '../../geometry/doors';
import type { Point } from '../../geometry';
import { isRectangle, openingInFrame, roomBounds, type WallFrame } from '../../geometry/walls';
import type { Opening, Room } from '../../schema';
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

const WALL_NAMES = ['top', 'right', 'bottom', 'left'];

/** The wall's name in the drawing's data attributes: top/right/bottom/left on a rectangle. */
const wallAttr = (room: Room, wall: number) =>
  isRectangle(room) ? WALL_NAMES[wall]! : String(wall);

/**
 * A room as drawn: a rectangle no smaller than half a foot each way (as the v3 export clamped
 * its room), any other outline as it is.
 */
export const drawableRoom = (room: Room): Room => {
  const o = room.outline;
  if (o.length !== 4) return room;
  const [a, b, c, d] = o as [Point, Point, Point, Point];
  if (!(a.y === b.y && b.x === c.x && c.y === d.y && d.x === a.x)) return room;
  const w = Math.max(0.5, b.x - a.x || 0);
  const h = Math.max(0.5, c.y - b.y || 0);
  return {
    ...room,
    outline: [
      { x: a.x, y: a.y },
      { x: a.x + w, y: a.y },
      { x: a.x + w, y: a.y + h },
      { x: a.x, y: a.y + h },
    ],
  };
};

/**
 * Floor (with a grid every `grid` plan units, when that is at least 10) inside the wall band, `T`
 * thick. A rectangle is two rectangles, as it always was; any other outline is its path, with the
 * wall band as a stroke twice `T` wide that the floor then covers on the inside.
 */
export const roomNode = (room: Room, s: number, T: number, grid: number): GroupNode => {
  const b = roomBounds(room);
  const width = b.right - b.left;
  const height = b.bottom - b.top;
  const attrs = { width: String(width), height: String(height) };
  if (!isRectangle(room)) {
    const d: PathCommand[] = [
      ...room.outline.map((p, i): PathCommand => [i === 0 ? 'M' : 'L', p.x * s, p.y * s]),
      ['Z'],
    ];
    return {
      kind: 'group',
      role: 'room',
      attrs,
      children: [
        { kind: 'path', d, fill: WALL, stroke: WALL, strokeWidth: 2 * T },
        { kind: 'path', d, fill: '#ffffff' },
      ],
    };
  }
  const x0 = b.left * s;
  const y0 = b.top * s;
  const W = width * s;
  const H = height * s;
  const gridPath: PathCommand[] = [];
  if (grid >= 10) {
    for (let gx = grid; gx < W - 0.5; gx += grid) {
      gridPath.push(['M', x0 + gx, y0], ['L', x0 + gx, y0 + H]);
    }
    for (let gy = grid; gy < H - 0.5; gy += grid) {
      gridPath.push(['M', x0, y0 + gy], ['L', x0 + W, y0 + gy]);
    }
  }
  return {
    kind: 'group',
    role: 'room',
    attrs,
    children: [
      // Wall band: outer rectangle in wall color, interior floor on top.
      { kind: 'rect', x: x0 - T, y: y0 - T, w: W + 2 * T, h: H + 2 * T, fill: WALL },
      { kind: 'rect', x: x0, y: y0, w: W, h: H, fill: '#ffffff' },
      ...(gridPath.length
        ? [{ kind: 'path', d: gridPath, stroke: GRID, strokeWidth: 0.75 } as PathNode]
        : []),
    ],
  };
};

/**
 * A wall's frame in plan units: `a` along the wall from the start of its drawing frame, `d` into
 * the room from the interior face (negative = into the wall/outside).
 */
const scaled = (f: WallFrame, s: number) => {
  const ox = f.origin.x * s;
  const oy = f.origin.y * s;
  return (a: number, d: number): [number, number] => [
    ox + f.along.x * a + f.inward.x * d,
    oy + f.along.y * a + f.inward.y * d,
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
export const doorCutNode = (room: Room, door: Opening, s: number, T: number): GroupNode => {
  const { frame, position, width } = openingInFrame(room, door);
  const pt = scaled(frame, s);
  const w = width * s;
  const p = position * s;
  return {
    kind: 'group',
    role: 'door-opening',
    attrs: { wall: wallAttr(room, door.wall) },
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
export const doorNode = (room: Room, door: Opening, s: number, T: number): GroupNode => {
  const type = door.type || 'swing-in';
  // Outward swings hinge on the exterior face, a wall thickness (T) outside the interior.
  const g = openingDoorGeometry(room, door, T / s);
  const pt = scaled(g.frame, s);
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
    const f = g.frame;
    const along = (q: Point) =>
      ((q.x - f.origin.x) * f.along.x + (q.y - f.origin.y) * f.along.y) * s;
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
  // `hinge` is named in the drawing frame (left = its start), as the v3 app named it.
  const hinge = openingInFrame(room, door).hingeAtEnd ? 'right' : 'left';
  return {
    kind: 'group',
    role: 'door',
    attrs: { wall: wallAttr(room, door.wall), type, hinge },
    children,
  };
};

export const windowNode = (room: Room, win: Opening, s: number, T: number): GroupNode => {
  const { frame, position, width } = openingInFrame(room, win);
  const pt = scaled(frame, s);
  const w = width * s;
  const p = position * s;
  return {
    kind: 'group',
    role: 'window',
    attrs: { wall: wallAttr(room, win.wall) },
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
