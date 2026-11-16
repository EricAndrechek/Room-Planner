import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { track } from '../lib/analytics';
import { PIXELS_PER_UNIT } from '../lib/constants';
import { constrainOpening, isHorizontalWall, wallLength } from '../lib/geometry';
import { clamp } from '../lib/units';
import type { Door, Id, Layout, RoomDims, RoomWindow, Selection } from '../types';
import type { History } from './useHistory';
import type { usePointerDrag } from './usePointerDrag';

type OpeningKind = 'doors' | 'windows';

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
  setSelection: (selection: Selection | null) => void;
  /** Doors/windows are only movable in room setup. */
  isRoomSetup: boolean;
  startDrag: ReturnType<typeof usePointerDrag>;
  zoomRef: RefObject<number>;
}

/** Room size, and adding, editing, removing and sliding doors and windows. */
export function useOpenings({
  history,
  selection,
  setSelection,
  isRoomSetup,
  startDrag,
  zoomRef,
}: Options) {
  const { present: layout, set: setLayout, apply: applyLayout, commit } = history;

  const updateRoomDims = (dims: RoomDims) =>
    applyLayout((l) => ({
      ...l,
      roomDims: { width: Math.max(1, dims.width || 1), height: Math.max(1, dims.height || 1) },
    }));

  const addDoor = () => {
    const door: Door = {
      id: Date.now(),
      width: 3,
      position: 2,
      wall: 'bottom',
      hinge: 'left',
      type: 'swing-in',
    };
    applyLayout((l) => ({ ...l, doors: [...l.doors, door] }));
    track('door_added', { count: layout.doors.length + 1 });
  };
  const updateDoor = (id: Id, updates: Partial<Door>) =>
    applyLayout((l) => ({
      ...l,
      doors: l.doors.map((d) => (d.id === id ? constrainOpening(d, updates, l.roomDims, 1) : d)),
    }));
  const deleteDoor = (id: Id) =>
    applyLayout((l) => ({ ...l, doors: l.doors.filter((d) => d.id !== id) }));

  const addWindow = () => {
    const win: RoomWindow = { id: Date.now(), width: 3, position: 2, wall: 'top' };
    applyLayout((l) => ({ ...l, windows: [...l.windows, win] }));
    track('window_added', { count: layout.windows.length + 1 });
  };
  const updateWindow = (id: Id, updates: Partial<RoomWindow>) =>
    applyLayout((l) => ({
      ...l,
      windows: l.windows.map((w) =>
        w.id === id ? constrainOpening(w, updates, l.roomDims, 0.5) : w,
      ),
    }));
  const deleteWindow = (id: Id) =>
    applyLayout((l) => ({ ...l, windows: l.windows.filter((w) => w.id !== id) }));

  /** Drag a door/window handle along its wall (room setup only). */
  const startOpeningDrag = (e: ReactPointerEvent<HTMLDivElement>, id: Id, kind: OpeningKind) => {
    if (!isRoomSetup || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.stopPropagation();
    e.preventDefault();
    setSelection({ id, type: kind === 'doors' ? 'door' : 'window' });
    let last = { x: e.clientX, y: e.clientY };
    startDrag(e, {
      onMove: (ev) => {
        const scale = PIXELS_PER_UNIT * zoomRef.current;
        const dx = (ev.clientX - last.x) / scale;
        const dy = (ev.clientY - last.y) / scale;
        last = { x: ev.clientX, y: ev.clientY };
        setLayout((l) => slideOpening(l, kind, id, dx, dy));
      },
      onEnd: () => commit(),
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

  return {
    updateRoomDims,
    addDoor,
    updateDoor,
    deleteDoor,
    addWindow,
    updateWindow,
    deleteWindow,
    startOpeningDrag,
    nudgeOpening,
  };
}
