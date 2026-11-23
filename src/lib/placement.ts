/**
 * Where a new furniture piece goes: the free spot nearest the middle of the room.
 */
import type { Layout } from '../types';
import {
  GEOMETRY_EPSILON,
  checkItemsCollision,
  getRotatedCorners,
  polygonsOverlap,
  shrinkPolygon,
  type Point,
} from './geometry';
import { doorGeometry, PLACEMENT_STEP } from './openings';

/**
 * Top-left corner for a new, unrotated `width` x `height` piece. Positions on a `step` grid
 * centred on the room's middle are tried nearest-first; the first one that is inside the room,
 * overlaps no visible piece (touching is fine) and stays out of every door's swing, track and
 * doorway wins. If nothing is free (a full room, or a piece bigger than the room), the piece goes
 * in the middle, as it always used to.
 */
export function findFurnitureSpot(
  layout: Pick<Layout, 'roomDims' | 'doors' | 'items'>,
  size: { width: number; height: number },
  step = PLACEMENT_STEP,
): { x: number; y: number } {
  const room = layout.roomDims;
  const { width, height } = size;
  const centre = { x: room.width / 2 - width / 2, y: room.height / 2 - height / 2 };
  const maxX = room.width - width;
  const maxY = room.height - height;
  if (maxX < -GEOMETRY_EPSILON || maxY < -GEOMETRY_EPSILON) return centre;

  // Grid lines through the centre position, plus flush against each wall.
  const axis = (mid: number, max: number): number[] => {
    const out = new Set<number>([0, Math.max(0, max)]);
    for (let p = mid; p >= 0; p -= step) out.add(round(p));
    for (let p = mid + step; p <= max + 1e-9; p += step) out.add(round(p));
    return [...out];
  };
  const xs = axis(centre.x, maxX);
  const ys = axis(centre.y, maxY);
  const candidates: { x: number; y: number; d: number }[] = [];
  for (const x of xs) {
    for (const y of ys) candidates.push({ x, y, d: Math.hypot(x - centre.x, y - centre.y) });
  }
  // Nearest the middle first; ties go to the upper, then the left spot (stable and predictable).
  candidates.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);

  const pieces = layout.items.filter((i) => i.visible !== false);
  const doorZones: Point[][] = layout.doors.flatMap((d) => {
    const g = doorGeometry(d, room);
    return [...g.clearance, g.doorway];
  });
  for (const { x, y } of candidates) {
    const box = { x, y, width, height, rotation: 0 };
    if (pieces.some((p) => checkItemsCollision(box, p))) continue;
    const shape = shrinkPolygon(getRotatedCorners(box), GEOMETRY_EPSILON);
    if (doorZones.some((z) => polygonsOverlap(shape, z))) continue;
    return { x, y };
  }
  return centre;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
