/**
 * The exported floor plan as a list of drawing primitives ("scene"), built
 * purely from a plan. Both the SVG (PNG, print) and the PDF writer render
 * this same scene, so every output matches.
 *
 * This file lays out the page (title, plan, dimensions, footer); the rooms with their doors and
 * windows are drawn by scene/rooms.ts and the furniture by scene/items.ts. Pieces in the
 * inventory and hidden pieces are not drawn; the inventory is listed under the plan ("Set
 * aside"), with each piece's colour and size. A floor of several rooms draws every wall band, then
 * every floor, then the walls the rooms share, so no room's wall paints over its neighbour.
 */
import { getBorderColor, migrateColor } from '../colors';
import { leafPoint, openingDoorGeometry } from '../geometry/doors';
import { itemParts, partsBounds } from '../geometry/shapes';
import { isRectangle, outlineArea, roomBounds } from '../geometry/walls';
import { neighbourOf, roomName, sharedWalls } from '../floor';
import type { Opening, Plan, Room } from '../schema';
import type { UnitSystem } from '../types';
import { FEET_PER_METER, clamp, feetToDisplay, roundNum } from '../units';
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
import {
  doorCutNode,
  doorNode,
  drawableRoom,
  roomLabelNode,
  roomNode,
  sharedWallNode,
  windowNode,
} from './scene/rooms';

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

