/**
 * The exported floor plan as a list of drawing primitives ("scene"), built
 * purely from the model. Both the SVG (PNG, print) and the PDF writer render
 * this same scene, so every output matches.
 *
 * Geometry follows the editor exactly: lengths are feet, the room interior is
 * (0,0)-(width,height), doors/windows sit at `position` along their wall
 * (clamped onto it as in lib/openings.ts), furniture is a `width` x `height`
 * box at (x, y) rotated clockwise about its center (lib/geometry.ts). Walls are
 * drawn OUTSIDE the interior so interior dimensions stay true.
 */
import type {
  Door,
  FurnitureItem,
  Layout,
  RoomDims,
  RoomWindow,
  UnitSystem,
  Wall,
} from '../../types';
import { getBorderColor, migrateColor } from '../colors';
import { getRotatedCorners, normalizeDegrees, wallLength } from '../geometry';
import { FEET_PER_METER, clamp, feetToDisplay, formatArea, roundNum } from '../units';
import { fitText, measureText } from './fontMetrics';

// --- Primitives ------------------------------------------------------------------

/** Clockwise rotation (SVG/CSS convention) about (cx, cy). */
export interface Rotation {
  deg: number;
  cx: number;
  cy: number;
}

interface Paint {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  rotate?: Rotation;
}

export interface RectNode extends Paint {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  rx?: number;
}

