import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { DOOR_TYPES, PIXELS_PER_UNIT } from '../../lib/constants';
import { SWING_ARC_STROKE, doorStyles, doorSvg, windowStyles } from '../../lib/openings';
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
/** Touch screens: the hit area around a handle (`.touch-hit`), on screen. */
const TOUCH_TARGET_PX = 44;
const handleScale = (handle: { width?: unknown }, zoom: number) => {
  const size = typeof handle.width === 'number' ? handle.width : MIN_HANDLE_PX;
  const scale = Math.max(1, MIN_HANDLE_PX / (size * zoom));
  return {
    transform: `scale(${scale})`,
    // In the handle's own (scaled) pixels, so the touch hit area is 44 screen px at any zoom.
    '--hit': `${TOUCH_TARGET_PX / (scale * zoom)}px`,
  } as CSSProperties;
};

const handleLabel = (
  kind: 'Door' | 'Window',
  o: { wall: string; position: number; width: number; type?: string },
  unitSystem: UnitSystem,
) =>
  `${kind} handle${o.type ? ` (${DOOR_TYPES.find((t) => t.value === o.type)?.label ?? o.type})` : ''}, ${feetToDisplay(o.width, unitSystem)} wide on the ${o.wall} wall, ${feetToDisplay(o.position, unitSystem)} along the wall. Arrow keys slide it.`;

export function DoorShape({
  opening: door,
  room,
  isActive,
  isLocked,
  unitSystem,
  zoom,
  onSelect,
  onHandlePointerDown,
  highlight = false,
}: OpeningProps<Door> & { highlight?: boolean }) {
  const s = doorStyles(door, room);
  const d = doorSvg(door, room);
  return (
    <>
      <div style={s.gap} />
      {/* Architectural jamb lines showing the wall break */}
      <div style={s.jamb1} />
      <div style={s.jamb2} />
      {/* The door itself (leaves, arcs, panels, pocket), drawn from the shared door geometry. */}
      <svg
        className="absolute left-0 top-0 overflow-visible pointer-events-none"
        width={room.width * PIXELS_PER_UNIT}
        height={room.height * PIXELS_PER_UNIT}
        aria-hidden="true"
        data-door-swing
        data-door-type={door.type || 'swing-in'}
        data-blocked={highlight ? 'true' : undefined}
      >
        {highlight && (
          // A piece is being moved into this door's way: show the area it needs.
          <g
            fill="#f59e0b"
            fillOpacity={0.22}
            stroke="#d97706"
            strokeWidth={1.5}
            strokeDasharray="5 3"
          >
            {d.clearance.map((c, i) => (
              <path key={i} d={c} />
            ))}
            <path d={d.doorway} fillOpacity={0.12} />
          </g>
        )}
        <g opacity={0.5}>
          {d.arcs.map((a, i) => (
            <path key={i} d={a} fill="none" {...SWING_ARC_STROKE} />
          ))}
        </g>
        {d.panels.map((p, i) => (
          <path key={i} d={p} fill="#cbd5e1" stroke="#64748b" strokeWidth={1} />
        ))}
        {d.pocket && (
          // A light dashed line along the (dark) wall: the cavity the door slides into.
          <path d={d.pocket} stroke="#e2e8f0" strokeWidth={2} strokeDasharray="5 3" />
        )}
      </svg>
      {!isLocked && (
        <div
          style={{ ...s.handle, ...handleScale(s.handle, zoom), touchAction: 'none' }}
          className={`touch-hit rounded-full transition-all ${isActive ? 'bg-indigo-500 ring-2 ring-indigo-300' : 'bg-slate-400 hover:bg-indigo-400'}`}
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
          className={`touch-hit rounded-full transition-all ${isActive ? 'bg-blue-500 ring-2 ring-blue-300' : 'bg-blue-400 hover:bg-blue-500'}`}
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
