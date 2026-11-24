import {
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import { track } from '../lib/analytics';
import { PIXELS_PER_UNIT } from '../lib/constants';
import {
  addDoor as addDoorEdit,
  addWindow as addWindowEdit,
  deleteOpening,
  insertOpening,
  moveOpeningToWall as moveToWall,
  resizeRoom,
  slideOpening,
  updateOpening,
  type OpeningPatch,
} from '../lib/edits';
import { doorsOf, mainRoom, openingPlace, roomSize, theWall, windowsOf } from '../lib/plans';
import type { Id, Plan, RoomDims, Selection } from '../types';
import type { History } from './useHistory';
import { nextCardSeq, type CardRef } from './useCardHighlight';
import type { usePointerDrag } from './usePointerDrag';

type OpeningKind = 'doors' | 'windows';

/** The door/window added last, for the sidebar to scroll to and highlight. */
export interface AddedOpening extends CardRef {
  type: 'door' | 'window';
}

interface Options {
  history: History<Plan>;
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
  const { present: plan, set: setPlan, apply: applyPlan, commit } = history;
  const [lastAdded, setLastAdded] = useState<AddedOpening | null>(null);
  const room = mainRoom(plan);
  const doors = doorsOf(room);
  const windows = windowsOf(room);

  /** Select a new opening, point the sidebar at it and say where it went. */
  const added = (type: 'door' | 'window', id: Id, number: number, wall: number) => {
    setSelection({ id, type });
    setLastAdded({ type, id, seq: nextCardSeq() });
    announce(`${type === 'door' ? 'Door' : 'Window'} ${number} added on ${theWall(room, wall)}`);
  };
  /** Forget the selection if it points at this (removed) opening. */
  const deselect = (type: 'door' | 'window', id: Id) =>
    setSelection((s) => (s?.type === type && s.id === id ? null : s));

  /** Resize the room (one undo step). Returns the new size, or null if nothing changed. */
  const updateRoomDims = (dims: RoomDims): RoomDims | null => {
    const next = { width: Math.max(1, dims.width || 1), height: Math.max(1, dims.height || 1) };
    const prev = roomSize(room);
    if (next.width === prev.width && next.height === prev.height) return null;
    applyPlan((p) => resizeRoom(p, next));
    const area = next.width * next.height - prev.width * prev.height;
    track('room_resized', { direction: area > 0 ? 'larger' : area < 0 ? 'smaller' : 'same_area' });
    return next;
  };

  const addDoor = () => {
    const { door, wall } = addDoorEdit(plan);
    applyPlan((p) => insertOpening(p, door));
    track('door_added', { count: doors.length + 1 });
    added('door', door.id, doors.length + 1, wall);
  };
  const updateDoor = (id: Id, updates: OpeningPatch) =>
    applyPlan((p) => updateOpening(p, id, updates, 1));
  const deleteDoor = (id: Id) => {
    applyPlan((p) => deleteOpening(p, id));
    deselect('door', id);
    track('door_removed', { count: doors.filter((d) => d.id !== id).length });
  };

  const addWindow = () => {
    const { window: win, wall } = addWindowEdit(plan);
    applyPlan((p) => insertOpening(p, win));
    track('window_added', { count: windows.length + 1 });
    added('window', win.id, windows.length + 1, wall);
  };
  const updateWindow = (id: Id, updates: OpeningPatch) =>
    applyPlan((p) => updateOpening(p, id, updates, 0.5));
  const deleteWindow = (id: Id) => {
    applyPlan((p) => deleteOpening(p, id));
    deselect('window', id);
    track('window_removed', { count: windows.filter((w) => w.id !== id).length });
  };

  /**
   * Move a door/window to another wall, at a free spot there (its position kept if that is free;
   * never on top of another opening). One undo step; the opening is selected and the move
   * announced. False, and nothing changes, if it fits nowhere on that wall.
   */
  const moveOpeningToWall = (type: 'door' | 'window', id: Id, wall: number): boolean => {
    const list = type === 'door' ? doors : windows;
    const index = list.findIndex((o) => o.id === id);
    const opening = list[index];
    if (!opening) return false;
    if (openingPlace(room, opening).wall === wall) return true;
    const next = moveToWall(plan, id, wall);
    if (next === null) return false;
    applyPlan((p) => moveToWall(p, id, wall) ?? p);
    setSelection({ id, type });
    announce(`${type === 'door' ? 'Door' : 'Window'} ${index + 1} moved to ${theWall(room, wall)}`);
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
        setPlan((p) => slideOpening(p, id, dx, dy));
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
    const id = selection.id;
    applyPlan((p) => slideOpening(p, id, dx, dy));
    return true;
  };

  /**
   * Delete key on a focused door/window handle (room setup only): remove it as one undo step and
   * say so. False if no door/window is selected.
   */
  const deleteSelectedOpening = (): boolean => {
    if (!isRoomSetup || (selection?.type !== 'door' && selection?.type !== 'window')) return false;
    const isDoor = selection.type === 'door';
    const list = isDoor ? doors : windows;
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
