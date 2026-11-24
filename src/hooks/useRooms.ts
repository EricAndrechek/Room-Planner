import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { track } from '../lib/analytics';
import { PIXELS_PER_UNIT } from '../lib/constants';
import {
  addRoomBeside,
  deleteRoom as deleteRoomEdit,
  duplicateRoom as duplicateRoomEdit,
  moveRoomBy,
  setRoomPosition,
} from '../lib/edits';
import {
  floorBounds,
  overlappedRooms,
  roomAt,
  roomName,
  snapRoomMove,
  type RoomGuide,
} from '../core/floor';
import { roomBounds } from '../core/geometry/walls';
import { moveRoom, renameRoom as renameRoomOp } from '../core/ops';
import { SNAP_THRESHOLD_PX, SNAP_THRESHOLD_TOUCH_PX, thresholdFeet } from '../core/snapping';
import { feetToDisplay, nudgeStep } from '../core/units';
import type { Id, Plan, UnitSystem } from '../types';
import type { History } from './useHistory';
import type { usePointerDrag } from './usePointerDrag';

type Bounds = ReturnType<typeof roomBounds>;

interface Options {
  history: History<Plan>;
  /** The room being edited, and a way to pick another. */
  activeRoomId: Id;
  setActiveRoomId: (id: Id) => void;
  unitSystem: UnitSystem;
  snapEnabled: boolean;
  announce: (text: string) => void;
  startDrag: ReturnType<typeof usePointerDrag>;
  zoomRef: RefObject<number>;
  containerRef: RefObject<HTMLElement | null>;
  /** Keep the plan where it is on screen while the floor's box changes. */
  keepView: (prev: Bounds, next: Bounds) => void;
  /** A room was deleted (its name, how many pieces were set aside): offer to undo. */
  onDeleted?: (name: string, setAside: number) => void;
}

/** A room being dragged: what it lines up with, and whether it overlaps another room now. */
export interface RoomDrag {
  id: Id;
  guides: RoomGuide[];
  overlap: boolean;
}

const round4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0;

/**
 * The rooms of a floor (docs/design/plan-format.md, section 9, "Several rooms"): add one beside the
 * selected room, duplicate, delete (its pieces are set aside), rename, and move one by dragging it
 * (its corners snap to the other rooms', so walls end up shared), with the arrow keys or by its
 * position fields. A room may not overlap another: a drag that ends overlapping goes back to the
 * last place it fitted, a key press or a typed position that would overlap is refused.
 */
