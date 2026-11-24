import {
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import { track } from '../lib/analytics';
import { PIXELS_PER_UNIT } from '../lib/constants';
import { constrainOpening, isHorizontalWall, wallLength } from '../core/geometry';
import { findOpeningSpot, findOpeningSpotOnWall } from '../core/openings';
import { clamp } from '../core/units';
import type { Door, Id, Layout, RoomDims, RoomWindow, Selection, Wall } from '../types';
import type { History } from './useHistory';
import type { usePointerDrag } from './usePointerDrag';

type OpeningKind = 'doors' | 'windows';

/** The door/window added last, for the sidebar to scroll to and highlight. */
export interface AddedOpening {
  type: 'door' | 'window';
  id: Id;
}

/** Defaults for a new opening; it goes to the next free spot from here. */
const NEW_DOOR = {
  width: 3,
  wall: 'bottom' as Wall,
  position: 2,
  hinge: 'left',
  type: 'swing-in',
} as const;
const NEW_WINDOW = { width: 3, wall: 'top' as Wall, position: 2 };

/** Slide one door/window along its wall by `delta` feet, kept on the wall. */
const slideOpening = (l: Layout, kind: OpeningKind, id: Id, dx: number, dy: number): Layout => ({
  ...l,
  [kind]: (l[kind] as (Door | RoomWindow)[]).map((o) => {
    if (o.id !== id) return o;
    const len = wallLength(l.roomDims, o.wall);
    const delta = isHorizontalWall(o.wall) ? dx : dy;
    return { ...o, position: clamp(o.position + delta, 0, len - o.width) };
  }),
});

interface Options {
  history: History<Layout>;
  selection: Selection | null;
  setSelection: Dispatch<SetStateAction<Selection | null>>;
  /** Speak a message in the live region. */
  announce: (text: string) => void;
  /** Doors/windows are only movable in room setup. */
  isRoomSetup: boolean;
  startDrag: ReturnType<typeof usePointerDrag>;
  zoomRef: RefObject<number>;
}

/**
 * Room size, and adding, editing, removing and sliding doors and windows. A new
 * opening goes to the next free spot on the walls, is selected and announced,
 * and `lastAdded` tells the sidebar which card to bring into view.
 */
export function useOpenings({
  history,
  selection,
  setSelection,
  announce,
  isRoomSetup,
  startDrag,
  zoomRef,
}: Options) {
  const { present: layout, set: setLayout, apply: applyLayout, commit } = history;
  const [lastAdded, setLastAdded] = useState<AddedOpening | null>(null);

  /** Select a new opening, point the sidebar at it and say where it went. */
  const added = (type: 'door' | 'window', id: Id, number: number, wall: Wall) => {
    setSelection({ id, type });
    setLastAdded({ type, id });
    announce(`${type === 'door' ? 'Door' : 'Window'} ${number} added on the ${wall} wall`);
  };
  /** Forget the selection if it points at this (removed) opening. */
  const deselect = (type: 'door' | 'window', id: Id) =>
    setSelection((s) => (s?.type === type && s.id === id ? null : s));

  /** Resize the room (one undo step). Returns the new size, or null if nothing changed. */
  const updateRoomDims = (dims: RoomDims): RoomDims | null => {
    const next = { width: Math.max(1, dims.width || 1), height: Math.max(1, dims.height || 1) };
    const prev = layout.roomDims;
    if (next.width === prev.width && next.height === prev.height) return null;
    applyLayout((l) => ({ ...l, roomDims: next }));
    const area = next.width * next.height - prev.width * prev.height;
    track('room_resized', { direction: area > 0 ? 'larger' : area < 0 ? 'smaller' : 'same_area' });
    return next;
  };

  const addDoor = () => {
    const spot = findOpeningSpot(layout, NEW_DOOR.width, NEW_DOOR, { swing: NEW_DOOR });
    const door: Door = {
      id: Date.now(),
      width: NEW_DOOR.width,
      ...spot,
      hinge: NEW_DOOR.hinge,
      type: NEW_DOOR.type,
    };
    applyLayout((l) => ({ ...l, doors: [...l.doors, door] }));
    track('door_added', { count: layout.doors.length + 1 });
    added('door', door.id, layout.doors.length + 1, spot.wall);
  };
  const updateDoor = (id: Id, updates: Partial<Door>) =>
    applyLayout((l) => ({
      ...l,
      doors: l.doors.map((d) => (d.id === id ? constrainOpening(d, updates, l.roomDims, 1) : d)),
    }));
  const deleteDoor = (id: Id) => {
    applyLayout((l) => ({ ...l, doors: l.doors.filter((d) => d.id !== id) }));
    deselect('door', id);
    track('door_removed', { count: layout.doors.filter((d) => d.id !== id).length });
  };

  const addWindow = () => {
    const spot = findOpeningSpot(layout, NEW_WINDOW.width, NEW_WINDOW);
    const win: RoomWindow = { id: Date.now(), width: NEW_WINDOW.width, ...spot };
    applyLayout((l) => ({ ...l, windows: [...l.windows, win] }));
    track('window_added', { count: layout.windows.length + 1 });
    added('window', win.id, layout.windows.length + 1, spot.wall);
  };
  const updateWindow = (id: Id, updates: Partial<RoomWindow>) =>
    applyLayout((l) => ({
      ...l,
      windows: l.windows.map((w) =>
        w.id === id ? constrainOpening(w, updates, l.roomDims, 0.5) : w,
      ),
    }));
  const deleteWindow = (id: Id) => {
    applyLayout((l) => ({ ...l, windows: l.windows.filter((w) => w.id !== id) }));
    deselect('window', id);
    track('window_removed', { count: layout.windows.filter((w) => w.id !== id).length });
  };

  /**
   * Move a door/window to another wall, at a free spot there (its position kept if that is free;
   * never on top of another opening). One undo step; the opening is selected and the move
   * announced. False, and nothing changes, if it fits nowhere on that wall.
   */
  const moveOpeningToWall = (type: 'door' | 'window', id: Id, wall: Wall): boolean => {
    const kind: OpeningKind = type === 'door' ? 'doors' : 'windows';
    const list: (Door | RoomWindow)[] = layout[kind];
    const index = list.findIndex((o) => o.id === id);
    const opening = list[index];
    if (!opening) return false;
    if (opening.wall === wall) return true;
    const others = { ...layout, [kind]: list.filter((o) => o.id !== id) };
    const position = findOpeningSpotOnWall(
      others,
      opening.width,
      wall,
      opening.position,
      type === 'door' ? { swing: opening as Door } : {},
    );
    if (position === null) return false;
    applyLayout((l) => ({
      ...l,
      [kind]: (l[kind] as (Door | RoomWindow)[]).map((o) =>
        o.id === id ? { ...o, wall, position } : o,
      ),
    }));
    setSelection({ id, type });
    announce(`${type === 'door' ? 'Door' : 'Window'} ${index + 1} moved to the ${wall} wall`);
    return true;
  };

  /** Drag a door/window handle along its wall (room setup only). */
  const startOpeningDrag = (e: ReactPointerEvent<HTMLDivElement>, id: Id, kind: OpeningKind) => {
    if (!isRoomSetup || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.stopPropagation();
    e.preventDefault();
    setSelection({ id, type: kind === 'doors' ? 'door' : 'window' });
    let last = { x: e.clientX, y: e.clientY };
    let moved = false;
    const input = e.pointerType;
    startDrag(e, {
      onMove: (ev) => {
        const scale = PIXELS_PER_UNIT * zoomRef.current;
        const dx = (ev.clientX - last.x) / scale;
        const dy = (ev.clientY - last.y) / scale;
        last = { x: ev.clientX, y: ev.clientY };
        if (dx || dy) moved = true;
        setLayout((l) => slideOpening(l, kind, id, dx, dy));
      },
      onEnd: () => {
        commit();
        if (moved) track('opening_moved', { kind: kind === 'doors' ? 'door' : 'window', input });
      },
    });
  };

  /** Slide the selected door/window along its wall (room setup only). */
  const nudgeOpening = (dx: number, dy: number): boolean => {
    if (!isRoomSetup || (selection?.type !== 'door' && selection?.type !== 'window')) return false;
    const kind = selection.type === 'door' ? 'doors' : 'windows';
    const id = selection.id;
    applyLayout((l) => slideOpening(l, kind, id, dx, dy));
    return true;
  };

  /**
   * Delete key on a focused door/window handle (room setup only): remove it as one undo step and
   * say so. False if no door/window is selected.
   */
  const deleteSelectedOpening = (): boolean => {
    if (!isRoomSetup || (selection?.type !== 'door' && selection?.type !== 'window')) return false;
    const isDoor = selection.type === 'door';
    const list: { id: Id }[] = isDoor ? layout.doors : layout.windows;
    const index = list.findIndex((o) => o.id === selection.id);
    if (index < 0) return false;
    if (isDoor) deleteDoor(selection.id);
    else deleteWindow(selection.id);
    announce(
      `${isDoor ? 'Door' : 'Window'} ${index + 1} removed. Press Control or Command Z to undo.`,
    );
    return true;
  };

  return {
    lastAdded,
    deleteSelectedOpening,
    updateRoomDims,
    addDoor,
    updateDoor,
    deleteDoor,
    addWindow,
    updateWindow,
    deleteWindow,
    moveOpeningToWall,
    startOpeningDrag,
    nudgeOpening,
  };
}
