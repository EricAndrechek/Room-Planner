import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { Home, Sofa } from 'lucide-react';
import { DESIGN_MODES, PIXELS_PER_UNIT } from '../../lib/constants';
import { feetToDisplay, nudgeStep } from '../../core/units';
import type { ItemWarning } from '../../core/geometry';
import { doorsOf, mainRoom, roomSize, shownPieces, windowsOf } from '../../lib/plans';
import type { DesignMode, Id, Item, Opening, Plan, Selection, UnitSystem } from '../../types';
import { FurniturePiece } from './FurniturePiece';
import { DoorShape, WindowShape } from './Openings';

interface RoomCanvasProps {
  containerRef: RefObject<HTMLDivElement | null>;
  plan: Plan;
  warnings: Map<Id, ItemWarning>;
  selection: Selection | null;
  designMode: DesignMode;
  unitSystem: UnitSystem;
  zoom: number;
  pan: { x: number; y: number };
  showModeBadge: boolean;
  onSelectOpening: (type: 'door' | 'window', id: Id) => void;
  onItemPointerDown: (e: ReactPointerEvent<HTMLDivElement>, item: Item) => void;
  onRotatePointerDown: (e: ReactPointerEvent<HTMLDivElement>, item: Item) => void;
  onSelectItem: (item: Item) => void;
  /** Enter/Space on a piece while room setup locks furniture. */
  onLockedItemPress?: (item: Item) => void;
  onDoorPointerDown: (e: ReactPointerEvent<HTMLDivElement>, door: Opening) => void;
  onWindowPointerDown: (e: ReactPointerEvent<HTMLDivElement>, win: Opening) => void;
  /** Doors whose clearance to highlight (a piece being moved is in their way). */
  highlightDoorIds?: readonly Id[];
  /** Drawn inside the room, above the furniture (guides and measurements). */
  overlay?: ReactNode;
  /** Phones: the editor sheet covers the whole plan (full height); keep it out of reach. */
  covered?: boolean;
}

const GRID_STYLE = {
  backgroundImage:
    'linear-gradient(#ccc 1px, transparent 1px), linear-gradient(90deg, #ccc 1px, transparent 1px)',
  backgroundSize: `${PIXELS_PER_UNIT}px ${PIXELS_PER_UNIT}px`,
};

