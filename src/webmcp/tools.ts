/**
 * The WebMCP tools (docs/design/plan-format.md, section 8): what a browser agent can do to the
 * plan open in the app, through the app's own edits. Each mutating call is one undo step, is
 * spoken in the live region and shows what changed (the host does those three); nothing here
 * touches React or the page, so the tools are tested against a fake host.
 *
 * Lengths in and out are in the plan's display unit (`ft` for feet and inches), like the MCP
 * server's. Arguments are checked with the plan's own schema (args.ts), and an edit is applied
 * only when the plan it makes is valid. Errors come back as a value (`{ok: false, error}`) rather
 * than a rejection: a rejected `execute` reaches the agent as a bare OperationError, without the
 * message that would let it fix the call.
 */
import type * as z from 'zod/mini';
import { checkLayout, type Issue } from '../core/check';
import { randomPresetColor } from '../core/colors';
import { roomName } from '../core/floor';
import { normalizeDegrees } from '../core/geometry';
import { clampCut, defaultCut } from '../core/geometry/shapes';
import { isRectangle, outlineArea, roomBounds } from '../core/geometry/walls';
import { checkIntegrity, formatIssues, loadPlan, wallLengthOf, FIT_TOLERANCE } from '../core/load';
import { nextId, removeItem, removeOpening, renameRoom } from '../core/ops';
import { findOpeningSpot, findOpeningSpotOnWall, findFurnitureSpot } from '../core/placement';
import { Plan as PlanSchema, type Unit } from '../core/schema';
import {
  FEET_PER_CM,
  FEET_PER_INCH,
  FEET_PER_METER,
  feetToDisplay,
  fromFeet,
  roundNum,
} from '../core/units';
import { describeLayoutChange } from '../hooks/useAnnouncements';
import {
  NEW_DOOR,
  NEW_ROOM,
  NEW_WINDOW,
  addRoomBeside,
  deleteRoom,
  insertOpening,
  placePiece,
  placePieceAt,
  setRoomPosition,
  takeOutPiece,
} from '../lib/edits';
import { doorsOf, editablePlan, unitFor, windowsOf, withDoc } from '../lib/plans';
import type { Id, Item, Opening, Plan, Room, UnitSystem } from '../types';
import { TOOL_ARGS, type ToolName } from './args';

// --- The host: the planner, or a fake in tests -------------------------------------------------

/** What to show the user after an edit. */
export type Target =
  | { type: 'item' | 'door' | 'window' | 'room'; id: Id }
  /** A piece set aside: the Set aside list shows it. */
  | { type: 'aside'; id: Id };

export interface WebMcpHost {
  /** The working plan (feet), as it is now. */
  plan(): Plan;
  /** The plan's name (My Floor Plans). */
  name(): string;
  unitSystem(): UnitSystem;
  /**
   * Make `next` the working plan as one undo step, and speak `said` in the live region in place of
   * the usual description. `keepView`: keep the plan still on screen (false: a new plan, re-fit).
   */
  apply(next: Plan, said: string, options?: { keepView?: boolean }): void;
  /** Select what changed (null: nothing). */
  show(target: Target | null): void;
  /** Ask the user; resolves with the answer, false when `signal` aborts first. */
  confirm(message: string, signal?: AbortSignal): Promise<boolean>;
}

// --- Results -----------------------------------------------------------------------------------

/** Why a call failed, as a fixed vocabulary (analytics: never anything from the plan). */
export type ErrorKind =
  | 'bad_argument'
  | 'not_found'
  | 'not_allowed'
  | 'invalid_plan'
  | 'declined'
  | 'cancelled'
  | 'failed';

export type Outcome =
  { ok: true; data: Record<string, unknown> } | { ok: false; error: string; kind: ErrorKind };

const fail = (error: string, kind: ErrorKind): Outcome => ({ ok: false, error, kind });

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}

export interface WebMcpTool {
  name: ToolName;
  title: string;
  description: string;
  annotations?: ToolAnnotations;
  /** Check `input` and run the tool. Never throws for a bad call: see `Outcome`. */
  call(input: unknown, signal?: AbortSignal): Promise<Outcome>;
}

// --- Units -------------------------------------------------------------------------------------

