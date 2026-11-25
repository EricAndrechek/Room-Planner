/**
 * Furniture in the exported plan: the piece's `width` x `depth` box around its centre, rotated
 * clockwise about it (as in core/geometry/shapes.ts), drawn as a rounded rectangle, an L or an
 * ellipse, with its name and size along the longer side of its label area (the box, an L's larger
 * part, or the rectangle inside an ellipse), kept upright.
 */
import { isL, itemBox, labelArea, lOutline } from '../../geometry/shapes';
import type { Item } from '../../schema';
import type { UnitSystem } from '../../types';
import { DARK_TEXT, getBorderColor, migrateColor, readableTextOn } from '../../colors';
import { normalizeDegrees } from '../../geometry';
import { feetToDisplay } from '../../units';
import { fitText, measureText } from '../fontMetrics';
import {
  FONT_LABEL_MAX,
  FONT_LABEL_MIN,
  TEXT,
  r2,
  type GroupNode,
  type PathCommand,
  type SceneNode,
} from './nodes';

/** Readable text color on a fill: dark on light colors, white on dark ones (by contrast ratio). */
const textOn = (hex: string): string => (readableTextOn(hex) === DARK_TEXT ? TEXT : '#ffffff');

/** Text angle within (-90, 90], so labels never read upside down. */
const readable = (deg: number): number => {
  const a = normalizeDegrees(deg);
  if (a > 90 && a <= 270) return a - 180;
  return a > 270 ? a - 360 : a;
};

/** The outline of an L or an ellipse in the unrotated box (x, y, w, h), in plan units. */
const shapePath = (
  item: Item,
  x: number,
  y: number,
  w: number,
  h: number,
  s: number,
): PathCommand[] => {
  if (item.shape === 'ellipse') {
    // Four cubic Beziers, the standard circle approximation (k = 0.5523).
    const k = 0.5522847498;
    const rx = w / 2;
    const ry = h / 2;
    const cx = x + rx;
    const cy = y + ry;
    return [
      ['M', cx + rx, cy],
      ['C', cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry],
      ['C', cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy],
      ['C', cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry],
      ['C', cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy],
      ['Z'],
    ];
  }
  const corners = lOutline(item.width, item.depth, item.cut!);
  return [
    ...corners.map((p, i): PathCommand => [i === 0 ? 'M' : 'L', x + p.x * s, y + p.y * s]),
    ['Z'],
  ];
};

export const itemNode = (item: Item, unitSystem: UnitSystem, s: number): GroupNode => {
  const fill = migrateColor(item.color);
  const box = itemBox(item)!;
  const x = box.x * s;
  const y = box.y * s;
  const w = Math.max(0, item.width) * s;
  const h = Math.max(0, item.depth) * s;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rotation = box.rotation;
  const rotate = rotation ? { deg: rotation, cx, cy } : undefined;
  const paint = { fill, stroke: getBorderColor(fill), strokeWidth: 1.5, rotate };
  const children: SceneNode[] = [
    item.shape === 'ellipse' || isL(item)
      ? { kind: 'path', d: shapePath(item, x, y, w, h, s), ...paint }
      : { kind: 'rect', x, y, w, h, rx: Math.min(4, w / 4, h / 4), ...paint },
  ];

  // Label along the longer side of its area, kept upright. The area's centre turns with the
  // piece (for a rectangle it is the piece's centre).
  const area = labelArea(item);
  const aw = area.width * s;
  const ah = area.height * s;
  let lx = cx;
  let ly = cy;
  const ox = x + area.x * s + aw / 2 - cx;
  const oy = y + area.y * s + ah / 2 - cy;
  if (ox || oy) {
    const rad = (rotation * Math.PI) / 180;
    lx = cx + ox * Math.cos(rad) - oy * Math.sin(rad);
    ly = cy + ox * Math.sin(rad) + oy * Math.cos(rad);
  }
  const alongWidth = aw >= ah;
  const length = (alongWidth ? aw : ah) - 8;
  const thickness = (alongWidth ? ah : aw) - 4;
  const angle = readable(rotation + (alongWidth ? 0 : 90));
  const color = textOn(fill);
  const name = item.label.trim();
  const dims = `${feetToDisplay(item.width, unitSystem)} × ${feetToDisplay(item.depth, unitSystem)}`;
  const labelRotate = angle ? { deg: r2(angle), cx: lx, cy: ly } : undefined;

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
    const nameY = twoLines ? ly - dimSize * 0.62 : ly;
    if (text)
      children.push({
        kind: 'text',
        x: r2(lx),
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
        x: r2(lx),
        y: r2(ly + size * 0.62 + dimSize * 0.35),
        text: dims,
        size: r2(dimSize),
        anchor: 'middle',
        // Same color as the name: a muted gray falls below WCAG AA on the pastel presets.
        fill: color,
        rotate: labelRotate,
      });
  }
  return { kind: 'group', role: 'item', attrs: { label: item.label }, children };
};
