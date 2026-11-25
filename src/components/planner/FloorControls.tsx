import { Scan, X } from 'lucide-react';
import { roomName } from '../../core/floor';
import type { Id, Plan } from '../../types';

/**
 * Several rooms: one chip per room to zoom to it (and edit it), and one for the whole floor. Over
 * the plan: at the top on phones (under the mode badge), at the bottom on wide screens.
 */
export function RoomChips({
  plan,
  activeRoomId,
  focused,
  onRoom,
  onFloor,
  placement,
}: {
  plan: Plan;
  activeRoomId: Id;
  /** The room zoomed to, or null for the whole floor. */
  focused: Id | null;
  onRoom: (id: Id) => void;
  onFloor: () => void;
  placement: 'top' | 'bottom';
}) {
  const chip = (on: boolean) =>
    `shrink-0 flex items-center gap-1 px-3 min-h-9 rounded-full text-xs font-medium shadow-sm ring-1 transition-colors ${
      on
        ? 'bg-slate-900 text-white ring-slate-900'
        : 'bg-white/95 text-slate-700 ring-slate-200 hover:bg-white'
    }`;
  return (
    <nav
      aria-label="Rooms"
      className={`absolute inset-x-0 z-30 flex justify-center px-3 pointer-events-none ${
        placement === 'top' ? 'top-14' : 'bottom-4'
      }`}
      data-testid="room-chips"
    >
      <div className="flex gap-1.5 overflow-x-auto max-w-full pointer-events-auto p-0.5 [scrollbar-width:none]">
        <button
          type="button"
          onClick={onFloor}
          className={chip(focused === null)}
          aria-pressed={focused === null}
          data-chip="floor"
        >
          <Scan className="w-3.5 h-3.5" aria-hidden="true" />
          Whole floor
        </button>
        {plan.rooms.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onRoom(r.id)}
            className={chip(focused === r.id)}
            aria-pressed={focused === r.id}
            aria-current={r.id === activeRoomId ? 'true' : undefined}
            data-chip={r.id}
          >
            {roomName(plan, r)}
          </button>
        ))}
      </div>
    </nav>
  );
}

/**
 * Tap-to-place: what to do now, a way out, and the keyboard's way in (a free spot). Over the top
 * of the plan; announced when it appears.
 */
export function PlacementBanner({
  name,
  onFreeSpot,
  onCancel,
  touch,
}: {
  name: string;
  onFreeSpot: () => void;
  onCancel: () => void;
  touch: boolean;
}) {
  return (
    <div
      className="absolute top-3 inset-x-3 z-40 flex justify-center pointer-events-none"
      data-testid="placement-banner"
    >
      <div
        role="region"
        aria-label="Placing a piece"
        className="pointer-events-auto flex items-center gap-1 max-w-full pl-4 pr-1.5 py-1.5 rounded-full bg-slate-900/95 text-white shadow-xl ring-1 ring-white/10 animate-fade-in"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <p className="min-w-0 truncate text-sm font-medium mr-1" aria-live="polite">
          {touch ? 'Tap' : 'Click'} where {name} goes
        </p>
        <button
          type="button"
          onClick={onFreeSpot}
          className="shrink-0 px-3 min-h-9 rounded-full text-xs font-semibold text-emerald-200 hover:bg-white/10"
        >
          Find a spot
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 flex items-center gap-1 px-3 min-h-9 rounded-full text-xs font-semibold bg-white/15 hover:bg-white/25"
          data-testid="placement-cancel"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
          Cancel
        </button>
      </div>
    </div>
  );
}
