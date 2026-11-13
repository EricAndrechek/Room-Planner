import type { PointerEvent as ReactPointerEvent } from 'react';
import { doorStyles, windowStyles } from '../../lib/openings';
import type { Door, RoomDims, RoomWindow } from '../../types';

interface OpeningProps<T> {
  opening: T;
  room: RoomDims;
  isActive: boolean;
  /** Doors/windows are locked (no handle) while arranging furniture. */
  isLocked: boolean;
  onHandlePointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

export function DoorShape({ opening: door, room, isActive, isLocked, onHandlePointerDown }: OpeningProps<Door>) {
  const s = doorStyles(door, room);
  return (
    <>
      <div style={s.gap} />
      {/* Architectural jamb lines showing the wall break */}
      <div style={s.jamb1} />
      <div style={s.jamb2} />
      {!s.sliding && <div style={s.arc} />}
      {!s.sliding && <div style={s.panel} />}
      {s.sliding && <div style={s.track} />}
      {!isLocked && (
        <div
          style={{ ...s.handle, touchAction: 'none' }}
          className={`rounded-full transition-all ${isActive ? 'bg-indigo-500 ring-2 ring-indigo-300' : 'bg-slate-400 hover:bg-indigo-400'}`}
          onPointerDown={onHandlePointerDown}
          title="Drag to reposition door"
          aria-label="Door handle"
          data-draggable
        />
      )}
    </>
  );
}

export function WindowShape({ opening: win, room, isActive, isLocked, onHandlePointerDown }: OpeningProps<RoomWindow>) {
  const s = windowStyles(win, room);
  return (
    <>
      <div style={s.gap} />
      <div style={s.jamb1} />
      <div style={s.jamb2} />
      <div style={s.pane} />
      {!isLocked && (
        <div
          style={{ ...s.handle, touchAction: 'none' }}
          className={`rounded-full transition-all ${isActive ? 'bg-blue-500 ring-2 ring-blue-300' : 'bg-blue-400 hover:bg-blue-500'}`}
          onPointerDown={onHandlePointerDown}
          title="Drag to reposition window"
          aria-label="Window handle"
          data-draggable
        />
      )}
    </>
  );
}