export type PathCommand =
  | ['M', number, number]
  | ['L', number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z'];

export interface PathNode extends Paint {
  kind: 'path';
  d: PathCommand[];
}

export interface TextNode {
  kind: 'text';
  /** Anchor point on the baseline. */
  x: number;
  y: number;
  text: string;
  size: number;
  bold?: boolean;
  anchor: 'start' | 'middle' | 'end';
  fill: string;
  rotate?: Rotation;
}

export interface GroupNode {
  kind: 'group';
  /** Semantic role, emitted as data attributes in the SVG (used by tests and print CSS). */
  role: string;
  attrs?: Record<string, string>;
  children: SceneNode[];
}

export type SceneNode = RectNode | PathNode | TextNode | GroupNode;

export interface Scene {
  width: number;
  height: number;
  title: string;
  background: string;
  nodes: SceneNode[];
}

// --- Input -------------------------------------------------------------------------

export interface PlanInput {
  layout: Layout;
  unitSystem: UnitSystem;
  /** Project name, used as the plan title. */
  title: string;
  /** Date printed in the footer (defaults to now). */
  date?: Date;
  /** Locale for the footer date (defaults to the runtime's). */
  locale?: string;
  /** Footer attribution. */
  site?: string;
}

export const DEFAULT_SITE = 'room-planner.andrechek.com';

// --- Style -------------------------------------------------------------------------

const WALL = '#334155'; // slate-700, the editor's wall color
const INK = '#0f172a'; // slate-900
const TEXT = '#334155';
const MUTED = '#64748b'; // slate-500
const RULE = '#cbd5e1'; // slate-300
const GRID = '#edf1f6';
const DOOR_FILL = '#cbd5e1';
const DOOR_STROKE = '#64748b';
const SWING = '#94a3b8';
const GLASS_FILL = '#e0f2fe';
const GLASS = '#3b82f6';

/** Drawing size of the room's longer side, in scene units (~px at 1x). */
const TARGET_SPAN = 880;
const MARGIN = 36;
const DIM_GAP = 26; // wall face -> dimension line
const FONT_TITLE = 22;
const FONT_SUB = 12.5;
const FONT_DIM = 12;
const FONT_FOOT = 10.5;
const FONT_LABEL_MAX = 13;
const FONT_LABEL_MIN = 7;

const r2 = (n: number) => Math.round(n * 100) / 100;

// --- Wall frames ---------------------------------------------------------------------

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

/** Opening start, kept on its wall even if the room shrank since (as lib/openings.ts). */
const onWall = (o: { position: number; width: number }, room: RoomDims, wall: Wall) =>
  clamp(o.position, 0, Math.max(0, wallLength(room, wall) - o.width));

// Bezier handle length for a quarter circle.
const KAPPA = 0.5522847498;

/** The wall gap for a door (drawn with the walls, under the furniture). */
const doorCutNode = (door: Door, room: RoomDims, s: number, T: number): GroupNode => {
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

/** The door itself: leaf and swing arc, or sliding panels (drawn over the furniture). */
const doorNode = (door: Door, room: RoomDims, s: number, T: number): GroupNode => {
  const wall = door.wall || 'bottom';
  const type = door.type || 'swing-in';
  const pt = wallFrame(wall, room, s);
  const w = Math.min(door.width, wallLength(room, wall)) * s;
  const p = onWall(door, room, wall) * s;
  const children: SceneNode[] = [];
  if (type === 'sliding') {
    const t = Math.max(1.5, T * 0.24);
    const panel = (a0: number, a1: number, dc: number): PathNode => ({
      kind: 'path',
      d: quad(pt, a0, a1, dc - t / 2, dc + t / 2),
      fill: DOOR_FILL,
      stroke: DOOR_STROKE,
      strokeWidth: 0.9,
    });
    children.push(panel(p, p + w * 0.55, -T * 0.32), panel(p + w * 0.45, p + w, -T * 0.68));
    // Jamb lines on both faces make the opening read as a doorway.
    children.push({
      kind: 'path',
      d: [...line(pt, p, 0, p, -T), ...line(pt, p + w, 0, p + w, -T)],
      stroke: WALL,
      strokeWidth: 1,
    });
  } else {
    // Swing-in hinges on the interior face and opens into the room; swing-out
    // hinges on the exterior face and opens outward. `hinge` names the end of
    // the opening the leaf is fixed to: left = start of the wall, right = end.
    const inward = type !== 'swing-out';
    const d0 = inward ? 0 : -T;
    const dir = inward ? 1 : -1;
    const hingeLeft = door.hinge !== 'right';
    const ha = hingeLeft ? p : p + w; // hinge position along the wall
    const sa = hingeLeft ? 1 : -1; // from the hinge towards the strike side
    const leaf = Math.max(2.5, Math.min(T * 0.45, 0.14 * s));
    children.push({
      kind: 'path',
      d: [
        ['M', ...pt(ha, d0 + dir * w)],
        [
          'C',
          ...pt(ha + sa * KAPPA * w, d0 + dir * w),
          ...pt(ha + sa * w, d0 + dir * KAPPA * w),
          ...pt(ha + sa * w, d0),
        ],
      ],
      stroke: SWING,
      strokeWidth: 1,
      dash: [5, 3.5],
    });
    children.push({
      kind: 'path',
      d: quad(pt, ha, ha + sa * leaf, d0, d0 + dir * w),
      fill: DOOR_FILL,
      stroke: DOOR_STROKE,
      strokeWidth: 0.9,
    });
  }
  return { kind: 'group', role: 'door', attrs: { wall, type, hinge: door.hinge }, children };
};

const windowNode = (win: RoomWindow, room: RoomDims, s: number, T: number): GroupNode => {
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

// --- Furniture -----------------------------------------------------------------------

/** Readable text color on a fill: dark on light colors, white on dark ones. */
const textOn = (hex: string): string => {
  const v = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return Number.isNaN(c) ? 1 : c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * v(1) + 0.7152 * v(3) + 0.0722 * v(5);
  return lum < 0.28 ? '#ffffff' : TEXT;
};

/** Text angle within (-90, 90], so labels never read upside down. */
const readable = (deg: number): number => {
  const a = normalizeDegrees(deg);
  if (a > 90 && a <= 270) return a - 180;
  return a > 270 ? a - 360 : a;
};

const itemNode = (item: FurnitureItem, unitSystem: UnitSystem, s: number): GroupNode => {
  const fill = migrateColor(item.color);
  const x = item.x * s;
  const y = item.y * s;
  const w = Math.max(0, item.width) * s;
  const h = Math.max(0, item.height) * s;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rotate = item.rotation ? { deg: item.rotation, cx, cy } : undefined;
  const children: SceneNode[] = [
    {
      kind: 'rect',
      x,
      y,
      w,
      h,
      rx: Math.min(4, w / 4, h / 4),
      fill,
      stroke: getBorderColor(fill),
      strokeWidth: 1.5,
      rotate,
    },
  ];

  // Label along the piece's longer side, kept upright.
  const alongWidth = w >= h;
  const length = (alongWidth ? w : h) - 8;
  const thickness = (alongWidth ? h : w) - 4;
  const angle = readable(item.rotation + (alongWidth ? 0 : 90));
  const color = textOn(fill);
  const name = item.label.trim();
  const dims = `${feetToDisplay(item.width, unitSystem)} × ${feetToDisplay(item.height, unitSystem)}`;
  const labelRotate = angle ? { deg: r2(angle), cx, cy } : undefined;

  // Shrink a long name to fit (then truncate it at the minimum size); a piece too
  // thin for even the minimum size gets no label.
  let size = FONT_LABEL_MAX;
  if (name) {
    const natural = measureText(name, FONT_LABEL_MAX, true);
    if (natural > length) size = Math.max(FONT_LABEL_MIN, (FONT_LABEL_MAX * length) / natural);
  }
  size = Math.min(size, thickness / 1.15);
  if (name && size >= FONT_LABEL_MIN) {
    const text = fitText(name, length, size, true);
    const dimSize = Math.max(FONT_LABEL_MIN, size * 0.8);
    const twoLines =
      thickness >= size * 1.2 + dimSize * 1.25 && measureText(dims, dimSize) <= length;
    const nameY = twoLines ? cy - dimSize * 0.62 : cy;
    if (text)
      children.push({
        kind: 'text',
        x: r2(cx),
        y: r2(nameY + size * 0.35),
        text,
        size: r2(size),
        bold: true,
        anchor: 'middle',
        fill: color,
        rotate: labelRotate,
      });
    if (twoLines)
      children.push({
        kind: 'text',
        x: r2(cx),
        y: r2(cy + size * 0.62 + dimSize * 0.35),
        text: dims,
        size: r2(dimSize),
        anchor: 'middle',
        fill: color === TEXT ? MUTED : color,
        rotate: labelRotate,
      });
  }
  return { kind: 'group', role: 'item', attrs: { label: item.label }, children };
};

// --- Annotations -------------------------------------------------------------------------

const isMetric = (u: UnitSystem) => u === 'm' || u === 'cm';

const areaText = (room: RoomDims, unitSystem: UnitSystem): string =>
  isMetric(unitSystem)
    ? `${roundNum((room.width * room.height) / (FEET_PER_METER * FEET_PER_METER), 1)} m²`
    : formatArea(room.width, room.height);

/** A "nice" scale-bar length in feet, at least 130 scene units long. */
export const scaleBarFeet = (s: number, unitSystem: UnitSystem): number => {
  const steps = isMetric(unitSystem)
    ? [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100].map((m) => m * FEET_PER_METER)
    : [1, 2, 3, 5, 10, 20, 50, 100, 200];
  return steps.find((ft) => ft * s >= 130) ?? steps[steps.length - 1]!;
};

/** Horizontal dimension line from x0 to x1 at y, with extension lines down to `extTo`. */
const dimension = (
  x0: number,
  x1: number,
  y: number,
  extTo: number,
  text: string,
  vertical: boolean,
): GroupNode => {
  // Built horizontally, then mapped for the vertical (left) dimension: (x, y) -> (y, x).
  const map = (px: number, py: number): [number, number] => (vertical ? [py, px] : [px, py]);
  const tick = 4.5;
  const ext = Math.sign(extTo - y) || 1;
  const d: PathCommand[] = [
    ['M', ...map(x0, y)],
    ['L', ...map(x1, y)],
    ['M', ...map(x0, y - ext * 6)],
    ['L', ...map(x0, extTo)],
    ['M', ...map(x1, y - ext * 6)],
    ['L', ...map(x1, extTo)],
    // Architectural 45° ticks.
    ['M', ...map(x0 - tick, y + tick)],
    ['L', ...map(x0 + tick, y - tick)],
    ['M', ...map(x1 - tick, y + tick)],
    ['L', ...map(x1 + tick, y - tick)],
  ];
  const mid = (x0 + x1) / 2;
  const [tx, ty] = map(mid, y - 6);
  return {
    kind: 'group',
    role: 'dimension',
    attrs: { axis: vertical ? 'y' : 'x' },
    children: [
      { kind: 'path', d, stroke: TEXT, strokeWidth: 0.9 },
      {
        kind: 'text',
        x: r2(vertical ? tx : tx),
        y: r2(ty),
        text,
        size: FONT_DIM,
        anchor: 'middle',
        fill: TEXT,
        rotate: vertical ? { deg: -90, cx: r2(tx), cy: r2(ty) } : undefined,
      },
    ],
  };
};

const translateNode = (node: SceneNode, dx: number, dy: number): SceneNode => {
  const rot = (r?: Rotation) => r && { ...r, cx: r2(r.cx + dx), cy: r2(r.cy + dy) };
  switch (node.kind) {
    case 'group':
      return { ...node, children: node.children.map((c) => translateNode(c, dx, dy)) };
    case 'rect':
      return {
        ...node,
        x: r2(node.x + dx),
        y: r2(node.y + dy),
        w: r2(node.w),
        h: r2(node.h),
        rotate: rot(node.rotate),
      };
    case 'text':
      return { ...node, x: r2(node.x + dx), y: r2(node.y + dy), rotate: rot(node.rotate) };
    case 'path':
      return {
        ...node,
        rotate: rot(node.rotate),
        d: node.d.map((c): PathCommand => {
          switch (c[0]) {
            case 'Z':
              return c;
            case 'M':
            case 'L':
              return [c[0], r2(c[1] + dx), r2(c[2] + dy)];
            case 'C':
              return [
                'C',
                r2(c[1] + dx),
                r2(c[2] + dy),
                r2(c[3] + dx),
                r2(c[4] + dy),
                r2(c[5] + dx),
                r2(c[6] + dy),
              ];
          }
        }),
      };
  }
};

/** Bounding box of a set of points. */
const bounds = (pts: [number, number][]) => ({
  minX: Math.min(...pts.map((p) => p[0])),
  minY: Math.min(...pts.map((p) => p[1])),
  maxX: Math.max(...pts.map((p) => p[0])),
  maxY: Math.max(...pts.map((p) => p[1])),
});

// --- Scene -----------------------------------------------------------------------------

export const formatPlanDate = (date: Date, locale?: string): string => {
  try {
    return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

/** Build the printable floor plan scene for a layout. */
export const buildPlanScene = (input: PlanInput): Scene => {
  const { layout, unitSystem } = input;
  const room: RoomDims = {
    width: Math.max(0.5, layout.roomDims.width || 0),
    height: Math.max(0.5, layout.roomDims.height || 0),
  };
  const items = layout.items.filter((i) => i.visible !== false);
  const s = clamp(TARGET_SPAN / Math.max(room.width, room.height), 4, 80);
  const W = room.width * s;
  const H = room.height * s;
  // Walls ~4" thick, kept legible at any scale.
  const T = clamp(0.33 * s, 6, 15);

  // Everything the plan draws, in plan coordinates (interior top-left = 0,0).
  const pts: [number, number][] = [
    [-T, -T],
    [W + T, H + T],
  ];
  for (const door of layout.doors) {
    if (door.type !== 'swing-out') continue;
    const pt = wallFrame(door.wall || 'bottom', room, s);
    const p = onWall(door, room, door.wall || 'bottom') * s;
    pts.push(pt(p, -T - door.width * s), pt(p + door.width * s, -T - door.width * s));
  }
  for (const item of items) {
    for (const c of getRotatedCorners(item)) pts.push([c.x * s, c.y * s]);
  }
  const content = bounds(pts);

  // Dimension lines sit above and left of everything, measuring the interior.
  const dimTop = content.minY - DIM_GAP;
  const dimLeft = content.minX - DIM_GAP;
  const planNodes: SceneNode[] = [];

  // Floor + grid (1 ft, or 0.5 m in metric).
  const grid = isMetric(unitSystem) ? 0.5 * FEET_PER_METER * s : s;
  const gridPath: PathCommand[] = [];
  if (grid >= 10) {
    for (let gx = grid; gx < W - 0.5; gx += grid) gridPath.push(['M', gx, 0], ['L', gx, H]);
    for (let gy = grid; gy < H - 0.5; gy += grid) gridPath.push(['M', 0, gy], ['L', W, gy]);
  }
  planNodes.push({
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
  });
  for (const win of layout.windows) planNodes.push(windowNode(win, room, s, T));
  for (const door of layout.doors) planNodes.push(doorCutNode(door, room, s, T));
  for (const item of items) planNodes.push(itemNode(item, unitSystem, s));
  // Door leaves and swings go over the furniture, so a rug or bed never hides
  // the clearance a door needs.
  for (const door of layout.doors) planNodes.push(doorNode(door, room, s, T));
  planNodes.push(
    dimension(0, W, dimTop, -T - 3, feetToDisplay(room.width, unitSystem), false),
    dimension(0, H, dimLeft, -T - 3, feetToDisplay(room.height, unitSystem), true),
  );
  // Extension lines of the dimensions must reach past items that stick out of the room.
  const planBox = {
    minX: dimLeft - FONT_DIM - 10,
    minY: dimTop - FONT_DIM - 10,
    maxX: content.maxX,
    maxY: content.maxY,
  };

  // Page layout: header, plan, footer.
  const planW = planBox.maxX - planBox.minX;
  const planH = planBox.maxY - planBox.minY;
  const width = Math.ceil(Math.max(planW + 2 * MARGIN, 600));
  const headerH = FONT_TITLE + 8 + FONT_SUB + 22;
  const footerH = 50;
  const height = Math.ceil(MARGIN + headerH + planH + footerH + MARGIN);
  const ox = (width - planW) / 2 - planBox.minX;
  const oy = MARGIN + headerH - planBox.minY;
  const nodes: SceneNode[] = planNodes.map((n) => translateNode(n, ox, oy));

  const title = input.title.trim() || 'Untitled';
  nodes.unshift({
    kind: 'group',
    role: 'title',
    children: [
      {
        kind: 'text',
        x: MARGIN,
        y: MARGIN + FONT_TITLE * 0.8,
        text: fitText(title, width - 2 * MARGIN, FONT_TITLE, true) || '…',
        size: FONT_TITLE,
        bold: true,
        anchor: 'start',
        fill: INK,
      },
      {
        kind: 'text',
        x: MARGIN,
        y: MARGIN + FONT_TITLE + 8 + FONT_SUB * 0.8,
        text: `${feetToDisplay(room.width, unitSystem)} × ${feetToDisplay(room.height, unitSystem)} · ${areaText(room, unitSystem)}`,
        size: FONT_SUB,
        anchor: 'start',
        fill: MUTED,
      },
    ],
  });

  // Footer: rule, scale bar (left), date + site (right).
  const fy = height - MARGIN - 14;
  const barFt = scaleBarFeet(s, unitSystem);
  const barW = r2(barFt * s);
  const half = r2(barW / 2);
  const barY = fy - 6;
  const site = input.site ?? DEFAULT_SITE;
  const date = formatPlanDate(input.date ?? new Date(), input.locale);
  nodes.push({
    kind: 'group',
    role: 'footer',
    children: [
      {
        kind: 'path',
        d: [
          ['M', MARGIN, height - MARGIN - 36],
          ['L', width - MARGIN, height - MARGIN - 36],
        ],
        stroke: RULE,
        strokeWidth: 0.75,
      },
      {
        kind: 'group',
        role: 'scale-bar',
        attrs: { feet: String(roundNum(barFt, 4)) },
        children: [
          {
            kind: 'rect',
            x: MARGIN,
            y: barY,
            w: half,
            h: 5,
            fill: INK,
            stroke: INK,
            strokeWidth: 0.75,
          },
          {
            kind: 'rect',
            x: MARGIN + half,
            y: barY,
            w: half,
            h: 5,
            fill: '#ffffff',
            stroke: INK,
            strokeWidth: 0.75,
          },
          {
            kind: 'text',
            x: MARGIN,
            y: fy + 12,
            text: '0',
            size: FONT_FOOT,
            anchor: 'middle',
            fill: TEXT,
          },
          {
            kind: 'text',
            x: MARGIN + barW,
            y: fy + 12,
            text: feetToDisplay(barFt, unitSystem),
            size: FONT_FOOT,
            anchor: 'middle',
            fill: TEXT,
          },
        ],
      },
      {
        kind: 'text',
        x: width - MARGIN,
        y: fy + 4,
        text: `${date} · ${site}`,
        size: FONT_FOOT,
        anchor: 'end',
        fill: MUTED,
      },
    ],
  });

  return { width, height, title, background: '#ffffff', nodes };
};
