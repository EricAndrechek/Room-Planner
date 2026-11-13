import type { PointerEvent as ReactPointerEvent } from 'react';
import { doorStyles, windowStyles } from '../../lib/openings';
import { feetToDisplay } from '../../lib/units';
import type { Door, RoomDims, RoomWindow, UnitSystem } from '../../types';

interface OpeningProps<T> {
  opening: T;
  room: RoomDims;
  isActive: boolean;
  /** Doors/windows are locked (no handle) while arranging furniture. */
  isLocked: boolean;
  unitSystem: UnitSystem;
  /** Canvas zoom; handles are enlarged so they stay at least 24 CSS px on screen. */
  zoom: number;
  /** Keyboard focus selects the opening (mirrors a pointer press). */
  onSelect: () => void;
  onHandlePointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

/** Minimum on-screen handle size (WCAG 2.5.8 target size). */
const MIN_HANDLE_PX = 24;
const handleScale = (handle: { width?: unknown }, zoom: number) => {
  const size = typeof handle.width === 'number' ? handle.width : MIN_HANDLE_PX;
  return { transform: `scale(${Math.max(1, MIN_HANDLE_PX / (size * zoom))})` };
};

const handleLabel = (
  kind: 'Door' | 'Window',
  o: { wall: string; position: number; width: number },
  unitSystem: UnitSystem,
) =>
  `${kind} handle, ${feetToDisplay(o.width, unitSystem)} wide on the ${o.wall} wall, ${feetToDisplay(o.position, unitSystem)} along the wall. Arrow keys slide it.`;

export function DoorShape({
  opening: door,
  room,
  isActive,
  isLocked,
  unitSystem,
  zoom,
  onSelect,
  onHandlePointerDown,
}: OpeningProps<Door>) {
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
          style={{ ...s.handle, ...handleScale(s.handle, zoom), touchAction: 'none' }}
          className={`rounded-full transition-all ${isActive ? 'bg-indigo-500 ring-2 ring-indigo-300' : 'bg-slate-400 hover:bg-indigo-400'}`}
          onPointerDown={onHandlePointerDown}
          onFocus={onSelect}
          title="Drag to reposition door"
          role="button"
          tabIndex={0}
          aria-pressed={isActive}
          aria-label={handleLabel('Door', door, unitSystem)}
          data-draggable
        />
      )}
    </>
  );
}

export function WindowShape({
  opening: win,
  room,
  isActive,
  isLocked,
  unitSystem,
  zoom,
  onSelect,
  onHandlePointerDown,
}: OpeningProps<RoomWindow>) {
  const s = windowStyles(win, room);
  return (
    <>
      <div style={s.gap} />
      <div style={s.jamb1} />
      <div style={s.jamb2} />
      <div style={s.pane} />
      {!isLocked && (
        <div
          style={{ ...s.handle, ...handleScale(s.handle, zoom), touchAction: 'none' }}
          className={`rounded-full transition-all ${isActive ? 'bg-blue-500 ring-2 ring-blue-300' : 'bg-blue-400 hover:bg-blue-500'}`}
          onPointerDown={onHandlePointerDown}
          onFocus={onSelect}
          title="Drag to reposition window"
          role="button"
          tabIndex={0}
          aria-pressed={isActive}
          aria-label={handleLabel('Window', win, unitSystem)}
          data-draggable
        />
      )}
    </>
  );
}
