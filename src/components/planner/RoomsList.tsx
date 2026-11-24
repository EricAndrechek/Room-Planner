import { useId, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { floorBounds, roomName } from '../../core/floor';
import { roomBounds } from '../../core/geometry/walls';
import { feetToDisplay } from '../../core/units';
import { areaText, floorArea, roomArea, roomSize } from '../../lib/plans';
import type { Id, Plan, UnitSystem } from '../../types';
import { DimensionInput } from './DimensionInput';
import { Tooltip } from './Tooltip';

export interface RoomsListProps {
  plan: Plan;
  activeRoomId: Id;
  unitSystem: UnitSystem;
  onSelect: (id: Id) => void;
  onAdd: () => void;
  onDuplicate: (id: Id) => void;
  onDelete: (id: Id) => void;
  onRename: (id: Id, name: string) => void;
  /** The room's top-left from the floor's; false if it cannot go there (it would overlap). */
  onPosition: (id: Id, at: { x?: number; y?: number }) => boolean;
}

/** A room's name, typed in place (kept while typing, saved on blur or Enter). */
function NameField({
  id,
  value,
  placeholder,
  onSave,
}: {
  id: string;
  value: string;
  placeholder: string;
  onSave: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // The name changed elsewhere (undo, another plan): show it.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
  }
  return (
    <input
      id={id}
      value={draft}
      placeholder={placeholder}
      maxLength={80}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onSave(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className="w-full p-1.5 text-sm border border-slate-200 rounded-sm focus:ring-2 focus:ring-indigo-500 outline-hidden"
      data-testid="room-name"
    />
  );
}

/**
 * The rooms of the floor, at the top of Room Setup: pick the one to edit, name it, place it, copy
 * or delete it, and add another beside it. Everything below (shape, size, doors, windows) edits the
 * picked room.
 */
export function RoomsList({
  plan,
  activeRoomId,
  unitSystem,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
  onRename,
  onPosition,
}: RoomsListProps) {
  const uid = useId();
  const several = plan.rooms.length > 1;
  const f = floorBounds(plan);
  const len = (v: number) => feetToDisplay(v, unitSystem);
  return (
    // A plain <div>: a <section> or a group labelled by its heading here crashed Firefox's content
    // process when axe or a focus change walked Room Setup (reproduced with Firefox 159 under
    // Playwright, 2026-11-24). The heading still names the part for screen readers.
    <div data-testid="rooms-list">
      <div className="flex justify-between items-center mb-2">
        <h2 id={`${uid}-h`} className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          Rooms
        </h2>
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-2 py-1 rounded-sm font-medium transition-colors"
          data-testid="add-room"
        >
          <Plus className="w-3 h-3" aria-hidden="true" /> Add room
        </button>
      </div>
      <ul className="space-y-1.5">
        {plan.rooms.map((r) => {
          const on = r.id === activeRoomId;
          const name = roomName(plan, r);
          const size = roomSize(r);
          const area = areaText(roomArea(r), unitSystem);
          const b = roomBounds(r);
          return (
            <li
              key={r.id}
              className={`rounded-lg border transition-colors ${on ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-200 bg-white'}`}
              data-room-row={r.id}
              data-active={on || undefined}
            >
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                aria-pressed={on}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left rounded-lg focus-visible:ring-2 focus-visible:ring-indigo-500 outline-hidden"
                data-testid="room-row"
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${on ? 'bg-indigo-600' : 'border-2 border-slate-300'}`}
                  aria-hidden="true"
                />
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-slate-800">
                  {name}
                </span>
                <span className="shrink-0 text-[11px] text-slate-600 tabular-nums">
                  {len(size.width)} × {len(size.height)} · {area}
                </span>
              </button>
              {on && (
                <div className="px-2.5 pb-2.5 space-y-2">
                  <div>
                    <label
                      htmlFor={`${uid}-${r.id}-name`}
                      className="block text-[10px] text-slate-500 mb-1"
                    >
                      Name
                    </label>
                    <NameField
                      id={`${uid}-${r.id}-name`}
                      value={r.name ?? ''}
                      placeholder={name}
                      onSave={(v) => onRename(r.id, v)}
                    />
                  </div>
                  {several && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label
                          htmlFor={`${uid}-${r.id}-x`}
                          className="block text-[10px] text-slate-500 mb-1"
                        >
                          From the left
                        </label>
                        <DimensionInput
                          id={`${uid}-${r.id}-x`}
                          value={b.left - f.left}
                          onChange={(v) => onPosition(r.id, { x: v })}
                          className="w-full p-1.5 text-xs border border-slate-200 rounded-sm focus:ring-2 focus:ring-indigo-500 outline-hidden"
                          min={-1000}
                          max={1000}
                          label={`${name}: distance from the left of the floor`}
                          unitSystem={unitSystem}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`${uid}-${r.id}-y`}
                          className="block text-[10px] text-slate-500 mb-1"
                        >
                          From the top
                        </label>
                        <DimensionInput
                          id={`${uid}-${r.id}-y`}
                          value={b.top - f.top}
                          onChange={(v) => onPosition(r.id, { y: v })}
                          className="w-full p-1.5 text-xs border border-slate-200 rounded-sm focus:ring-2 focus:ring-indigo-500 outline-hidden"
                          min={-1000}
                          max={1000}
                          label={`${name}: distance from the top of the floor`}
                          unitSystem={unitSystem}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-end gap-1">
                    <Tooltip text="Duplicate room">
                      <button
                        type="button"
                        onClick={() => onDuplicate(r.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                        aria-label={`Duplicate ${name}`}
                      >
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Duplicate
                      </button>
                    </Tooltip>
                    {several && (
                      <Tooltip text="Delete room (its furniture is set aside)">
                        <button
                          type="button"
                          onClick={() => onDelete(r.id)}
                          className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 transition-colors"
                          aria-label={`Delete ${name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {several && (
        <p className="mt-2 text-right text-[11px] text-slate-600" data-testid="floor-total">
          {plan.rooms.length} rooms · {areaText(floorArea(plan), unitSystem)} in all
        </p>
      )}
    </div>
  );
}
