import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { Home, Sofa } from 'lucide-react';
import { DESIGN_MODES, PIXELS_PER_UNIT } from '../../lib/constants';
import type { ItemWarning } from '../../lib/geometry';
import type {
  DesignMode,
  Door,
  FurnitureItem,
  Id,
  Layout,
  RoomWindow,
  Selection,
  UnitSystem,
} from '../../types';
import { FurniturePiece } from './FurniturePiece';
import { DoorShape, WindowShape } from './Openings';

interface RoomCanvasProps {
  containerRef: RefObject<HTMLDivElement | null>;
  layout: Layout;
  warnings: Map<Id, ItemWarning>;
  selection: Selection | null;
  designMode: DesignMode;
  unitSystem: UnitSystem;
  zoom: number;
  pan: { x: number; y: number };
  showModeBadge: boolean;
  onSelectOpening: (type: 'door' | 'window', id: Id) => void;
  onItemPointerDown: (e: ReactPointerEvent<HTMLDivElement>, item: FurnitureItem) => void;
  onRotatePointerDown: (e: ReactPointerEvent<HTMLDivElement>, item: FurnitureItem) => void;
  onSelectItem: (item: FurnitureItem) => void;
  onDoorPointerDown: (e: ReactPointerEvent<HTMLDivElement>, door: Door) => void;
  onWindowPointerDown: (e: ReactPointerEvent<HTMLDivElement>, win: RoomWindow) => void;
}

const GRID_STYLE = {
  backgroundImage:
    'linear-gradient(#ccc 1px, transparent 1px), linear-gradient(90deg, #ccc 1px, transparent 1px)',
  backgroundSize: `${PIXELS_PER_UNIT}px ${PIXELS_PER_UNIT}px`,
};

/** The zoomable/pannable floor plan. */
export function RoomCanvas({
  containerRef,
  layout,
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
  onDoorPointerDown,
  onWindowPointerDown,
}: RoomCanvasProps) {
  const { roomDims, doors, windows, items } = layout;
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
      data-pan-area
    >
      <p id="floor-plan-help" className="sr-only">
        Press Tab to move between {isRoomSetup ? 'door and window handles' : 'furniture pieces'}.
        {isRoomSetup
          ? ' Arrow keys slide the focused opening along its wall; hold Shift for larger steps.'
          : ' Arrow keys move the focused piece; hold Shift for larger steps. R rotates it by 90 degrees, Shift and R rotates the other way. Delete removes it. Escape deselects.'}{' '}
        Control or Command with Z undoes.
      </p>
      {showModeBadge && (
        <div
          className={`absolute top-4 left-1/2 -translate-x-1/2 px-3 sm:px-4 py-2 rounded-full shadow-lg text-[11px] sm:text-xs z-20 pointer-events-none animate-fade-in backdrop-blur-xs ${
            isRoomSetup ? 'bg-indigo-600/90 text-white' : 'bg-emerald-600/90 text-white'
          }`}
        >
          {isRoomSetup ? (
            <>
              <Home className="w-3 h-3 inline mr-1 -mt-0.5" />
              <span className="hidden sm:inline">
                Room Setup Mode • Drag door/window handles to reposition
              </span>
              <span className="sm:hidden">Drag handles to reposition</span>
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
              room={roomDims}
              isActive={isActive('door', door.id)}
              isLocked={!isRoomSetup}
              unitSystem={unitSystem}
              zoom={zoom}
              onSelect={() => onSelectOpening('door', door.id)}
              onHandlePointerDown={(e) => onDoorPointerDown(e, door)}
            />
          ))}
          {windows.map((win) => (
            <WindowShape
              key={win.id}
              opening={win}
              room={roomDims}
              isActive={isActive('window', win.id)}
              isLocked={!isRoomSetup}
              unitSystem={unitSystem}
              zoom={zoom}
              onSelect={() => onSelectOpening('window', win.id)}
              onHandlePointerDown={(e) => onWindowPointerDown(e, win)}
            />
          ))}

          {items
            .filter((i) => i.visible !== false)
            .map((item) => (
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
              />
            ))}
        </div>
      </div>
    </div>
  );
}
