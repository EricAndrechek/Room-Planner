/**
 * Edit links made by the MCP server, in a form the deployed app opens (docs/design/plan-format.md,
 * section 7, "Links that today's app opens").
 *
 * Until PR 5 the app holds v3 layouts (`APP_PLAN_VERSION` is 3) and answers a v4 link with the
 * "needs a newer Room Planner" dialog, so the server writes the v3 share form: one rectangular
 * room, doors, windows and rectangular pieces. A plan that needs more (several rooms, another
 * outline, L-shaped or round pieces, pieces in the inventory) gets no link, and the reasons.
 *
 * The switch is `planLink`: once `APP_PLAN_VERSION` reaches `PLAN_VERSION` (PR 5) it writes the
 * compact v4 form for every plan, and the v3 half of this file can be deleted. It depends only on
 * the parts of core that PR 5 keeps (schema, units, the byte codec and the compact form), and
 * writes the v3 form itself, so PR 5 removing `core/layout.ts` does not touch it.
 */
import { PLAN_VERSION, type Opening, type Plan, type UNIT_SYSTEMS } from '../src/core/schema';
import { bytesToBase64Url, deflate } from '../src/core/share/codec';
import { compact } from '../src/core/share/compact';
import { feetToUnitValue } from '../src/core/units';
import { APP_PLAN_VERSION } from '../src/lib/planVersion';

/** True while the deployed app cannot open v4 links. */
export const WRITES_V3_LINKS = APP_PLAN_VERSION < PLAN_VERSION;

type UnitSystem = (typeof UNIT_SYSTEMS)[number];
type V3Wall = 'top' | 'right' | 'bottom' | 'left';
const WALLS: V3Wall[] = ['top', 'right', 'bottom', 'left'];

/** The v3 share form (`ShareConfig` in the v3 app): lengths in `unitSystem`. */
export interface V3ShareConfig {
  name: string;
  unitSystem: UnitSystem;
  roomDims: { width: number; height: number };
  doors: Record<string, unknown>[];
  windows: Record<string, unknown>[];
  items: Record<string, unknown>[];
}

/**
 * The room's outline as a rectangle, with the index of its top-left corner, or null when it is not
 * a rectangle with axis-aligned walls.
 */
const asRectangle = (outline: Plan['rooms'][number]['outline']) => {
  if (outline.length !== 4) return null;
  const xs = [...new Set(outline.map((p) => p.x))];
  const ys = [...new Set(outline.map((p) => p.y))];
  if (xs.length !== 2 || ys.length !== 2) return null;
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const start = outline.findIndex((p) => p.x === left && p.y === top);
  // Clockwise (y down) from the top-left corner, the next corner is the top-right one.
  const next = outline[(start + 1) % 4]!;
  if (start < 0 || next.y !== top || next.x === left) return null;
  return { start, left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
};

const names = (items: Plan['items']): string => {
  const all = items.map((i) => i.label || i.id);
  return all.length <= 3
    ? all.join(', ')
    : `${all.slice(0, 3).join(', ')} and ${all.length - 3} more`;
};

/** Why the deployed app could not open `plan` (empty: it can). */
export function linkBlockers(plan: Plan): string[] {
  if (!WRITES_V3_LINKS) return [];
  const out: string[] = [];
  if (plan.rooms.length > 1) out.push(`it has ${plan.rooms.length} rooms (the app shows one)`);
  else if (!asRectangle(plan.rooms[0]!.outline)) {
    out.push('the room is not a rectangle with axis-aligned walls');
  }
  const shaped = plan.items.filter((i) => i.shape !== 'rect');
  if (shaped.length) out.push(`not rectangular: ${names(shaped)}`);
  const stored = plan.items.filter((i) => !i.placement);
  if (stored.length) out.push(`no placement (inventory): ${names(stored)}`);
  return out;
}

/** What a link leaves out although it can be made: text the v3 form has no field for. */
export function linkOmissions(plan: Plan): string[] {
  if (!WRITES_V3_LINKS) return [];
  const out: string[] = [];
  if (plan.rooms.some((r) => r.name)) out.push('the room name');
  if (plan.items.some((i) => i.notes)) out.push('item notes');
  return out;
}

/** The display unit system of a plan (in feet). */
const displayUnit = (plan: Plan): UnitSystem =>
  plan.settings?.unitSystem ?? (plan.unit === 'ft' ? 'ft-in' : plan.unit);

/**
 * A plan (in feet) with no blockers in the v3 share form, as the v3 app writes it: the room moved
 * to the origin, openings on named walls with v3 positions and hinges, pieces by the top-left
 * corner of their unrotated box, lengths in the display unit. Ids are numbered from 1, so the
 * app's 3 -> 4 migration gives `door-1`, `window-1`, `item-1`. The inverse of that migration.
 */
export function planToShareConfig(plan: Plan): V3ShareConfig {
  const room = plan.rooms[0]!;
  const rect = asRectangle(room.outline);
  if (!rect || plan.rooms.length !== 1) throw new Error('Not a single rectangular room.');
  const unitSystem = displayUnit(plan);
  const c = (feet: number) => feetToUnitValue(feet, unitSystem);
  const place = (o: Opening) => {
    const wall = WALLS[(((o.wall - rect.start) % 4) + 4) % 4]!;
    const len = wall === 'top' || wall === 'bottom' ? rect.width : rect.height;
    // Bottom and left run backwards along a clockwise outline.
    const reversed = wall === 'bottom' || wall === 'left';
    const position = reversed ? Math.max(0, len - o.offset - o.width) : o.offset;
    return { wall, reversed, width: c(o.width), position: c(position) };
  };
  const doors = room.openings
    .filter((o) => o.kind === 'door')
    .map((o, i) => {
      const { wall, reversed, width, position } = place(o);
      return {
        id: i + 1,
        width,
        position,
        wall,
        hinge: (o.hinge === 'end') !== reversed ? 'right' : 'left',
        type: o.type,
        ...(o.swingAngle ? { swingAngle: o.swingAngle } : {}),
      };
    });
  const windows = room.openings
    .filter((o) => o.kind === 'window')
    .map((o, i) => {
      const { wall, width, position } = place(o);
      return { id: i + 1, width, position, wall };
    });
  const items = plan.items.map((it, i) => {
    const p = it.placement!;
    return {
      id: i + 1,
      label: it.label,
      width: c(it.width),
      height: c(it.depth),
      x: c(p.x - rect.left - it.width / 2),
      y: c(p.y - rect.top - it.depth / 2),
      rotation: p.rotation,
      color: it.color,
      visible: !it.hidden,
      ...(it.locked ? { locked: true } : {}),
    };
  });
  return {
    name: plan.name,
    unitSystem,
    roomDims: { width: c(rect.width), height: c(rect.height) },
    doors,
    windows,
    items,
  };
}

export type PlanLink = { url: string } | { url: null; blockers: string[] };

/** `origin` + `/#s=<base64url(deflate-raw(JSON))>`, the app's share link. */
const shareUrl = async (origin: string, payload: unknown): Promise<string> => {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return `${new URL('/', origin).toString()}#s=${bytesToBase64Url(await deflate(json))}`;
};

/** The edit link for a plan (in feet) on `origin`, or why there is none. */
export async function planLink(plan: Plan, origin: string): Promise<PlanLink> {
  if (!WRITES_V3_LINKS) return { url: await shareUrl(origin, compact(plan)) };
  const blockers = linkBlockers(plan);
  if (blockers.length) return { url: null, blockers };
  return { url: await shareUrl(origin, planToShareConfig(plan)) };
}