const FEET_PER: Record<Unit, number> = {
  ft: 1,
  in: FEET_PER_INCH,
  m: FEET_PER_METER,
  cm: FEET_PER_CM,
};

/** The unit an agent reads and writes: the display unit (feet for feet and inches). */
const unitOf = (host: WebMcpHost): Unit => unitFor(host.unitSystem());

// --- Describing a plan -------------------------------------------------------------------------

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const areaText = (sqft: number, u: UnitSystem) =>
  u === 'm' || u === 'cm'
    ? `${roundNum(sqft / (FEET_PER_METER * FEET_PER_METER), 1)} m²`
    : `${roundNum(sqft, 1)} sq ft`;

/** One paragraph: each room (name, id, size, openings), then where the pieces are. */
export function summarize(plan: Plan, unitSystem: UnitSystem): string {
  const len = (feet: number) => feetToDisplay(feet, unitSystem);
  const rooms = plan.rooms.map((room) => {
    const doors = doorsOf(room).length;
    const openings = `${count(doors, 'door')} and ${count(room.openings.length - doors, 'window')}`;
    const name = `${roomName(plan, room)} (${room.id})`;
    if (isRectangle(room)) {
      const b = roomBounds(room);
      const w = b.right - b.left;
      const h = b.bottom - b.top;
      return `${name} is ${len(w)} × ${len(h)} (${areaText(w * h, unitSystem)}) with ${openings}.`;
    }
    return `${name} has ${room.outline.length} corners and ${areaText(outlineArea(room), unitSystem)}, with ${openings}.`;
  });
  const placed = plan.items.filter((i) => i.placement).length;
  const aside = plan.items.length - placed;
  return [
    ...rooms,
    `${count(placed, 'piece')} on the plan${aside ? `, ${aside} set aside` : ''}.`,
  ].join(' ');
}

// --- Checking ----------------------------------------------------------------------------------

type Issues = { path: PropertyKey[]; code: string; message: string; keys?: string[] }[];

/** Zod's issues as one sentence each, naming the field. */
const describeArgs = (issues: Issues): string =>
  issues
    .slice(0, 8)
    .map((i) => {
      const at = i.path.map(String).join('.');
      if (i.code === 'unrecognized_keys' && i.keys) {
        const list = i.keys.map((k) => `"${at ? `${at}.` : ''}${k}"`).join(', ');
        return `Unknown field${i.keys.length > 1 ? 's' : ''} ${list}: check the spelling against the input schema.`;
      }
      return `${at || 'arguments'}: ${i.message}`;
    })
    .join('\n');

/** The field within its entity: `rooms.0.openings.1.offset` -> `offset`. */
const fieldOf = (path: (string | number)[]) => {
  const last = path.findLastIndex((p) => typeof p === 'number');
  return path.slice(last + 1).join('.');
};

/** Why an edited plan is not valid (null: it is). Run on every edit before it is applied. */
function invalidEdit(next: Plan): string | null {
  const parsed = PlanSchema.safeParse(next);
  const issues = parsed.success
    ? checkIntegrity(parsed.data)
    : parsed.error.issues.map((i) => ({
        path: i.path.map((p) => (typeof p === 'number' ? p : String(p))),
        message: i.message,
      }));
  if (!issues.length) return null;
  return issues
    .slice(0, 8)
    .map((i) => {
      const field = fieldOf(i.path);
      return field ? `${field}: ${i.message}` : i.message;
    })
    .join('\n');
}

const issuesOf = (plan: Plan, unitSystem: UnitSystem): Issue[] => checkLayout(plan, { unitSystem });

// --- The tools ---------------------------------------------------------------------------------

const FORMAT =
  "Lengths are in the plan's unit (get_plan's `unit`: the one the user sees). Floor coordinates: x grows right, y grows DOWN. A piece's placement is its CENTRE; rotation is clockwise degrees. Wall i of a room runs from outline[i] to outline[i+1]; a door or window's offset runs along its wall, clockwise, from that start corner to the opening's near edge.";

const EDIT = 'The user sees the change selected, and can undo it (one step).';

type Args<K extends ToolName> = z.output<(typeof TOOL_ARGS)[K]>;

interface Spec<K extends ToolName> {
  title: string;
  description: string;
  annotations?: ToolAnnotations;
  /** `raw`: the arguments as sent (replace_plan reads its document with the loader). */
  run(args: Args<K>, signal: AbortSignal | undefined, raw: unknown): Outcome | Promise<Outcome>;
}