/** The zoomable/pannable floor plan. */
export function RoomCanvas({
  containerRef,
  plan,
  warnings,
  selection,
  designMode,
  unitSystem,
  zoom,
  pan,
  showModeBadge,
  onSelectOpening,
  onItemPointerDown,
  onRotatePointerDown,
  onSelectItem,
  onLockedItemPress,
  onDoorPointerDown,
  onWindowPointerDown,
  overlay,
  covered = false,
  highlightDoorIds = [],
}: RoomCanvasProps) {
  const room = mainRoom(plan);
  const roomDims = roomSize(room);
  const doors = doorsOf(room);
  const windows = windowsOf(room);
  const isRoomSetup = designMode === DESIGN_MODES.ROOM_SETUP;
  const isActive = (type: Selection['type'], id: Id) =>
    selection?.type === type && selection.id === id;

  return (
    <div
      className="flex-1 bg-slate-100 overflow-hidden relative w-full outline-hidden"
      ref={containerRef}
      id="floor-plan"
      role="main"
      aria-label="Floor plan"
      aria-describedby="floor-plan-help"
      tabIndex={-1}
      inert={covered}
      data-pan-area
    >
      <p id="floor-plan-help" className="sr-only">
        Press Tab to move between {isRoomSetup ? 'door and window handles' : 'furniture pieces'}.
        {isRoomSetup
          ? ' Arrow keys slide the focused opening along its wall; hold Shift for larger steps, Alt or Option for fine ones.'
          : ` Arrow keys move the focused piece by ${feetToDisplay(nudgeStep('normal', unitSystem), unitSystem)}; hold Shift for ${feetToDisplay(nudgeStep('coarse', unitSystem), unitSystem)}, or Alt or Option (or Control or Command) for ${feetToDisplay(nudgeStep('fine', unitSystem), unitSystem)} without snapping. With Snap on, a move that ends close to a wall or another piece lines up with it. R rotates it by 90 degrees, Shift and R rotates the other way; with Alt or Option, by 1 degree. Delete removes it. Escape deselects.`}
        {isRoomSetup ? ' Delete removes the focused door or window.' : ''} Control or Command with Z
        undoes.
      </p>
      {showModeBadge && (
        <div
          // One line on any phone: no wrapping (an absolute box at left: 50% would otherwise shrink
          // to half the width), truncated with an ellipsis if it still does not fit.
          data-testid="mode-badge"
          className={`absolute top-4 left-1/2 -translate-x-1/2 max-w-[calc(100%-1.5rem)] truncate whitespace-nowrap px-3 sm:px-4 py-2 rounded-full shadow-lg text-[11px] sm:text-xs z-20 pointer-events-none animate-fade-in backdrop-blur-xs ${
            isRoomSetup ? 'bg-indigo-600/90 text-white' : 'bg-emerald-700/90 text-white'
          }`}
        >
          {isRoomSetup ? (
            <>
              <Home className="w-3 h-3 inline mr-1 -mt-0.5" />
              <span className="hidden sm:inline">
                Room Setup Mode • Furniture locked • Drag door/window handles to move them
              </span>
              <span className="sm:hidden">Room setup · furniture locked</span>
            </>
          ) : (
            <>
              <Sofa className="w-3 h-3 inline mr-1 -mt-0.5" />
              <span className="hidden sm:inline">
                Furniture Mode • Drag to move • Handle to rotate
              </span>
              <span className="sm:hidden">Drag to move • Handle to rotate</span>
            </>
          )}
        </div>
      )}

      {/* Room - centered, panned by translate and zoomed by scale */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        data-pan-area
      >
        <div
          className="bg-white shadow-2xl relative shrink-0"
          style={{
            width: roomDims.width * PIXELS_PER_UNIT,
            height: roomDims.height * PIXELS_PER_UNIT,
            border: '4px solid #334155',
            // The walls sit outside the floor: the interior is exactly the room size, so (0, 0) and
            // (width, height) are the walls' inner faces (where furniture is flush and openings sit).
            boxSizing: 'content-box',
            transform: `scale(${zoom})`,
            transformOrigin: 'center',
          }}
          data-testid="room"
        >
          <div className="absolute inset-0 pointer-events-none opacity-20" style={GRID_STYLE} />

          {doors.map((door) => (
            <DoorShape
              key={door.id}
              opening={door}
              room={room}
              isActive={isActive('door', door.id)}
              isLocked={!isRoomSetup}
              unitSystem={unitSystem}
              zoom={zoom}
              onSelect={() => onSelectOpening('door', door.id)}
              onHandlePointerDown={(e) => onDoorPointerDown(e, door)}
              highlight={highlightDoorIds.includes(door.id)}
            />
          ))}
          {windows.map((win) => (
            <WindowShape
              key={win.id}
              opening={win}
              room={room}
              isActive={isActive('window', win.id)}
              isLocked={!isRoomSetup}
              unitSystem={unitSystem}
              zoom={zoom}
              onSelect={() => onSelectOpening('window', win.id)}
              onHandlePointerDown={(e) => onWindowPointerDown(e, win)}
            />
          ))}

          {shownPieces(plan).map((item) => (
            <FurniturePiece
              key={item.id}
              item={item}
              warning={warnings.get(item.id)}
              isActive={isActive('item', item.id)}
              modeLocked={isRoomSetup}
              unitSystem={unitSystem}
              onPointerDown={onItemPointerDown}
              onRotatePointerDown={onRotatePointerDown}
              onSelect={onSelectItem}
              onLockedPress={onLockedItemPress}
              // Only the selected piece draws zoom-dependent UI (its rotate handle): others keep
              // their memoized render while zooming.
              zoom={isActive('item', item.id) ? zoom : 1}
            />
          ))}
          {overlay}
        </div>
      </div>
    </div>
  );
}
