import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  DoorOpen,
  Home,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import { doorConnections, neighbourOf, roomName, sharedLength } from '../../core/floor';
import { useId } from 'react';
import { glowClass, useCardHighlight } from '../../hooks/useCardHighlight';
import type { AddedOpening } from '../../hooks/useOpenings';
import { DOOR_TYPES, WALL_OPTIONS } from '../../lib/constants';
import { isRectangle, lShapeOf, wallLength, type LShape } from '../../core/geometry/walls';
import {
  doorSwingAngle,
  hasHingeSide,
  isSwingDoor,
  type DoorType,
} from '../../core/geometry/doors';
import { feetToDisplay } from '../../core/units';
import type { OpeningPatch, ShapeChoice } from '../../lib/edits';
import { areaText, floorArea, openingPlace, roomSize, wallLabel } from '../../lib/plans';
import type { Id, Opening, Plan, Room, RoomDims, UnitSystem } from '../../types';
import { RoomsList, type RoomsListProps } from './RoomsList';
import { DimensionInput } from './DimensionInput';
import { RoomShapeFields } from './RoomShapeFields';
import { StepHeader } from './StepHeader';
import { Segmented } from './Segmented';

interface RoomSetupPanelProps {
  isActiveMode: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onActivate: () => void;
  onContinue: () => void;
  /** The whole floor (for the rooms list and the doors between rooms). */
  plan: Plan;
  /** The rooms list and what it does. */
  rooms: Omit<RoomsListProps, 'plan' | 'unitSystem'>;
  room: Room;
  doors: Opening[];
  windows: Opening[];
  unitSystem: UnitSystem;
  onRoomDimsChange: (dims: RoomDims) => void;
  /** Rectangle, L-shape or Custom (see `useRoomShape`). */
  shape: ShapeChoice;
  onShapeChange: (shape: ShapeChoice) => void;
  onLShapeChange: (l: LShape) => void;
  /** False if the wall cannot have that length (walls would cross). */
  onWallLengthChange: (wall: number, length: number) => boolean;
  highlightedWall: number | null;
  onHighlightWall: (wall: number | null) => void;
  onAddDoor: () => void;
  onUpdateDoor: (id: Id, updates: OpeningPatch) => void;
  onDeleteDoor: (id: Id) => void;
  onAddWindow: () => void;
  onUpdateWindow: (id: Id, updates: OpeningPatch) => void;
  onDeleteWindow: (id: Id) => void;
  /** Move a door/window to another wall (at a free spot there). */
  onChangeWall: (type: 'door' | 'window', id: Id, wall: number) => void;
  /** The door/window just added: its card is scrolled into view and briefly highlighted. */
  highlight?: AddedOpening | null;
}

/** What a door's `hinge` setting is called for its type. */
const hingeWord = (type: DoorType | undefined) =>
  type === 'bifold' ? 'Folds to' : type === 'pocket' ? 'Pocket' : 'Hinge';

/** A rectangle's walls by name (walls 0 to 3), for the segmented wall control. */
const WALL_SEGMENTS = WALL_OPTIONS.map((w, i) => ({
  value: String(i),
  label: w.charAt(0).toUpperCase() + w.slice(1),
}));

/**
 * Which wall a door or window is on: on a rectangle the four names in a segmented control, on
 * any other outline a list of its walls with their lengths ("Wall 3 · 9'").
 */