export function useRooms({
  history,
  activeRoomId,
  setActiveRoomId,
  unitSystem,
  snapEnabled,
  announce,
  startDrag,
  zoomRef,
  containerRef,
  keepView,
  onDeleted,
}: Options) {
  const { present: plan, set: setPlan, apply: applyPlan, commit } = history;
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  });
  const [drag, setDrag] = useState<RoomDrag | null>(null);
  const len = (feet: number) => feetToDisplay(feet, unitSystem);
  const nameOf = (p: Plan, id: Id) => {
    const r = p.rooms.find((x) => x.id === id);
    return r ? roomName(p, r) : 'The room';
  };
  const where = (p: Plan, id: Id) => {
    const r = p.rooms.find((x) => x.id === id);
    if (!r) return '';
    const b = roomBounds(r);
    const f = floorBounds(p);
    return `${len(b.left - f.left)} from the left and ${len(b.top - f.top)} from the top of the floor`;
  };
  const blocker = (p: Plan, id: Id, dx: number, dy: number) => {
    const moved = moveRoom(p, id, dx, dy).rooms.find((r) => r.id === id);
    const hit = moved ? overlappedRooms(p, moved, id)[0] : undefined;
    return hit ? roomName(p, hit) : 'another room';
  };

  /** Apply an edit that may change the floor's box, keeping the plan still on screen. */
  const applyKeeping = (before: Plan, after: Plan) => {
    keepView(floorBounds(before), floorBounds(after));
    applyPlan(() => after);
  };

  const floorPoint = (clientX: number, clientY: number) => {
    const origin = containerRef.current?.querySelector('[data-floor-origin]');
    if (!origin) return null;
    const r = origin.getBoundingClientRect();
    const scale = PIXELS_PER_UNIT * zoomRef.current;
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };

  /** Drag a room (its floor or its name on the plan), with the pieces in it. */
  const startRoomDrag = (e: ReactPointerEvent<HTMLElement>, id: Id) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setActiveRoomId(id);
    const start = floorPoint(e.clientX, e.clientY);
    const base = planRef.current;
    if (!start || !base.rooms.some((r) => r.id === id)) return;
    const thresholdPx = e.pointerType === 'touch' ? SNAP_THRESHOLD_TOUCH_PX : SNAP_THRESHOLD_PX;
    const input = e.pointerType;
    let latest = base;
    let good = { dx: 0, dy: 0 };
    let at = { dx: 0, dy: 0 };
    let overlap = false;
    let snapped = false;
    setDrag({ id, guides: [], overlap: false });
    startDrag(e, {
      onMove: (ev) => {
        const p = floorPoint(ev.clientX, ev.clientY);
        if (!p) return;
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        const s =
          snapEnabled && !ev.altKey
            ? snapRoomMove(
                base,
                id,
                dx,
                dy,
                thresholdFeet(thresholdPx, zoomRef.current, PIXELS_PER_UNIT),
                nudgeStep('normal', unitSystem),
              )
            : { dx: round4(dx), dy: round4(dy), guides: [] };
        if (s.dx === at.dx && s.dy === at.dy) return;
        at = { dx: s.dx, dy: s.dy };
        const next = moveRoom(base, id, s.dx, s.dy);
        const moved = next.rooms.find((r) => r.id === id)!;
        overlap = overlappedRooms(next, moved, id).length > 0;
        if (!overlap) good = at;
        snapped = s.guides.length > 0;
        keepView(floorBounds(latest), floorBounds(next));
        latest = next;
        setPlan(() => next);
        setDrag({ id, guides: s.guides, overlap });
      },
      onEnd: () => {
        setDrag(null);
        if (latest === base) return;
        let final = latest;
        if (overlap) {
          final = good.dx || good.dy ? moveRoom(base, id, good.dx, good.dy) : base;
          keepView(floorBounds(latest), floorBounds(final));
          setPlan(() => final);
        }
        commit();
        if (final === base) {
          announce(`${nameOf(base, id)} can't go there: rooms can't overlap.`);
          return;
        }
        announce(
          `${nameOf(final, id)} moved, ${where(final, id)}.${overlap ? ' It went back to the last place it fitted: rooms cannot overlap.' : ''}`,
        );
        track('room_moved', { input, snapped });
      },
    });
  };

  /** Arrow keys on a room's name on the plan: move it by (dx, dy) feet. */
  const nudgeRoom = (id: Id, dx: number, dy: number) => {
    const before = planRef.current;
    const after = moveRoomBy(before, id, dx, dy);
    if (after === before) {
      announce(
        `${nameOf(before, id)} can't go there: it would overlap ${blocker(before, id, dx, dy)}.`,
      );
      return;
    }
    applyKeeping(before, after);
    announce(`${nameOf(after, id)} moved, ${where(after, id)}`);
    track('room_moved', { input: 'keyboard', snapped: false });
  };

  /** The room's position fields: its top-left corner (from the floor's) typed. */
  const setPosition = (id: Id, pos: { x?: number; y?: number }): boolean => {
    const before = planRef.current;
    const f = floorBounds(before);
    const after = setRoomPosition(before, id, {
      x: pos.x === undefined ? undefined : f.left + pos.x,
      y: pos.y === undefined ? undefined : f.top + pos.y,
    });
    if (after === before) {
      const r = before.rooms.find((x) => x.id === id);
      const b = r ? roomBounds(r) : null;
      const same =
        b &&
        (pos.x === undefined || b.left - f.left === pos.x) &&
        (pos.y === undefined || b.top - f.top === pos.y);
      if (!same) announce(`${nameOf(before, id)} can't go there: rooms can't overlap.`);
      return !!same;
    }
    applyKeeping(before, after);
    track('room_moved', { input: 'field', snapped: false });
    return true;
  };

  const addRoom = () => {
    const before = planRef.current;
    const { plan: after, room } = addRoomBeside(before, activeRoomId);
    applyPlan(() => after);
    setActiveRoomId(room.id);
    announce(`${roomName(after, room)} added beside ${nameOf(before, activeRoomId)}`);
    track('room_added', { count: after.rooms.length });
    return room;
  };

  const duplicateRoom = (id: Id) => {
    const before = planRef.current;
    const d = duplicateRoomEdit(before, id);
    if (!d) return null;
    applyPlan(() => d.plan);
    setActiveRoomId(d.room.id);
    announce(`${roomName(d.plan, d.room)} added`);
    track('room_duplicated', { count: d.plan.rooms.length });
    return d.room;
  };

  const deleteRoom = (id: Id) => {
    const before = planRef.current;
    if (before.rooms.length <= 1) return;
    const room = before.rooms.find((r) => r.id === id);
    if (!room) return;
    const name = roomName(before, room);
    const after = deleteRoomEdit(before, id);
    const setAside = before.items.filter(
      (i) => i.placement && roomAt(before, i.placement)?.id === id,
    ).length;
    applyKeeping(before, after);
    if (activeRoomId === id) setActiveRoomId(after.rooms[0]!.id);
    track('room_removed', { count: after.rooms.length, pieces: setAside });
    onDeleted?.(name, setAside);
  };

  const renameRoom = useCallback(
    (id: Id, name: string) => {
      const before = planRef.current;
      const after = renameRoomOp(before, id, name);
      if (after === before) return;
      applyPlan(() => after);
      track('room_renamed');
    },
    [applyPlan],
  );

  return {
    drag,
    startRoomDrag,
    nudgeRoom,
    setPosition,
    addRoom,
    duplicateRoom,
    deleteRoom,
    renameRoom,
  };
}