export interface SceneInput {
  plan: Plan;
  /** Display units. Default: the plan's setting, else feet and inches. */
  unitSystem?: UnitSystem;
  /** Title. Default: the plan's name. */
  title?: string;
  /** Date printed in the footer (defaults to now). */
  date?: Date;
  /** Locale for the footer date (defaults to the runtime's). */
  locale?: string;
  /** Footer attribution. */
  site?: string;
  /**
   * Tag each room, door, window and piece with `data-id` (its id in the plan), so a viewer can
   * point at the entities an issue names (the MCP plan viewer). Off by default: the export and
   * the golden drawings carry no ids.
   */
  ids?: boolean;
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
const FONT_LIST = 11;
/** Row height of the "Set aside" list. */
const LIST_LINE = 17;

// --- Annotations -------------------------------------------------------------------------

const isMetric = (u: UnitSystem) => u === 'm' || u === 'cm';

/** An area given in square feet, in square metres for metric units. */
const areaText = (sqft: number, unitSystem: UnitSystem): string =>
  isMetric(unitSystem)
    ? `${roundNum(sqft / (FEET_PER_METER * FEET_PER_METER), 1)} m²`
    : `${roundNum(sqft, 1)} sq ft`;

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

/**
 * The pieces in the inventory as a list under the plan, in columns across the page, from `top`:
 * a heading, then a colour swatch, the name and the size of each. Null when there are none.
 */
const inventoryList = (
  items: Plan['items'],
  unitSystem: UnitSystem,
  width: number,
  top: number,
): { node: GroupNode; height: number } | null => {
  if (items.length === 0) return null;
  const cols = width >= 760 ? 3 : 2;
  const colW = (width - 2 * MARGIN) / cols;
  const rows = Math.ceil(items.length / cols);
  const children: SceneNode[] = [
    {
      kind: 'text',
      x: MARGIN,
      y: r2(top + FONT_SUB * 0.8),
      text: `Set aside (${items.length})`,
      size: FONT_SUB,
      bold: true,
      anchor: 'start',
      fill: INK,
    },
  ];
  const first = top + FONT_SUB + 10;
  items.forEach((item, i) => {
    const x = MARGIN + Math.floor(i / rows) * colW;
    const y = first + (i % rows) * LIST_LINE;
    const color = migrateColor(item.color);
    children.push(
      {
        kind: 'rect',
        x: r2(x),
        y: r2(y),
        w: 10,
        h: 10,
        rx: 2,
        fill: color,
        stroke: getBorderColor(color),
        strokeWidth: 0.75,
      },
      {
        kind: 'text',
        x: r2(x + 16),
        y: r2(y + 9),
        text: fitText(
          `${item.label.trim() || 'Item'} · ${feetToDisplay(item.width, unitSystem)} × ${feetToDisplay(item.depth, unitSystem)}`,
          colW - 24,
          FONT_LIST,
        ),
        size: FONT_LIST,
        anchor: 'start',
        fill: TEXT,
      },
    );
  });
  return {
    node: { kind: 'group', role: 'inventory', children },
    height: FONT_SUB + 10 + rows * LIST_LINE + 8,
  };
};

// --- Scene -----------------------------------------------------------------------------

export const formatPlanDate = (date: Date, locale?: string): string => {
  try {
    return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

/** Build the printable floor plan scene for a plan (in feet). */
export const buildPlanScene = (input: SceneInput): Scene => {
  const { plan } = input;
  const unitSystem = input.unitSystem ?? plan.settings?.unitSystem ?? 'ft-in';
  const rooms = plan.rooms.map(drawableRoom);
  const boxes = rooms.map(roomBounds);
  const floor = {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
  const floorW = floor.right - floor.left;
  const floorH = floor.bottom - floor.top;
  const items = plan.items.filter((i) => i.placement && !i.hidden);
  const s = clamp(TARGET_SPAN / Math.max(floorW, floorH), 4, 80);
  // Walls ~4" thick, kept legible at any scale.
  const T = clamp(0.33 * s, 6, 15);

  // Everything the plan draws, in plan coordinates (floor coordinates times s).
  const pts: [number, number][] = [
    [floor.left * s - T, floor.top * s - T],
    [floor.right * s + T, floor.bottom * s + T],
  ];
  const several = rooms.length > 1;
  // The room on the other side of an opening, when it is on a wall two rooms share.
  const across = (room: Room, o: Opening): string | null =>
    several ? (neighbourOf({ rooms }, room, o)?.id ?? null) : null;
  const doors = rooms.flatMap((room) =>
    room.openings
      .filter((o) => o.kind === 'door')
      .map((door) => ({ room, door, connects: across(room, door) })),
  );
  const windows = rooms.flatMap((room) =>
    room.openings
      .filter((o) => o.kind === 'window')
      .map((win) => ({ room, win, connects: across(room, win) })),
  );
  for (const { room, door, connects } of doors) {
    // Outward swings reach outside the walls: keep them in the drawing.
    const g = openingDoorGeometry(room, door, connects ? 0 : T / s);
    if (g.side !== 'outside') continue;
    for (const leaf of g.leaves) {
      for (let deg = 0; deg <= leaf.angle; deg += 15) {
        const q = leafPoint(leaf, deg);
        pts.push([q.x * s, q.y * s]);
      }
    }
  }
  for (const item of items) {
    for (const part of itemParts(item)) for (const c of part) pts.push([c.x * s, c.y * s]);
  }
  const content = bounds(pts);

  // Dimension lines sit above and left of everything, measuring the interior.
  const dimTop = content.minY - DIM_GAP;
  const dimLeft = content.minX - DIM_GAP;
  const planNodes: SceneNode[] = [];

  // Floor + grid (1 ft, or 0.5 m in metric).
  const grid = isMetric(unitSystem) ? 0.5 * FEET_PER_METER * s : s;
  const tag = (node: GroupNode, id: string): GroupNode =>
    input.ids ? { ...node, attrs: { ...node.attrs, id } } : node;
  if (several) {
    for (const room of rooms) planNodes.push(roomNode(room, s, T, grid, 'band'));
    for (const room of rooms) planNodes.push(tag(roomNode(room, s, T, grid, 'floor'), room.id));
    for (const sw of sharedWalls({ rooms })) planNodes.push(sharedWallNode(sw, s, T));
  } else {
    for (const room of rooms) planNodes.push(tag(roomNode(room, s, T, grid), room.id));
  }
  for (const { room, win, connects } of windows) {
    planNodes.push(tag(windowNode(room, win, s, T, connects), win.id));
  }
  for (const { room, door, connects } of doors) {
    planNodes.push(doorCutNode(room, door, s, T, connects));
  }
  if (several) {
    // Labels keep clear of the furniture where the room has space for them.
    const boxes = items.map((i) => partsBounds(itemParts(i)));
    for (const room of rooms) {
      const name = roomName({ rooms }, room);
      planNodes.push(roomLabelNode(room, name, areaText(outlineArea(room), unitSystem), s, boxes));
    }
  }
  for (const item of items) planNodes.push(tag(itemNode(item, unitSystem, s), item.id));
  // Door leaves and swings go over the furniture, so a rug or bed never hides
  // the clearance a door needs.
  for (const { room, door, connects } of doors) {
    planNodes.push(tag(doorNode(room, door, s, T, connects), door.id));
  }
  planNodes.push(
    dimension(
      floor.left * s,
      floor.right * s,
      dimTop,
      floor.top * s - T - 3,
      feetToDisplay(floorW, unitSystem),
      false,
    ),
    dimension(
      floor.top * s,
      floor.bottom * s,
      dimLeft,
      floor.left * s - T - 3,
      feetToDisplay(floorH, unitSystem),
      true,
    ),
  );
  // Extension lines of the dimensions must reach past items that stick out of the room.
  const planBox = {
    minX: dimLeft - FONT_DIM - 10,
    minY: dimTop - FONT_DIM - 10,
    maxX: content.maxX,
    maxY: content.maxY,
  };

  // Page layout: header, plan, the inventory (if any), footer.
  const planW = planBox.maxX - planBox.minX;
  const planH = planBox.maxY - planBox.minY;
  const width = Math.ceil(Math.max(planW + 2 * MARGIN, 600));
  const headerH = FONT_TITLE + 8 + FONT_SUB + 22;
  const footerH = 50;
  const stored = inventoryList(
    plan.items.filter((i) => !i.placement),
    unitSystem,
    width,
    MARGIN + headerH + planH + 24,
  );
  const listH = stored ? stored.height + 24 : 0;
  const height = Math.ceil(MARGIN + headerH + planH + listH + footerH + MARGIN);
  const ox = (width - planW) / 2 - planBox.minX;
  const oy = MARGIN + headerH - planBox.minY;
  const nodes: SceneNode[] = planNodes.map((n) => translateNode(n, ox, oy));
  if (stored) nodes.push(stored.node);

  const title = (input.title ?? plan.name).trim() || 'Untitled';
  // One rectangle: its area as width x depth, as always; otherwise the outlines' total.
  const area =
    rooms.length === 1 && isRectangle(rooms[0]!)
      ? floorW * floorH
      : rooms.reduce((sum, r) => sum + outlineArea(r), 0);
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
        text: several
          ? `${rooms.length} rooms · ${areaText(area, unitSystem)}`
          : `${feetToDisplay(floorW, unitSystem)} × ${feetToDisplay(floorH, unitSystem)} · ${areaText(area, unitSystem)}`,
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