function WallPicker({
  room,
  label,
  value,
  unitSystem,
  onChange,
  ring,
  activeText,
  selectClass,
}: {
  room: Room;
  label: string;
  value: number;
  unitSystem: UnitSystem;
  onChange: (wall: number) => void;
  ring?: string;
  activeText?: string;
  selectClass: string;
}) {
  if (isRectangle(room)) {
    return (
      <Segmented
        label={label}
        options={WALL_SEGMENTS}
        value={String(value)}
        onChange={(w) => onChange(Number(w))}
        ring={ring}
        activeText={activeText}
      />
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`${selectClass} bg-white`}
      aria-label={label}
      data-testid="wall-select"
    >
      {room.outline.map((_, w) => (
        <option key={w} value={w}>
          {wallLabel(room, w)} · {feetToDisplay(wallLength(room, w), unitSystem)}
        </option>
      ))}
    </select>
  );
}
const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? 's' : ''}`;

/** Step 1 group in the sidebar: room size, doors and windows. */
export function RoomSetupPanel(props: RoomSetupPanelProps) {
  const { isActiveMode, expanded, room, doors, windows, unitSystem, plan } = props;
  const several = plan.rooms.length > 1;
  const name = roomName(plan, room);
  // Doors listed by another room that open into this one (drawn once, edited in their room).
  const incoming = several ? doorConnections(plan).filter((c) => c.other.id === room.id) : [];
  const roomDims: RoomDims = roomSize(room);
  const { register, isHighlighted } = useCardHighlight(props.highlight);
  const l = lShapeOf(room);
  // Ids for the visible field labels (`htmlFor`), unique per panel and per door/window row.
  const uid = useId();
  const fid = (...parts: (string | number)[]) => [uid, ...parts].join('-');
  const glow = glowClass;
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
      <StepHeader
        isActive={isActiveMode}
        expanded={expanded}
        onToggleExpanded={props.onToggleExpanded}
        icon={<Home className="w-4 h-4" />}
        title="Room Setup"
        summary={
          several ? (
            <>
              {`${plan.rooms.length} rooms • `}
              <span translate="no">{areaText(floorArea(plan), unitSystem)}</span>
            </>
          ) : (
            // Whole text nodes (not fragments a translator can split), sizes kept untranslated.
            <>
              {isRectangle(room) ? '' : l ? 'L-shape ' : `${room.outline.length} walls, `}
              <span translate="no">{`${feetToDisplay(roomDims.width, unitSystem)} × ${feetToDisplay(roomDims.height, unitSystem)}`}</span>
              {` • ${plural(doors.length, 'door')} • ${plural(windows.length, 'window')}`}
            </>
          )
        }
        activeIcon="bg-indigo-100 text-indigo-600"
        activeText="text-indigo-700"
        activeDot="bg-indigo-500"
      />

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
          <RoomsList plan={plan} unitSystem={unitSystem} {...props.rooms} />
          {several && (
            <h2
              className="flex items-center gap-2 text-sm font-semibold text-slate-800 border-t border-slate-100 pt-4"
              data-testid="editing-room"
            >
              {name}
            </h2>
          )}
          <RoomShapeFields
            room={room}
            shape={props.shape}
            unitSystem={unitSystem}
            inputClass={inputClass}
            smallInputClass={smallInput('focus:ring-indigo-500')}
            onShapeChange={props.onShapeChange}
            onRoomDimsChange={props.onRoomDimsChange}
            onLShapeChange={props.onLShapeChange}
            onWallLengthChange={props.onWallLengthChange}
            highlightedWall={props.highlightedWall}
            onHighlightWall={props.onHighlightWall}
          />

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
                const place = openingPlace(room, door);
                const wallLen = wallLength(room, place.wall);
                const card = { type: 'door', id: door.id } as const;
                const lit = isHighlighted(card);
                const other = several ? neighbourOf(plan, room, door) : null;
                const into =
                  other && isSwingDoor(door.type)
                    ? door.type === 'swing-out' || door.type === 'double-out'
                      ? roomName(plan, other)
                      : name
                    : null;
                return (
                  <div
                    key={door.id}
                    ref={register(card)}
                    className={`p-3 bg-white rounded-lg border border-slate-200 ${glow(lit, 'ring-indigo-400')}`}
                    data-testid="door-card"
                    data-highlighted={lit || undefined}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <span className="flex items-center gap-1.5 min-w-0 text-xs font-medium text-slate-700">
                        Door {index + 1}
                        {other && (
                          <span
                            className="truncate rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700"
                            data-testid="door-connects"
                          >
                            {name} ↔ {roomName(plan, other)}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => props.onDeleteDoor(door.id)}
                        className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors flex items-center justify-center"
                        aria-label="Delete door"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="mb-2">
                      <span className="block text-[10px] text-slate-500 mb-1" aria-hidden="true">
                        Wall
                      </span>
                      <WallPicker
                        room={room}
                        label={`Door ${index + 1} wall`}
                        value={place.wall}
                        unitSystem={unitSystem}
                        onChange={(wall) => props.onChangeWall('door', door.id, wall)}
                        selectClass={smallInput('focus:ring-indigo-500')}
                      />
                    </div>
                    <div className="mb-2">
                      <label
                        htmlFor={fid('door', index, 'type')}
                        className="block text-[10px] text-slate-500 mb-1"
                      >
                        Type
                      </label>
                      <select
                        id={fid('door', index, 'type')}
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
                      {into && (
                        <p
                          className="mt-1 text-[10px] text-slate-600"
                          data-testid="door-opens-into"
                        >
                          Opens into {into}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label
                          htmlFor={fid('door', index, 'width')}
                          className="block text-[10px] text-slate-500 mb-1"
                        >
                          Width
                        </label>
                        <DimensionInput
                          id={fid('door', index, 'width')}
                          value={place.width}
                          onChange={(val) => props.onUpdateDoor(door.id, { width: val })}
                          className={smallInput('focus:ring-indigo-500')}
                          min={1}
                          max={wallLen}
                          label="Door width"
                          unitSystem={unitSystem}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={fid('door', index, 'position')}
                          className="block text-[10px] text-slate-500 mb-1"
                        >
                          Position
                        </label>
                        <DimensionInput
                          id={fid('door', index, 'position')}
                          value={place.position}
                          onChange={(val) => props.onUpdateDoor(door.id, { position: val })}
                          className={smallInput('focus:ring-indigo-500')}
                          min={0}
                          max={Math.max(0, wallLen - place.width)}
                          label="Door position"
                          unitSystem={unitSystem}
                        />
                      </div>
                    </div>

                    {(hasHingeSide(door.type) || isSwingDoor(door.type)) && (
                      <div className="flex gap-2">
                        {hasHingeSide(door.type) && (
                          <button
                            type="button"
                            onClick={() =>
                              props.onUpdateDoor(door.id, {
                                hinge: place.hinge === 'left' ? 'right' : 'left',
                              })
                            }
                            className="flex-1 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 rounded-sm text-[10px] font-medium text-slate-600 flex items-center justify-center gap-1 transition-colors"
                          >
                            <ArrowLeftRight className="w-3 h-3" aria-hidden="true" />{' '}
                            {hingeWord(door.type)}: {place.hinge === 'left' ? 'Left' : 'Right'}
                          </button>
                        )}
                        {isSwingDoor(door.type) && (
                          <div
                            role="radiogroup"
                            aria-label={`Door ${index + 1} opens`}
                            className="flex-1 flex bg-slate-100 rounded-sm p-0.5"
                          >
                            {([90, 180] as const).map((angle) => {
                              const on = doorSwingAngle(door) === angle;
                              return (
                                <button
                                  key={angle}
                                  type="button"
                                  role="radio"
                                  aria-checked={on}
                                  title={
                                    angle === 90
                                      ? 'Opens to 90°'
                                      : 'Opens to 180°, flat against the wall'
                                  }
                                  onClick={() =>
                                    props.onUpdateDoor(door.id, {
                                      swingAngle: angle === 180 ? 180 : undefined,
                                    })
                                  }
                                  className={`flex-1 py-1 text-[10px] font-medium rounded-sm transition-colors ${
                                    on
                                      ? 'bg-white text-indigo-700 shadow-xs'
                                      : 'text-slate-600 hover:text-slate-800'
                                  }`}
                                >
                                  {angle}°
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {doors.length === 0 && incoming.length === 0 && (
                <div className="text-center py-3 text-slate-500 text-xs italic border-2 border-dashed border-slate-200 rounded-lg">
                  No doors added yet
                </div>
              )}
              {incoming.map((c) => (
                <div
                  key={c.door.id}
                  className="flex items-center gap-2 p-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-600"
                  data-testid="incoming-door"
                >
                  <DoorOpen className="w-3.5 h-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    A door from {roomName(plan, c.room)} opens here.
                  </span>
                  <button
                    type="button"
                    onClick={() => props.rooms.onSelect(c.room.id)}
                    className="shrink-0 px-2 py-1 rounded-sm font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    Edit in {roomName(plan, c.room)}
                  </button>
                </div>
              ))}
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
                const place = openingPlace(room, win);
                const wallLen = wallLength(room, place.wall);
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
                    {several && sharedLength(plan, room, win) > 1e-3 && (
                      <p
                        className="mb-2 flex items-start gap-1.5 rounded-sm border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-900"
                        data-testid="window-shared-wall"
                      >
                        <AlertTriangle className="w-3 h-3 shrink-0 mt-px" aria-hidden="true" />
                        This wall is shared with{' '}
                        {roomName(plan, neighbourOf(plan, room, win) ?? room)}: windows belong on
                        outside walls.
                      </p>
                    )}
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

                    <div className="mb-2">
                      <span className="block text-[10px] text-slate-500 mb-1" aria-hidden="true">
                        Wall
                      </span>
                      <WallPicker
                        room={room}
                        label={`Window ${index + 1} wall`}
                        value={place.wall}
                        unitSystem={unitSystem}
                        onChange={(wall) => props.onChangeWall('window', win.id, wall)}
                        ring="focus-visible:ring-blue-500"
                        activeText="text-blue-700"
                        selectClass={smallInput('focus:ring-blue-500')}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label
                          htmlFor={fid('window', index, 'width')}
                          className="block text-[10px] text-slate-500 mb-1"
                        >
                          Width
                        </label>
                        <DimensionInput
                          id={fid('window', index, 'width')}
                          value={place.width}
                          onChange={(val) => props.onUpdateWindow(win.id, { width: val })}
                          className={smallInput('focus:ring-blue-500')}
                          min={0.5}
                          max={wallLen}
                          label="Window width"
                          unitSystem={unitSystem}
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={fid('window', index, 'position')}
                          className="block text-[10px] text-slate-500 mb-1"
                        >
                          Position
                        </label>
                        <DimensionInput
                          id={fid('window', index, 'position')}
                          value={place.position}
                          onChange={(val) => props.onUpdateWindow(win.id, { position: val })}
                          className={smallInput('focus:ring-blue-500')}
                          min={0}
                          max={Math.max(0, wallLen - place.width)}
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
