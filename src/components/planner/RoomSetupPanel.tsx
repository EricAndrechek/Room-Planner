import {
  ArrowLeftRight,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Home,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AddedOpening } from '../../hooks/useOpenings';
import { prefersReducedMotion } from '../../lib/browser';
import { DOOR_TYPES, WALL_OPTIONS } from '../../lib/constants';
import { wallLength } from '../../lib/geometry';
import { feetToDisplay, formatArea } from '../../lib/units';
import type { Door, DoorType, Id, RoomDims, RoomWindow, UnitSystem, Wall } from '../../types';
import { DimensionInput } from './DimensionInput';

interface RoomSetupPanelProps {
  isActiveMode: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onActivate: () => void;
  onContinue: () => void;
  roomDims: RoomDims;
  doors: Door[];
  windows: RoomWindow[];
  unitSystem: UnitSystem;
  onRoomDimsChange: (dims: RoomDims) => void;
  onAddDoor: () => void;
  onUpdateDoor: (id: Id, updates: Partial<Door>) => void;
  onDeleteDoor: (id: Id) => void;
  onAddWindow: () => void;
  onUpdateWindow: (id: Id, updates: Partial<RoomWindow>) => void;
  onDeleteWindow: (id: Id) => void;
  /** The door/window just added: its card is scrolled into view and briefly highlighted. */
  highlight?: AddedOpening | null;
}

/** How long a new door/window card stays highlighted. */
const HIGHLIGHT_MS = 1500;
const cardKey = (o: AddedOpening) => `${o.type}:${o.id}`;

/**
 * Bring the card of a just-added door/window into view (inside the sidebar, which
 * is the scrolling sheet on phones) and report whether it should still glow.
 */
