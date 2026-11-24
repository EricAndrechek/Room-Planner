/**
 * Test helper: does a v4 plan describe the same drawing as the v3 layout the app reads today?
 * Compares what a user sees, in floor coordinates (feet): the room, where every door and window
 * starts and ends on the wall (after the app's clamping), which end a door hinges on, its type and
 * angle, and every piece's centre, size, rotation, colour, label and flags.
 */
import { WALL_FRAMES, doorGeometry, hasHingeSide, onWall } from '../openings';
import { normalizeDegrees, wallLength } from '../geometry';
import { migrateColor } from '../colors';
import type { Plan } from '../schema';
import type { Layout, RoomDims, Wall } from '../types';

type P = { x: number; y: number };
const close = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const samePoint = (a: P, b: P) => close(a.x, b.x) && close(a.y, b.y);

const v3Span = (o: { width: number; position: number; wall: Wall }, room: RoomDims) => {
  const width = Math.min(o.width, wallLength(room, o.wall));
  const position = onWall({ position: o.position, width }, room, o.wall);
  const { origin, along } = WALL_FRAMES[o.wall](room);
  const at = (a: number): P => ({ x: origin.x + along.x * a, y: origin.y + along.y * a });
  return { start: at(position), end: at(position + width) };
};

const v4Span = (outline: P[], wall: number, offset: number, width: number) => {
  const a = outline[wall]!;
  const b = outline[(wall + 1) % outline.length]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const at = (t: number): P => ({ x: a.x + u.x * t, y: a.y + u.y * t });
  return { start: at(offset), end: at(offset + width) };
};

/** Differences between the two, as sentences; empty when they draw the same. */
export function drawingDifferences(layout: Layout, plan: Plan): string[] {
  const out: string[] = [];
  if (plan.unit !== 'ft') out.push(`unit is ${plan.unit}`);
  const room = layout.roomDims;
  if (plan.rooms.length !== 1) return [...out, `${plan.rooms.length} rooms`];
  const r = plan.rooms[0]!;
  const rect = [
    { x: 0, y: 0 },
    { x: room.width, y: 0 },
    { x: room.width, y: room.height },
    { x: 0, y: room.height },
  ];
  if (r.outline.length !== 4 || !r.outline.every((p, i) => samePoint(p, rect[i]!))) {
    out.push(`outline ${JSON.stringify(r.outline)} is not ${JSON.stringify(rect)}`);
    return out;
  }
  const v3 = [
    ...layout.doors.map((d) => ({ kind: 'door' as const, o: d })),
    ...layout.windows.map((w) => ({ kind: 'window' as const, o: w })),
  ];
  if (v3.length !== r.openings.length) out.push(`${r.openings.length} openings, not ${v3.length}`);
  v3.forEach(({ kind, o }, i) => {
    const n = r.openings[i];
    if (!n) return;
    const where = `${kind} ${String(o.id)}`;
    if (n.kind !== kind) out.push(`${where}: kind ${n.kind}`);
    const a = v3Span(o, room);
    const b = v4Span(r.outline, n.wall, n.offset, n.width);
    // v4 runs clockwise, so on bottom and left walls its start is v3's end.
    const same =
      (samePoint(a.start, b.start) && samePoint(a.end, b.end)) ||
      (samePoint(a.start, b.end) && samePoint(a.end, b.start));
    if (!same) out.push(`${where}: at ${JSON.stringify(b)}, not ${JSON.stringify(a)}`);
    if (kind === 'door' && 'type' in o) {
      const g = doorGeometry(o, room);
      if (n.type !== g.type) out.push(`${where}: type ${n.type}, not ${g.type}`);
      const angle = n.swingAngle ?? 90;
      if ((o.swingAngle ?? 90) !== angle) out.push(`${where}: swing ${angle}`);
      if (hasHingeSide(o.type)) {
        const v3Hinge = o.hinge === 'right' ? a.end : a.start;
        const v4Hinge = n.hinge === 'end' ? b.end : b.start;
        if (!samePoint(v3Hinge, v4Hinge)) out.push(`${where}: hinged at the other end`);
      }
    }
  });
  if (layout.items.length !== plan.items.length) {
    out.push(`${plan.items.length} items, not ${layout.items.length}`);
  }
  layout.items.forEach((it, i) => {
    const n = plan.items[i];
    if (!n) return;
    const where = `item ${String(it.id)}`;
    if (n.label !== it.label) out.push(`${where}: label ${n.label}`);
    if (!close(n.width, it.width) || !close(n.depth, it.height)) out.push(`${where}: size`);
    const c = { x: it.x + it.width / 2, y: it.y + it.height / 2 };
    if (!n.placement || !samePoint(n.placement, c)) out.push(`${where}: centre`);
    else if (!close(n.placement.rotation, normalizeDegrees(it.rotation)))
      out.push(`${where}: rotation`);
    if (n.color !== migrateColor(it.color)) out.push(`${where}: color ${n.color}`);
    if ((n.hidden ?? false) !== (it.visible === false)) out.push(`${where}: hidden`);
    if ((n.locked ?? false) !== (it.locked ?? false)) out.push(`${where}: locked`);
  });
  return out;
}
