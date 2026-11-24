import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { Home, Plus, Sofa, Trash2 } from 'lucide-react';
import { DESIGN_MODES, PIXELS_PER_UNIT } from '../../lib/constants';
import { feetToDisplay, nudgeStep } from '../../core/units';
import type { ItemWarning } from '../../core/geometry';
import { isRectangle, roomBounds, wallFrame } from '../../core/geometry/walls';
import { doorsOf, mainRoom, roomSize, shownPieces, windowsOf } from '../../lib/plans';
import type { CornerDrag } from '../../hooks/useRoomShape';
import type { DesignMode, Id, Item, Opening, Plan, Selection, UnitSystem } from '../../types';
import { FurniturePiece } from './FurniturePiece';
import { DoorShape, WindowShape } from './Openings';

/** Editing the room's corners (Custom shape, room setup). */
export interface CornerEditing {
  selected: number | null;
  /** A wall picked in the wall list: drawn highlighted. */
  highlightedWall: number | null;
  drag: CornerDrag | null;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>, corner: number) => void;
  onSelect: (corner: number) => void;
  onAddCorner: (wall: number) => void;
  onRemoveCorner: (corner: number) => void;
}

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
  /** Custom shape in room setup: corner handles, "+" handles on the walls, wall lengths. */
  corners?: CornerEditing | null;
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
  corners = null,
}: RoomCanvasProps) {
  const room = mainRoom(plan);
  const roomDims = roomSize(room);
  const bounds = roomBounds(room);
  const rect = isRectangle(room);
  const P = PIXELS_PER_UNIT;
  // Floor coordinates inside the room box: its top-left is the bounding box's top-left.
  const floorShift: CSSProperties | undefined =
    bounds.left || bounds.top
      ? { transform: `translate(${-bounds.left * P}px, ${-bounds.top * P}px)` }
      : undefined;
  const outlinePath = `M ${room.outline.map((p) => `${p.x * P} ${p.y * P}`).join(' L ')} Z`;
  const clipPolygon = `polygon(${room.outline
    .map((p) => `${(p.x - bounds.left) * P}px ${(p.y - bounds.top) * P}px`)
    .join(', ')})`;
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
        Press Tab to move between{' '}
        {isRoomSetup
          ? corners
            ? 'door and window handles and the room corners'
            : 'door and window handles'
          : 'furniture pieces'}
        .
        {isRoomSetup
          ? ' Arrow keys slide the focused opening along its wall; hold Shift for larger steps, Alt or Option for fine ones.'
          : ` Arrow keys move the focused piece by ${feetToDisplay(nudgeStep('normal', unitSystem), unitSystem)}; hold Shift for ${feetToDisplay(nudgeStep('coarse', unitSystem), unitSystem)}, or Alt or Option (or Control or Command) for ${feetToDisplay(nudgeStep('fine', unitSystem), unitSystem)} without snapping. With Snap on, a move that ends close to a wall or another piece lines up with it. R rotates it by 90 degrees, Shift and R rotates the other way; with Alt or Option, by 1 degree. Delete removes it. Escape deselects.`}
        {isRoomSetup ? ' Delete removes the focused door or window.' : ''}
        {corners
          ? ' Arrow keys move the focused corner, with the same steps; Delete removes it. The add corner buttons in the middle of each wall split it with a new corner.'
          : ''}{' '}
        Control or Command with Z undoes.
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
                {corners
                  ? 'Room Setup Mode • Drag corners to reshape • + adds a corner'
                  : 'Room Setup Mode • Furniture locked • Drag door/window handles to move them'}
              </span>
              <span className="sm:hidden">
                {corners ? 'Drag corners · + adds one' : 'Room setup · furniture locked'}
              </span>
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
          className={`relative shrink-0 ${rect ? 'bg-white shadow-2xl' : ''}`}
          style={{
            width: roomDims.width * P,
            height: roomDims.height * P,
            // The walls sit outside the floor: the interior is exactly the room size, so (0, 0) and
            // (width, height) are the walls' inner faces (where furniture is flush and openings sit).
            // Another outline draws its own walls (below); the border keeps the same box.
            border: rect ? '4px solid #334155' : '4px solid transparent',
            boxSizing: 'content-box',
            transform: `scale(${zoom})`,
            transformOrigin: 'center',
          }}
          data-testid="room"
          data-room-shape={rect ? 'rect' : 'outline'}
        >
          <div className="absolute inset-0" style={floorShift}>
            {!rect && (
              <svg
                className="absolute left-0 top-0 overflow-visible pointer-events-none"
                width={1}
                height={1}
                style={{ filter: 'drop-shadow(0 25px 25px rgb(0 0 0 / 0.15))' }}
                aria-hidden="true"
                data-testid="room-outline"
              >
                <path d={outlinePath} fill="none" stroke="#334155" strokeWidth={8} />
                <path d={outlinePath} fill="#ffffff" />
              </svg>
            )}
            <div
              className="absolute pointer-events-none opacity-20"
              style={{
                ...GRID_STYLE,
                left: bounds.left * P,
                top: bounds.top * P,
                width: roomDims.width * P,
                height: roomDims.height * P,
                clipPath: rect ? undefined : clipPolygon,
              }}
            />
            {/* The floor's origin, for turning pointer positions into floor coordinates. */}
            <div className="absolute left-0 top-0 w-0 h-0" data-floor-origin aria-hidden="true" />

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
            {corners && (
              <CornerHandles room={room} corners={corners} zoom={zoom} unitSystem={unitSystem} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const ACCENT = '#4f46e5'; // indigo-600
const GUIDE = '#e11d48'; // rose-600, as the furniture guides

/**
 * The Custom shape's handles, drawn in floor coordinates and kept the same size on screen: a
 * handle at every corner (drag it, or focus it and use the arrow keys), a "+" in the middle of
 * every wall, each wall's length outside it, the guides a dragged corner lines up with, and a
 * Remove button by the selected corner.
 */
function CornerHandles({
  room,
  corners,
  zoom,
  unitSystem,
}: {
  room: ReturnType<typeof mainRoom>;
  corners: CornerEditing;
  zoom: number;
  unitSystem: UnitSystem;
}) {
  const P = PIXELS_PER_UNIT;
  const o = room.outline;
  const n = o.length;
  const k = 1 / zoom;
  const b = roomBounds(room);
  const centre = { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 };
  const dragging = corners.drag?.index ?? null;
  const active = dragging ?? corners.selected;
  const near = (w: number) => active !== null && (w === active || (w + 1) % n === active);
  const at = (x: number, y: number, extra = ''): CSSProperties => ({
    left: x * P,
    top: y * P,
    transform: `translate(-50%, -50%) scale(${k})${extra}`,
  });
  const sel = corners.selected;
  const selPoint = sel !== null ? o[sel] : undefined;
  return (
    <>
      <svg
        className="absolute left-0 top-0 overflow-visible pointer-events-none"
        width={1}
        height={1}
        style={{ zIndex: 30 }}
        aria-hidden="true"
      >
        {corners.highlightedWall !== null && o[corners.highlightedWall] && (
          <line
            x1={o[corners.highlightedWall]!.x * P}
            y1={o[corners.highlightedWall]!.y * P}
            x2={o[(corners.highlightedWall + 1) % n]!.x * P}
            y2={o[(corners.highlightedWall + 1) % n]!.y * P}
            stroke={ACCENT}
            strokeWidth={6 * k}
            strokeLinecap="round"
            data-testid="wall-highlight"
          />
        )}
        {corners.drag?.guides.map((g, i) => {
          const dx = g.to.x - g.from.x;
          const dy = g.to.y - g.from.y;
          const d = Math.hypot(dx, dy) || 1;
          const over = (12 * k) / P;
          return (
            <line
              key={i}
              x1={(g.from.x - (dx / d) * over) * P}
              y1={(g.from.y - (dy / d) * over) * P}
              x2={(g.to.x + (dx / d) * over) * P}
              y2={(g.to.y + (dy / d) * over) * P}
              stroke={GUIDE}
              strokeWidth={1.5 * k}
              strokeDasharray={g.kind === 'align' ? `${4 * k} ${3 * k}` : undefined}
              data-testid="corner-guide"
              data-kind={g.kind}
            />
          );
        })}
      </svg>

      {o.map((p, w) => {
        const f = wallFrame(room, w);
        const mid = { x: p.x + (f.along.x * f.length) / 2, y: p.y + (f.along.y * f.length) / 2 };
        const out = 18 / (P * zoom);
        const inside = 34 / (P * zoom);
        return (
          <div key={`wall-${w}`}>
            <div
              className={`absolute whitespace-nowrap rounded-sm px-1 text-[11px] font-semibold leading-4 pointer-events-none ${
                near(w) || corners.highlightedWall === w
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/90 text-slate-700 shadow-xs'
              }`}
              style={{
                ...at(mid.x - f.inward.x * out, mid.y - f.inward.y * out),
                zIndex: 31,
              }}
              data-testid="wall-length"
              data-wall={w}
              aria-hidden="true"
            >
              {feetToDisplay(f.length, unitSystem)}
            </div>
            {n < 64 && f.length >= 1 && (
              <button
                type="button"
                className="touch-hit absolute flex h-6 w-6 items-center justify-center rounded-full border border-indigo-300 bg-white text-indigo-600 shadow-sm hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-hidden"
                style={{
                  ...at(mid.x + f.inward.x * inside, mid.y + f.inward.y * inside),
                  zIndex: 32,
                  ['--hit' as string]: '44px',
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => corners.onAddCorner(w)}
                aria-label={`Add a corner in the middle of wall ${w + 1}`}
                title="Add a corner here"
                data-draggable
                data-add-corner={w}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        );
      })}

      {o.map((p, i) => {
        const before = (i - 1 + n) % n;
        const on = corners.selected === i || dragging === i;
        return (
          <div
            key={`corner-${i}`}
            role="button"
            tabIndex={0}
            aria-pressed={corners.selected === i}
            aria-label={`Corner ${i + 1}, between wall ${before + 1} (${feetToDisplay(wallFrame(room, before).length, unitSystem)}) and wall ${i + 1} (${feetToDisplay(wallFrame(room, i).length, unitSystem)}). Drag it or use the arrow keys to move it; Delete removes it.`}
            // A 24px target (WCAG 2.5.8) around a 16px dot; 44px on touch screens.
            className="touch-hit group absolute flex h-6 w-6 items-center justify-center rounded-full cursor-move outline-hidden"
            style={{
              ...at(p.x, p.y),
              zIndex: 33,
              touchAction: 'none',
              ['--hit' as string]: '44px',
            }}
            onPointerDown={(e) => corners.onPointerDown(e, i)}
            onFocus={() => corners.onSelect(i)}
            data-draggable
            data-corner={i}
            data-testid="corner-handle"
          >
            <span
              className={`block h-4 w-4 rounded-full border-2 shadow-sm group-focus-visible:ring-2 group-focus-visible:ring-indigo-500 ${
                on
                  ? 'border-white bg-indigo-600 ring-2 ring-indigo-300'
                  : 'border-indigo-600 bg-white'
              }`}
            />
          </div>
        );
      })}

      {selPoint && n > 3 && dragging === null && (
        <button
          type="button"
          className="absolute flex items-center gap-1 whitespace-nowrap rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 shadow-md hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-500 outline-hidden"
          style={{
            // Above or below the corner (towards the middle of the room), clear of its target.
            ...at(selPoint.x, selPoint.y + ((selPoint.y < centre.y ? 1 : -1) * 40) / (P * zoom)),
            zIndex: 34,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => corners.onRemoveCorner(sel!)}
          data-draggable
          data-testid="remove-corner"
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" /> Remove corner {sel! + 1}
        </button>
      )}
    </>
  );
}
