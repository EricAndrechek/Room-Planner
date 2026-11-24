/**
 * Furniture in the exported plan: a `width` x `height` box at (x, y) rotated clockwise about its
 * center (as in core/geometry), with its name and size along the longer side, kept upright.
 */
import type { FurnitureItem, UnitSystem } from '../../types';
import { DARK_TEXT, getBorderColor, migrateColor, readableTextOn } from '../../colors';
import { normalizeDegrees } from '../../geometry';
import { feetToDisplay } from '../../units';
import { fitText, measureText } from '../fontMetrics';
import { FONT_LABEL_MAX, FONT_LABEL_MIN, TEXT, r2, type GroupNode, type SceneNode } from './nodes';

/** Readable text color on a fill: dark on light colors, white on dark ones (by contrast ratio). */
const textOn = (hex: string): string => (readableTextOn(hex) === DARK_TEXT ? TEXT : '#ffffff');

/** Text angle within (-90, 90], so labels never read upside down. */
const readable = (deg: number): number => {
  const a = normalizeDegrees(deg);
  if (a > 90 && a <= 270) return a - 180;
  return a > 270 ? a - 360 : a;
};

export const itemNode = (item: FurnitureItem, unitSystem: UnitSystem, s: number): GroupNode => {
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
        // Same color as the name: a muted gray falls below WCAG AA on the pastel presets.
        fill: color,
        rotate: labelRotate,
      });
  }
  return { kind: 'group', role: 'item', attrs: { label: item.label }, children };
};