/** The tools, acting on `host`. */
export function createTools(host: WebMcpHost): WebMcpTool[] {
  const unit = () => unitOf(host);
  const feet = (v: number) => v * FEET_PER[unit()];
  const feetOpt = (v: number | undefined) => (v === undefined ? undefined : feet(v));
  const len = (v: number) => feetToDisplay(v, host.unitSystem());
  /** `plan` in the agent's unit. */
  const out = (plan: Plan) => fromFeet(plan, unit());
  const itemOut = (plan: Plan, id: Id) => out(plan).items.find((i) => i.id === id);
  const roomOut = (plan: Plan, id: Id) => out(plan).rooms.find((r) => r.id === id);
  const openingOut = (plan: Plan, id: Id) =>
    out(plan)
      .rooms.flatMap((r) => r.openings)
      .find((o) => o.id === id);
  const issues = (plan: Plan) => issuesOf(plan, host.unitSystem());

  /** Apply an edit that has been checked, and say and show it. */
  const commit = (
    prev: Plan,
    next: Plan,
    said: string,
    target: Target | null,
    data: Record<string, unknown>,
  ): Outcome => {
    if (next === prev) return { ok: true, data: { ...data, changed: false } };
    const why = invalidEdit(next);
    if (why) return fail(`That edit would make the plan invalid:\n${why}`, 'bad_argument');
    host.apply(next, `Assistant: ${said}`);
    host.show(target);
    return { ok: true, data: { ...data, changed: true, issues: issues(next) } };
  };

  const findItem = (plan: Plan, id: Id) => plan.items.find((i) => i.id === id);
  const noItem = (id: Id) =>
    fail(`No piece has the id "${id}". get_plan lists them in plan.items.`, 'not_found');
  const noRoom = (id: Id, field = 'roomId') =>
    fail(`${field}: no room has the id "${id}". get_plan lists them in plan.rooms.`, 'not_found');
  /** The room `id` names (the first room when it is left out), or why there is none. */
  const roomArg = (plan: Plan, id: Id | undefined, field = 'roomId'): Room | Outcome => {
    if (id === undefined) return plan.rooms[0]!;
    return plan.rooms.find((r) => r.id === id) ?? noRoom(id, field);
  };
  const isOutcome = (v: unknown): v is Outcome =>
    typeof v === 'object' && v !== null && 'ok' in v && typeof v.ok === 'boolean';
  const said = (prev: Plan, next: Plan, fallback: string) =>
    describeLayoutChange(prev, next, host.unitSystem()) || fallback;
  const showPiece = (plan: Plan, id: Id): Target =>
    findItem(plan, id)?.placement ? { type: 'item', id } : { type: 'aside', id };
  const openingName = (room: Room, o: Pick<Opening, 'id' | 'kind'>) => {
    const list = o.kind === 'door' ? doorsOf(room) : windowsOf(room);
    const n = list.findIndex((x) => x.id === o.id) + 1;
    return `${o.kind === 'door' ? 'Door' : 'Window'} ${n || list.length + 1}`;
  };
  /** An opening's offset and width checked against its wall, in the agent's unit. */
  const fits = (room: Room, wall: number, offset: number, width: number): Outcome | null => {
    const wallLen = wallLengthOf(room.outline, wall);
    if (offset + width <= wallLen + FIT_TOLERANCE) return null;
    const u = unit();
    const r = (v: number) => roundNum(v / FEET_PER[u], 4);
    return fail(
      `The opening does not fit wall ${wall}: offset ${r(offset)} + width ${r(width)} is more than the wall's length, ${r(wallLen)} ${u}.`,
      'bad_argument',
    );
  };

  /** replace_plan reads the raw document with the loader (migration, integrity, units). */
  const replacePlan = async (raw: unknown, signal?: AbortSignal): Promise<Outcome> => {
    const result = loadPlan(raw, 'strict');
    if (!result.ok) {
      if (result.reason === 'newer') {
        return fail(
          `plan.version: Room Planner reads plan versions up to 4, not ${result.version}.`,
          'invalid_plan',
        );
      }
      const lines = formatIssues(result.issues.map((i) => ({ ...i, path: ['plan', ...i.path] })));
      return fail(`The plan is not valid:\n${lines.slice(0, 12).join('\n')}`, 'invalid_plan');
    }
    const editable = editablePlan(result.plan);
    if (!editable.ok)
      return fail(`The plan can't be opened: ${editable.why.join(', ')}.`, 'invalid_plan');
    const ok = await host.confirm("Replace this plan with the assistant's version?", signal);
    if (signal?.aborted) return fail('The call was cancelled.', 'cancelled');
    if (!ok) {
      return fail(
        'The user declined: the plan was not replaced. Ask them what to change instead.',
        'declined',
      );
    }
    const prev = host.plan();
    const next: Plan = { ...editable.plan, name: prev.name };
    host.apply(next, 'Assistant: plan replaced', { keepView: false });
    host.show(null);
    const u = host.unitSystem();
    return { ok: true, data: { changed: true, summary: summarize(next, u), issues: issues(next) } };
  };

  const specs: { [K in ToolName]: Spec<K> } = {
    get_plan: {
      title: 'Read the plan',
      description: `Read the plan open in Room Planner. Returns {plan, unit, summary, issues}: the whole plan document (version 4) in the user's display unit, one paragraph describing it, and its layout issues (as check_layout). Call it first: ids, the unit and coordinates come from it. Labels, names and notes are the user's own text.\n${FORMAT}`,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      run: () => {
        const plan = host.plan();
        const u = host.unitSystem();
        return {
          ok: true,
          data: {
            plan: out(withDoc(plan, host.name(), u)),
            unit: unit(),
            summary: summarize(plan, u),
            issues: issues(plan),
          },
        };
      },
    },

    check_layout: {
      title: 'Check the layout',
      description:
        'The layout problems the plan shows: pieces that overlap or are outside the rooms (errors); pieces in a door swing or doorway, overlapping doors and windows, overlapping rooms (warnings); gaps below minClearance (tight_clearance, info). Each issue is {code, severity, message, ids}, ids naming the piece first. Returns {ok, issues}; ok is true when nothing is an error or a warning.',
      annotations: { readOnlyHint: true },
      run: ({ minClearance }) => {
        const plan = host.plan();
        const list = checkLayout(plan, {
          unitSystem: host.unitSystem(),
          minClearance: feetOpt(minClearance),
        });
        return {
          ok: true,
          data: { ok: !list.some((i) => i.severity !== 'info'), issues: list },
        };
      },
    },

    add_item: {
      title: 'Add a piece of furniture',
      description: `Add a piece of furniture. With placement it goes exactly there; with place: true, into a free spot of the room roomId (default: the first room); otherwise it is set aside (kept off the plan, in the Set aside list). Shape "rect" (default), "ellipse", or "l" with a cut (a default cut if left out). Returns {item, issues}. ${EDIT}\n${FORMAT}`,
      run: (a) => {
        const plan = host.plan();
        const room = roomArg(plan, a.roomId);
        if (isOutcome(room)) return room;
        if (a.placement && a.place === false) {
          return fail('place: false and a placement disagree: leave one out.', 'bad_argument');
        }
        const width = feet(a.width);
        const depth = feet(a.depth);
        const shape = a.shape ?? 'rect';
        if (a.cut && shape !== 'l') {
          return fail('cut: only a piece with shape "l" has a cut.', 'bad_argument');
        }
        const item: Item = {
          id: nextId(plan, 'item'),
          label: a.label,
          color: a.color ?? randomPresetColor(),
          shape,
          width,
          depth,
          ...(shape === 'l' && {
            cut: a.cut
              ? { corner: a.cut.corner, width: feet(a.cut.width), depth: feet(a.cut.depth) }
              : defaultCut(width, depth),
          }),
          ...(a.locked && { locked: true }),
          ...(a.hidden && { hidden: true }),
          ...(a.notes && { notes: a.notes }),
        };
        if (a.placement) {
          item.placement = {
            x: feet(a.placement.x),
            y: feet(a.placement.y),
            rotation: normalizeDegrees(a.placement.rotation ?? 0),
          };
        } else if (a.place) {
          item.placement = findFurnitureSpot(plan, room, item);
        }
        const next = { ...plan, items: [...plan.items, item] };
        return commit(
          plan,
          next,
          item.placement ? said(plan, next, `${item.label} added`) : `${item.label} set aside`,
          showPiece(next, item.id),
          { item: itemOut(next, item.id) },
        );
      },
    },

    update_item: {
      title: 'Change a piece of furniture',
      description: `Change a piece: label, size, colour, shape and cut, notes, locked, hidden, or move and turn it with placement (each part optional; a set-aside piece needs x and y and is put on the plan). A size change keeps the centre. A locked piece changes only with locked: false in the same call. Returns {item, issues}. ${EDIT}\n${FORMAT}`,
      run: (a) => {
        const plan = host.plan();
        const item = findItem(plan, a.id);
        if (!item) return noItem(a.id);
        const geometry =
          a.width !== undefined ||
          a.depth !== undefined ||
          a.shape !== undefined ||
          a.cut !== undefined ||
          a.placement !== undefined;
        if (item.locked && geometry && a.locked !== false) {
          return fail(
            `"${item.label}" is locked, so it can't be moved, turned or resized. Send "locked": false in the same call to unlock it (the user locked it: ask first).`,
            'not_allowed',
          );
        }
        if (
          a.placement &&
          !item.placement &&
          (a.placement.x === undefined || a.placement.y === undefined)
        ) {
          return fail(
            'placement: the piece is set aside, so give both x and y (or call place_item).',
            'bad_argument',
          );
        }
        const next: Item = { ...item };
        if (a.label !== undefined) next.label = a.label;
        if (a.color !== undefined) next.color = a.color;
        if (a.notes !== undefined) {
          if (a.notes) next.notes = a.notes;
          else delete next.notes;
        }
        if (a.width !== undefined) next.width = feet(a.width);
        if (a.depth !== undefined) next.depth = feet(a.depth);
        if (a.shape !== undefined) next.shape = a.shape;
        if (a.cut && next.shape !== 'l') {
          return fail('cut: only a piece with shape "l" has a cut.', 'bad_argument');
        }
        if (next.shape === 'l') {
          next.cut = a.cut
            ? { corner: a.cut.corner, width: feet(a.cut.width), depth: feet(a.cut.depth) }
            : clampCut(item.cut ?? defaultCut(next.width, next.depth), next.width, next.depth);
        } else delete next.cut;
        if (a.placement) {
          const at = item.placement;
          next.placement = {
            x: a.placement.x !== undefined ? feet(a.placement.x) : at!.x,
            y: a.placement.y !== undefined ? feet(a.placement.y) : at!.y,
            rotation: normalizeDegrees(a.placement.rotation ?? at?.rotation ?? 0),
          };
        }
        for (const key of ['locked', 'hidden'] as const) {
          if (a[key] === true) next[key] = true;
          else if (a[key] === false) delete next[key];
        }
        const after = { ...plan, items: plan.items.map((i) => (i.id === item.id ? next : i)) };
        const changed = JSON.stringify(next) !== JSON.stringify(item);
        return commit(
          plan,
          changed ? after : plan,
          said(plan, after, `${next.label} changed`),
          showPiece(after, item.id),
          { item: itemOut(changed ? after : plan, item.id) },
        );
      },
    },

    set_aside_item: {
      title: 'Set a piece aside',
      description: `Take a piece off the plan into the Set aside list; it keeps its size, colour and lock. Returns {item, issues}. ${EDIT}`,
      run: ({ id }) => {
        const plan = host.plan();
        if (!findItem(plan, id)) return noItem(id);
        const next = takeOutPiece(plan, id);
        return commit(
          plan,
          next,
          said(plan, next, 'Piece set aside'),
          { type: 'aside', id },
          {
            item: itemOut(next, id),
          },
        );
      },
    },

    place_item: {
      title: 'Put a set-aside piece on the plan',
      description: `Put a set-aside piece back on the plan, unrotated: with at, its centre goes there and it is moved the least amount that keeps it inside the room at that point; otherwise into a free spot of roomId (default: the first room). To move a piece already on the plan, use update_item. Returns {item, issues}. ${EDIT}\n${FORMAT}`,
      run: ({ id, at, roomId }) => {
        const plan = host.plan();
        const item = findItem(plan, id);
        if (!item) return noItem(id);
        if (item.placement) {
          return fail(
            `"${item.label}" is already on the plan: move it with update_item's placement.`,
            'not_allowed',
          );
        }
        let next: Plan;
        if (at) {
          if (roomId !== undefined) {
            return fail('Give at or roomId, not both.', 'bad_argument');
          }
          next = placePieceAt(plan, id, { x: feet(at.x), y: feet(at.y) });
          if (next === plan) {
            return fail(
              'at: that point is in no room. get_plan gives the room outlines.',
              'not_allowed',
            );
          }
        } else {
          const room = roomArg(plan, roomId);
          if (isOutcome(room)) return room;
          next = placePiece(plan, id, room.id);
        }
        return commit(
          plan,
          next,
          said(plan, next, `${item.label} placed`),
          { type: 'item', id },
          {
            item: itemOut(next, id),
          },
        );
      },
    },

    remove_item: {
      title: 'Delete a piece of furniture',
      description: `Delete a piece (from the plan or the Set aside list). Returns {issues}. ${EDIT.replace('sees the change selected, and ', '')}`,
      run: ({ id }) => {
        const plan = host.plan();
        const item = findItem(plan, id);
        if (!item) return noItem(id);
        const next = removeItem(plan, id);
        return commit(plan, next, `${item.label} deleted`, null, {});
      },
    },

    add_opening: {
      title: 'Add a door or window',
      description: `Add a door or window to a wall of the room roomId (default: the first room). Without wall it goes to the first free spot (doors are tried from wall 2, the bottom of a rectangle; windows from wall 0, the top); with wall but no offset, to the free spot nearest the middle of that wall. Default width 3 ft (0.91 m). Doors: type (default "swing-in"), hinge (default "start": on the left seen from inside facing the wall), swingAngle. Returns {opening, issues}. ${EDIT}\n${FORMAT}`,
      run: (a) => {
        const plan = host.plan();
        const room = roomArg(plan, a.roomId);
        if (isOutcome(room)) return room;
        const door = a.kind === 'door';
        if (
          !door &&
          (a.type !== undefined || a.hinge !== undefined || a.swingAngle !== undefined)
        ) {
          return fail('type, hinge and swingAngle are for doors only.', 'bad_argument');
        }
        const n = room.outline.length;
        if (a.wall !== undefined && a.wall >= n) {
          return fail(`wall: this room has walls 0 to ${n - 1}.`, 'bad_argument');
        }
        if (a.offset !== undefined && a.wall === undefined) {
          return fail('offset: give the wall it is measured along too.', 'bad_argument');
        }
        const swing = door
          ? { type: a.type ?? 'swing-in', hinge: a.hinge ?? 'start', swingAngle: a.swingAngle }
          : undefined;
        let width = a.width !== undefined ? feet(a.width) : (door ? NEW_DOOR : NEW_WINDOW).width;
        let wall: number;
        let offset: number;
        if (a.wall === undefined) {
          const pref = { wall: Math.min(door ? NEW_DOOR.wall : NEW_WINDOW.wall, n - 1), offset: 0 };
          ({ wall, offset } = findOpeningSpot(plan, room, width, pref, { swing }));
        } else {
          wall = a.wall;
          const wallLen = wallLengthOf(room.outline, wall);
          if (a.width === undefined) width = Math.min(width, wallLen);
          const middle = Math.max(0, (wallLen - width) / 2);
          offset =
            a.offset !== undefined
              ? feet(a.offset)
              : (findOpeningSpotOnWall(plan, room, width, wall, middle, { swing }) ?? middle);
        }
        if (a.width === undefined) width = Math.min(width, wallLengthOf(room.outline, wall));
        const bad = fits(room, wall, offset, width);
        if (bad) return bad;
        const o: Opening = {
          id: nextId(plan, a.kind),
          kind: a.kind,
          wall,
          offset,
          width,
          type: swing?.type ?? 'swing-in',
          hinge: swing?.hinge ?? 'start',
          ...(a.swingAngle === 180 && { swingAngle: 180 }),
        };
        const next = insertOpening(plan, o, room.id);
        const nextRoom = next.rooms.find((r) => r.id === room.id)!;
        return commit(
          plan,
          next,
          `${openingName(nextRoom, o)} added to ${roomName(next, nextRoom)}`,
          { type: o.kind, id: o.id },
          { opening: openingOut(next, o.id), roomId: room.id },
        );
      },
    },

    update_opening: {
      title: 'Change a door or window',
      description: `Change a door or window: its wall, offset or width; doors also type, hinge and swingAngle. Moved to another wall without an offset, it goes to the free spot there nearest its offset. Returns {opening, issues}. ${EDIT}\n${FORMAT}`,
      run: (a) => {
        const plan = host.plan();
        const room = plan.rooms.find((r) => r.openings.some((o) => o.id === a.id));
        const o = room?.openings.find((x) => x.id === a.id);
        if (!room || !o) {
          return fail(
            `No door or window has the id "${a.id}". get_plan lists them in each room's openings.`,
            'not_found',
          );
        }
        if (
          o.kind === 'window' &&
          (a.type !== undefined || a.hinge !== undefined || a.swingAngle !== undefined)
        ) {
          return fail('type, hinge and swingAngle are for doors only.', 'bad_argument');
        }
        const n = room.outline.length;
        if (a.wall !== undefined && a.wall >= n) {
          return fail(`wall: this room has walls 0 to ${n - 1}.`, 'bad_argument');
        }
        const wall = a.wall ?? o.wall;
        const width = a.width !== undefined ? feet(a.width) : o.width;
        let offset = a.offset !== undefined ? feet(a.offset) : o.offset;
        if (a.offset === undefined && wall !== o.wall) {
          const swing = { type: a.type ?? o.type, hinge: a.hinge ?? o.hinge };
          offset =
            findOpeningSpotOnWall(plan, room, width, wall, o.offset, { swing, exclude: o.id }) ??
            Math.max(0, Math.min(o.offset, wallLengthOf(room.outline, wall) - width));
        }
        const bad = fits(room, wall, offset, width);
        if (bad) return bad;
        const after: Opening = { ...o, wall, offset, width };
        if (a.type !== undefined) after.type = a.type;
        if (a.hinge !== undefined) after.hinge = a.hinge;
        if (a.swingAngle === 180) after.swingAngle = 180;
        else if (a.swingAngle === 90) delete after.swingAngle;
        const next: Plan = {
          ...plan,
          rooms: plan.rooms.map((r) =>
            r.id === room.id
              ? { ...r, openings: r.openings.map((x) => (x.id === o.id ? after : x)) }
              : r,
          ),
        };
        const changed = JSON.stringify(after) !== JSON.stringify(o);
        return commit(
          plan,
          changed ? next : plan,
          `${openingName(room, o)} in ${roomName(plan, room)} changed`,
          { type: o.kind, id: o.id },
          { opening: openingOut(changed ? next : plan, o.id), roomId: room.id },
        );
      },
    },

    remove_opening: {
      title: 'Delete a door or window',
      description: 'Delete a door or window. Returns {issues}. The user can undo it (one step).',
      run: ({ id }) => {
        const plan = host.plan();
        const room = plan.rooms.find((r) => r.openings.some((o) => o.id === id));
        const o = room?.openings.find((x) => x.id === id);
        if (!room || !o) {
          return fail(
            `No door or window has the id "${id}". get_plan lists them in each room's openings.`,
            'not_found',
          );
        }
        const next = removeOpening(plan, id);
        return commit(
          plan,
          next,
          `${openingName(room, o)} deleted from ${roomName(plan, room)}`,
          { type: 'room', id: room.id },
          {},
        );
      },
    },

    add_room: {
      title: 'Add a room',
      description: `Add a rectangular room (width along x, depth along y; default 10 ft or 3.05 m square) against a free side of the room besideRoomId (default: the first room), so the two share a wall. Without a name it is called "Room N". Returns {room, issues}. Other outlines: replace_plan. ${EDIT}`,
      run: (a) => {
        const plan = host.plan();
        const from = roomArg(plan, a.besideRoomId, 'besideRoomId');
        if (isOutcome(from)) return from;
        const size = {
          width: feetOpt(a.width) ?? NEW_ROOM.width,
          height: feetOpt(a.depth) ?? NEW_ROOM.height,
        };
        const added = addRoomBeside(plan, from.id, size);
        const next = a.name?.trim() ? renameRoom(added.plan, added.room.id, a.name) : added.plan;
        const room = next.rooms.find((r) => r.id === added.room.id)!;
        return commit(
          plan,
          next,
          `${roomName(next, room)} added beside ${roomName(plan, from)}`,
          { type: 'room', id: room.id },
          { room: roomOut(next, room.id) },
        );
      },
    },

    update_room: {
      title: 'Rename or move a room',
      description: `Rename a room, or move it with its doors, windows and furniture: x and y put the left and top of its bounding box there (floor coordinates). A move that would overlap another room is refused. Outline changes: replace_plan. Returns {room, issues}. ${EDIT}\n${FORMAT}`,
      run: (a) => {
        const plan = host.plan();
        const room = plan.rooms.find((r) => r.id === a.id);
        if (!room) return noRoom(a.id, 'id');
        let next = a.name !== undefined ? renameRoom(plan, room.id, a.name) : plan;
        const parts: string[] = [];
        if (next !== plan) parts.push(`${roomName(plan, room)} renamed ${roomName(next, room)}`);
        if (a.x !== undefined || a.y !== undefined) {
          const b = roomBounds(room);
          const to = { x: feetOpt(a.x) ?? b.left, y: feetOpt(a.y) ?? b.top };
          const moved = setRoomPosition(next, room.id, to);
          const same = Math.abs(to.x - b.left) < 1e-9 && Math.abs(to.y - b.top) < 1e-9;
          if (moved === next && !same) {
            return fail(
              `${roomName(plan, room)} can't go there: it would overlap another room. Rooms may share a wall but not overlap.`,
              'not_allowed',
            );
          }
          if (moved !== next) {
            parts.push(`${roomName(moved, room)} moved, ${len(to.x)}, ${len(to.y)}`);
            next = moved;
          }
        }
        return commit(
          plan,
          next,
          parts.join('. '),
          { type: 'room', id: room.id },
          {
            room: roomOut(next, room.id),
          },
        );
      },
    },

    remove_room: {
      title: 'Delete a room',
      description:
        "Delete a room with its doors and windows; the furniture in it is set aside. The last room can't be deleted. Returns {setAside, issues}: the ids of the pieces set aside. The user can undo it (one step).",
      run: ({ id }) => {
        const plan = host.plan();
        const room = plan.rooms.find((r) => r.id === id);
        if (!room) return noRoom(id, 'id');
        if (plan.rooms.length <= 1) {
          return fail("This is the plan's only room, so it can't be deleted.", 'not_allowed');
        }
        const next = deleteRoom(plan, id);
        const setAside = next.items
          .filter((i) => !i.placement && findItem(plan, i.id)?.placement)
          .map((i) => i.id);
        const n = setAside.length;
        return commit(
          plan,
          next,
          `${roomName(plan, room)} deleted${n ? `. ${n === 1 ? '1 piece' : `${n} pieces`} set aside` : ''}`,
          null,
          { setAside },
        );
      },
    },

    replace_plan: {
      title: 'Replace the whole plan',
      description: `Replace the plan with a whole new document (version 4, in any of its units): for room outlines and large rearrangements. The user is asked first, in the app; declining returns an error, and then nothing changed. The plan's name and display unit stay. Returns {summary, issues}. The user can undo it (one step).\n${FORMAT}`,
      annotations: { consequentialHint: true },
      run: (_, signal, raw) => replacePlan((raw as { plan: unknown }).plan, signal),
    },
  };

  return (Object.keys(specs) as ToolName[]).map((name) => {
    const spec = specs[name] as Spec<ToolName>;
    return {
      name,
      title: spec.title,
      description: spec.description,
      ...(spec.annotations && { annotations: spec.annotations }),
      async call(input: unknown, signal?: AbortSignal): Promise<Outcome> {
        // Early Chrome builds passed the arguments as a JSON string.
        let value: unknown = input ?? {};
        if (typeof value === 'string') {
          try {
            value = JSON.parse(value) as unknown;
          } catch {
            return fail('The arguments are not JSON.', 'bad_argument');
          }
        }
        const parsed = TOOL_ARGS[name].safeParse(value);
        if (!parsed.success) {
          return fail(describeArgs(parsed.error.issues as Issues), 'bad_argument');
        }
        try {
          return await spec.run(parsed.data as Args<ToolName>, signal, value);
        } catch {
          return fail('Room Planner could not make that change.', 'failed');
        }
      },
    };
  });
}
