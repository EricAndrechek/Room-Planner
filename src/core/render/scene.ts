/**
 * The exported floor plan as a list of drawing primitives ("scene"), built
 * purely from the model. Both the SVG (PNG, print) and the PDF writer render
 * this same scene, so every output matches.
 *
 * This file lays out the page (title, plan, dimensions, footer); the room with its doors and
 * windows is drawn by scene/rooms.ts and the furniture by scene/items.ts.
 */
import type { Layout, RoomDims, UnitSystem } from '../types';
import { getRotatedCorners } from '../geometry';
import { doorGeometry, leafPoint } from '../openings';
import { FEET_PER_METER, clamp, feetToDisplay, formatArea, roundNum } from '../units';
import { fitText } from './fontMetrics';
import { itemNode } from './scene/items';
import {
  INK,
  MUTED,
  RULE,
  TEXT,
  r2,
  type GroupNode,
  type PathCommand,
  type Rotation,
  type Scene,
  type SceneNode,
} from './scene/nodes';
import { doorCutNode, doorNode, roomNode, windowNode } from './scene/rooms';

export type {
  GroupNode,
  PathCommand,
  PathNode,
  RectNode,
  Rotation,
  Scene,
  SceneNode,
  TextNode,
} from './scene/nodes';

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

/** Drawing size of the room's longer side, in scene units (~px at 1x). */
const TARGET_SPAN = 880;
const MARGIN = 36;
const DIM_GAP = 26; // wall face -> dimension line
const FONT_TITLE = 22;
const FONT_SUB = 12.5;
const FONT_DIM = 12;
const FONT_FOOT = 10.5;

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
    // Outward swings reach outside the walls: keep them in the drawing.
    const g = doorGeometry(door, room, T / s);
    if (g.side !== 'outside') continue;
    for (const leaf of g.leaves) {
      for (let deg = 0; deg <= leaf.angle; deg += 15) {
        const q = leafPoint(leaf, deg);
        pts.push([q.x * s, q.y * s]);
      }
    }
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
  planNodes.push(roomNode(room, W, H, T, grid));
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