function useCardHighlight(highlight: AddedOpening | null | undefined) {
  const cards = useRef(new Map<string, HTMLElement>());
  const [faded, setFaded] = useState<string | null>(null);
  const key = highlight ? cardKey(highlight) : null;

  useEffect(() => {
    if (!key) return;
    cards.current.get(key)?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    const timer = setTimeout(() => setFaded(key), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [key]);

  /** Ref callback registering a card under its key. */
  const register = (o: AddedOpening) => (el: HTMLElement | null) => {
    if (el) cards.current.set(cardKey(o), el);
    else cards.current.delete(cardKey(o));
  };
  const isHighlighted = (o: AddedOpening) => key === cardKey(o) && faded !== key;
  return { register, isHighlighted };
}

const wallLabel = (w: Wall) => w.charAt(0).toUpperCase() + w.slice(1);
const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? 's' : ''}`;

/** Step 1 group in the sidebar: room size, doors and windows. */
export function RoomSetupPanel(props: RoomSetupPanelProps) {
  const { isActiveMode, expanded, roomDims, doors, windows, unitSystem } = props;
  const { register, isHighlighted } = useCardHighlight(props.highlight);
  // Ring that fades out (transition) when the highlight ends; instant with reduced motion.
  const glow = (on: boolean, ring: string) =>
    `scroll-mt-20 scroll-mb-4 transition-shadow duration-700 ${on ? `ring-2 ${ring}` : ''}`;
  const inputClass =
    'w-full p-2 border border-slate-200 rounded-sm focus:ring-2 focus:ring-indigo-500 outline-hidden';
  const smallInput = (ring: string) =>
    `w-full p-1.5 text-xs border border-slate-200 rounded-sm focus:ring-2 ${ring} outline-hidden`;

  return (
    <div
      className={`rounded-xl border-2 transition-all duration-300 ${
        isActiveMode ? 'border-indigo-200 bg-white shadow-xs' : 'border-slate-200 bg-slate-50'
      }`}
    >
      {/* Group Header */}
      <button
        type="button"
        onClick={() => !isActiveMode && props.onToggleExpanded()}
        className={`w-full flex items-center justify-between p-3 ${
          !isActiveMode ? 'cursor-pointer hover:bg-slate-100' : 'cursor-default'
        } rounded-t-xl transition-colors`}
        aria-expanded={isActiveMode || expanded}
      >
        <div className="flex items-center gap-2">
          <div
            className={`p-1.5 rounded-lg ${isActiveMode ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-500'}`}
          >
            <Home className="w-4 h-4" />
          </div>
          <div className="text-left">
            <span className="text-sm font-semibold text-slate-700 block">Room Setup</span>
            <span className="text-[10px] text-slate-500">
              {feetToDisplay(roomDims.width, unitSystem)} ×{' '}
              {feetToDisplay(roomDims.height, unitSystem)} • {plural(doors.length, 'door')} •{' '}
              {plural(windows.length, 'window')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isActiveMode && (
            <>
              <span className="text-[10px] text-slate-500 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Locked
              </span>
              {expanded ? (
                <ChevronUp className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              )}
            </>
          )}
          {isActiveMode && (
            <span className="text-[10px] text-indigo-600 font-medium px-2 py-0.5 bg-indigo-100 rounded-full">
              Editing
            </span>
          )}
        </div>
      </button>

      {/* Unlock button when in furniture mode */}
      {!isActiveMode && expanded && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={props.onActivate}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-xs font-medium transition-colors"
          >
            <Unlock className="w-3 h-3" />
            Switch to Room Setup Mode
          </button>
        </div>
      )}

      {(isActiveMode || expanded) && (
        <div
          className={`p-4 pt-2 space-y-6 border-t border-slate-100 ${!isActiveMode ? 'opacity-60 pointer-events-none' : ''}`}
          inert={!isActiveMode}
        >
          {/* Room Dimensions */}
          <section>
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
              Room Dimensions
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Width</label>
                <DimensionInput
                  value={roomDims.width}
                  onChange={(val) => props.onRoomDimsChange({ ...roomDims, width: val })}
                  className={inputClass}
                  placeholder="e.g. 12"
                  min={1}
                  max={100}
                  label="Room width"
                  unitSystem={unitSystem}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Length</label>
                <DimensionInput
                  value={roomDims.height}
                  onChange={(val) => props.onRoomDimsChange({ ...roomDims, height: val })}
                  className={inputClass}
                  placeholder="e.g. 12"
                  min={1}
                  max={100}
                  label="Room length"
                  unitSystem={unitSystem}
                />
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Total area: <strong>{formatArea(roomDims.width, roomDims.height)}</strong>
            </div>
          </section>

          {/* Doors */}
          <section>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Doors</h2>
              <button
                type="button"
                onClick={props.onAddDoor}
                className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-2 py-1 rounded-sm font-medium transition-colors"
                aria-label="Add Door"
              >
                <Plus className="w-3 h-3" /> Add Door
              </button>
            </div>

            <div className="space-y-3">
              {doors.map((door, index) => {
                const wallLen = wallLength(roomDims, door.wall);
                const card = { type: 'door', id: door.id } as const;
                const lit = isHighlighted(card);
                return (
                  <div
                    key={door.id}
                    ref={register(card)}
                    className={`p-3 bg-white rounded-lg border border-slate-200 ${glow(lit, 'ring-indigo-400')}`}
                    data-testid="door-card"
                    data-highlighted={lit || undefined}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-medium text-slate-700">Door {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => props.onDeleteDoor(door.id)}
                        className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors flex items-center justify-center"
                        aria-label="Delete door"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Wall</label>
                        <select
                          value={door.wall}
                          onChange={(e) =>
                            props.onUpdateDoor(door.id, { wall: e.target.value as Wall })
                          }
                          className={`${smallInput('focus:ring-indigo-500')} bg-white`}
                          aria-label={`Door ${index + 1} wall`}
                        >
                          {WALL_OPTIONS.map((w) => (
                            <option key={w} value={w}>
                              {wallLabel(w)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Type</label>
                        <select
                          value={door.type}
                          onChange={(e) =>
                            props.onUpdateDoor(door.id, { type: e.target.value as DoorType })
                          }
                          className={`${smallInput('focus:ring-indigo-500')} bg-white`}
                          aria-label={`Door ${index + 1} type`}
                        >
                          {DOOR_TYPES.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Width</label>
                        <DimensionInput
                          value={door.width}
                          onChange={(val) => props.onUpdateDoor(door.id, { width: val })}
                          className={smallInput('focus:ring-indigo-500')}
                          min={1}
                          max={wallLen}
                          label="Door width"
                          unitSystem={unitSystem}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Position</label>
                        <DimensionInput
                          value={door.position}
                          onChange={(val) => props.onUpdateDoor(door.id, { position: val })}
                          className={smallInput('focus:ring-indigo-500')}
                          min={0}
                          max={Math.max(0, wallLen - door.width)}
                          label="Door position"
                          unitSystem={unitSystem}
                        />
                      </div>
                    </div>

                    {door.type !== 'sliding' && (
                      <button
                        type="button"
                        onClick={() =>
                          props.onUpdateDoor(door.id, {
                            hinge: door.hinge === 'left' ? 'right' : 'left',
                          })
                        }
                        className="w-full py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded-sm text-[10px] font-medium text-slate-600 flex items-center justify-center gap-1 transition-colors"
                      >
                        <ArrowLeftRight className="w-3 h-3" /> Hinge:{' '}
                        {door.hinge === 'left' ? 'Left' : 'Right'}
                      </button>
                    )}
                  </div>
                );
              })}

              {doors.length === 0 && (
                <div className="text-center py-3 text-slate-500 text-xs italic border-2 border-dashed border-slate-200 rounded-lg">
                  No doors added yet
                </div>
              )}
            </div>
          </section>

          {/* Windows */}
          <section>
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Windows</h2>
              <button
                type="button"
                onClick={props.onAddWindow}
                className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded-sm font-medium transition-colors"
                aria-label="Add Window"
              >
                <Plus className="w-3 h-3" /> Add Window
              </button>
            </div>

            <div className="space-y-3">
              {windows.map((win, index) => {
                const wallLen = wallLength(roomDims, win.wall);
                const card = { type: 'window', id: win.id } as const;
                const lit = isHighlighted(card);
                return (
                  <div
                    key={win.id}
                    ref={register(card)}
                    className={`p-3 bg-blue-50/30 rounded-lg border border-blue-100 ${glow(lit, 'ring-blue-400')}`}
                    data-testid="window-card"
                    data-highlighted={lit || undefined}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-medium text-slate-700">Window {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => props.onDeleteWindow(win.id)}
                        className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors flex items-center justify-center"
                        aria-label="Delete window"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Wall</label>
                        <select
                          value={win.wall}
                          onChange={(e) =>
                            props.onUpdateWindow(win.id, { wall: e.target.value as Wall })
                          }
                          className={`${smallInput('focus:ring-blue-500')} bg-white`}
                          aria-label={`Window ${index + 1} wall`}
                        >
                          {WALL_OPTIONS.map((w) => (
                            <option key={w} value={w}>
                              {wallLabel(w)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Width</label>
                        <DimensionInput
                          value={win.width}
                          onChange={(val) => props.onUpdateWindow(win.id, { width: val })}
                          className={smallInput('focus:ring-blue-500')}
                          min={0.5}
                          max={wallLen}
                          label="Window width"
                          unitSystem={unitSystem}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-1">Position</label>
                        <DimensionInput
                          value={win.position}
                          onChange={(val) => props.onUpdateWindow(win.id, { position: val })}
                          className={smallInput('focus:ring-blue-500')}
                          min={0}
                          max={Math.max(0, wallLen - win.width)}
                          label="Window position"
                          unitSystem={unitSystem}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              {windows.length === 0 && (
                <div className="text-center py-3 text-slate-500 text-xs italic border-2 border-dashed border-blue-100 rounded-lg">
                  No windows added yet
                </div>
              )}
            </div>
          </section>

          {isActiveMode && (
            <button
              type="button"
              onClick={props.onContinue}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-sm font-medium transition-colors shadow-xs"
            >
              Continue to Furniture
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
