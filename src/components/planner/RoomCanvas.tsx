import {
  useMemo,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Home, Move, Plus, Sofa, Trash2 } from 'lucide-react';
import { migrateColor } from '../../core/colors';
import { DESIGN_MODES, PIXELS_PER_UNIT } from '../../lib/constants';
import { feetToDisplay, nudgeStep } from '../../core/units';
import type { ItemWarning, Point } from '../../core/geometry';
import { floorBounds, roomName, sharedWalls, type RoomGuide } from '../../core/floor';
import { itemParts, partsBounds } from '../../core/geometry/shapes';
import { labelSpot } from '../../core/geometry/labels';
import { isRectangle, roomBounds, wallFrame } from '../../core/geometry/walls';
import {
  areaText,
  doorsOf,
  roomArea,
  roomById,
  roomSize,
  shownPieces,
  windowsOf,
} from '../../lib/plans';
import type { CornerDrag } from '../../hooks/useRoomShape';
import type { DesignMode, Id, Item, Opening, Plan, Room, Selection, UnitSystem } from '../../types';
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

/** Several rooms in room setup: pick one, drag it (its walls snap to the others'). */
export interface RoomPicking {
  onSelect: (id: Id) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>, id: Id) => void;
  /** The room being dragged: the lines it lines up with, and whether it overlaps another now. */
  drag: { id: Id; guides: RoomGuide[]; overlap: boolean } | null;
}

/** A set-aside piece waiting to be put on the plan: its outline where it would land. */
export interface PlacementGhost {
  item: Item;
  /** Its centre (floor coordinates), or null while the pointer is off the plan. */
  at: Point | null;
  /** False where it cannot go (outside every room). */
  ok: boolean;
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
  /** The room being edited (several rooms). */
  activeRoomId?: Id | null;
  /** Several rooms in room setup: select and drag rooms. */
  rooms?: RoomPicking | null;
  /** Shown next to the selected piece (its actions), kept the same size on screen. */
  selectionBar?: ReactNode;
  /** Tap-to-place: the piece's outline under the pointer. */
  ghost?: PlacementGhost | null;
  /** The pieces as they last settled (not mid-drag), for placing the room labels. */
  labelItems?: readonly Item[];
}

const GRID_STYLE = {
  backgroundImage:
    'linear-gradient(#ccc 1px, transparent 1px), linear-gradient(90deg, #ccc 1px, transparent 1px)',
  backgroundSize: `${PIXELS_PER_UNIT}px ${PIXELS_PER_UNIT}px`,
};

const pathOf = (room: Pick<Room, 'outline'>, P: number) =>
  `M ${room.outline.map((p) => `${p.x * P} ${p.y * P}`).join(' L ')} Z`;

/** The zoomable/pannable floor plan: one room, or a floor of several. */
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
  activeRoomId = null,
  rooms: picking = null,
  selectionBar,
  ghost = null,
  labelItems,
}: RoomCanvasProps) {
  const room = roomById(plan, activeRoomId);
  const several = plan.rooms.length > 1;
  const bounds = floorBounds(plan);
  const floorDims = { width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
  // One rectangle draws as it always has (a box with a border); anything else as outlines.
  const rect = !several && isRectangle(room);
  const P = PIXELS_PER_UNIT;
  const k = 1 / zoom;
  // Floor coordinates inside the box: its top-left is the floor's top-left.
  const floorShift: CSSProperties | undefined =
    bounds.left || bounds.top
      ? { transform: `translate(${-bounds.left * P}px, ${-bounds.top * P}px)` }
      : undefined;
  const shared = several ? sharedWalls(plan) : [];
  const isRoomSetup = designMode === DESIGN_MODES.ROOM_SETUP;
  const isActive = (type: Selection['type'], id: Id) =>
    selection?.type === type && selection.id === id;
  const selectedItem =
    selection?.type === 'item' ? plan.items.find((i) => i.id === selection.id) : undefined;
  const barAt = (() => {
    if (!selectionBar || !selectedItem?.placement) return null;
    const b = partsBounds(itemParts(selectedItem));
    // Below the piece (its rotate handle is above it); above it near the bottom of the floor.
    const below = b.bottom < bounds.bottom - 1.5;
    return { x: (b.left + b.right) / 2, y: below ? b.bottom : b.top, below };
  })();
  const box = (b: ReturnType<typeof roomBounds>): CSSProperties => ({
    left: b.left * P,
    top: b.top * P,
    width: (b.right - b.left) * P,
    height: (b.bottom - b.top) * P,
  });
  const floorSvg = (extra: CSSProperties = {}): CSSProperties => ({ ...box(bounds), ...extra });
  const viewBox = `${bounds.left * P} ${bounds.top * P} ${floorDims.width * P} ${floorDims.height * P}`;
  // Room labels: placed as the export places them (core/geometry/labels.ts), clear of the
  // furniture. Recomputed when the pieces settle (not on every drag frame) and when the zoom
  // changes enough to change the label's size on the floor.
  const zoomStep = Math.round(Math.log2(zoom) * 8) / 8;
  const settled = labelItems ?? plan.items;
  const labels = useMemo(() => {
    if (!several) return [];
    const z = 2 ** zoomStep;
    const boxes = settled
      .filter((i) => i.placement && !i.hidden)
      .map((i) => partsBounds(itemParts(i)));
    return plan.rooms.map((r) => {
      const name = roomName(plan, r);
      const area = areaText(roomArea(r), unitSystem);
      const rb = roomBounds(r);
      const roomy = (rb.right - rb.left) * P * z >= 170;
      // About 6.5 px a character at 11 px, plus padding (and the move icon in room setup).
      const textPx = (roomy ? `${name} ${area}` : name).length * 6.5 + (isRoomSetup ? 36 : 16);
      const half = { w: textPx / 2 / (P * z), h: (isRoomSetup ? 14 : 11) / (P * z) };
      const spot = labelSpot(r, boxes, half);
      return { room: r, name, area, roomy, spot };
    });
  }, [several, plan, settled, zoomStep, unitSystem, isRoomSetup, P]);

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
          ? `${picking ? 'rooms, ' : ''}${corners ? 'door and window handles and the room corners' : 'door and window handles'}`
          : 'furniture pieces'}
        .
        {isRoomSetup
          ? ' Arrow keys slide the focused opening along its wall; hold Shift for larger steps, Alt or Option for fine ones.'
          : ` Arrow keys move the focused piece by ${feetToDisplay(nudgeStep('normal', unitSystem), unitSystem)}; hold Shift for ${feetToDisplay(nudgeStep('coarse', unitSystem), unitSystem)}, or Alt or Option (or Control or Command) for ${feetToDisplay(nudgeStep('fine', unitSystem), unitSystem)} without snapping. With Snap on, a move that ends close to a wall or another piece lines up with it. R rotates it by 90 degrees, Shift and R rotates the other way; with Alt or Option, by 1 degree. I sets it aside. Delete removes it. Escape deselects.`}
        {isRoomSetup ? ' Delete removes the focused door or window.' : ''}
        {picking ? ' Arrow keys move the focused room; its walls snap to the other rooms.' : ''}
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
                  : picking
                    ? 'Room Setup Mode • Drag a room to move it • Drag door/window handles'
                    : 'Room Setup Mode • Furniture locked • Drag door/window handles to move them'}
              </span>
              <span className="sm:hidden">
                {corners
                  ? 'Drag corners · + adds one'
                  : picking
                    ? 'Drag a room to move it'
                    : 'Room setup · furniture locked'}
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
            width: floorDims.width * P,
            height: floorDims.height * P,
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
          data-rooms={plan.rooms.length}
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
                {/* Every room's walls, then every floor over their inner half (walls show outside). */}
                {plan.rooms.map((r) => (
                  <path
                    key={`w-${r.id}`}
                    d={pathOf(r, P)}
                    fill="none"
                    stroke="#334155"
                    strokeWidth={8}
                  />
                ))}
                {plan.rooms.map((r) => (
                  <path key={`f-${r.id}`} d={pathOf(r, P)} fill="#ffffff" />
                ))}
              </svg>
            )}
            {plan.rooms.map((r) => {
              const b = roomBounds(r);
              return (
                <div
                  key={`grid-${r.id}`}
                  className="absolute pointer-events-none opacity-20"
                  style={{
                    ...GRID_STYLE,
                    ...box(b),
                    clipPath: rect
                      ? undefined
                      : `polygon(${r.outline
                          .map((p) => `${(p.x - b.left) * P}px ${(p.y - b.top) * P}px`)
                          .join(', ')})`,
                  }}
                />
              );
            })}
            {picking && (
              <svg
                className="absolute"
                style={floorSvg()}
                viewBox={viewBox}
                aria-hidden="true"
                data-testid="room-hit"
              >
                {plan.rooms.map((r) => {
                  const on = r.id === room.id;
                  const dragging = picking.drag?.id === r.id;
                  return (
                    <path
                      key={r.id}
                      d={pathOf(r, P)}
                      fill={on ? 'rgb(79 70 229 / 0.06)' : 'transparent'}
                      stroke={
                        dragging && picking.drag?.overlap
                          ? '#dc2626'
                          : on
                            ? '#6366f1'
                            : 'transparent'
                      }
                      strokeWidth={on ? 3 * k : 0}
                      strokeDasharray={on ? `${6 * k} ${4 * k}` : undefined}
                      style={{
                        pointerEvents: 'fill',
                        cursor: on ? 'move' : 'pointer',
                        touchAction: on ? 'none' : undefined,
                      }}
                      onPointerDown={(e) => {
                        if (on)
                          picking.onPointerDown(
                            e as unknown as ReactPointerEvent<HTMLElement>,
                            r.id,
                          );
                      }}
                      onClick={() => {
                        if (!on) picking.onSelect(r.id);
                      }}
                      data-room-id={r.id}
                      data-draggable={on ? '' : undefined}
                    />
                  );
                })}
              </svg>
            )}
            {shared.length > 0 && (
              <svg
                className="absolute pointer-events-none"
                style={floorSvg({ overflow: 'visible' })}
                viewBox={viewBox}
                aria-hidden="true"
              >
                {shared.map((w, i) => (
                  <line
                    key={i}
                    x1={w.start.x * P}
                    y1={w.start.y * P}
                    x2={w.end.x * P}
                    y2={w.end.y * P}
                    stroke="#334155"
                    strokeWidth={3}
                    data-testid="shared-wall"
                  />
                ))}
              </svg>
            )}
            {/* The floor's origin, for turning pointer positions into floor coordinates. */}
            <div className="absolute left-0 top-0 w-0 h-0" data-floor-origin aria-hidden="true" />

            {several &&
              labels.map(({ room: r, name, area, roomy, spot }) => {
                const on = r.id === room.id;
                // Inside the walls on screen: as wide as the room is there, shortened if need be.
                const screenW = spot.width * P * zoom;
                const style: CSSProperties = {
                  maxWidth: Math.max(44, screenW - 12),
                  left: spot.x * P,
                  top: spot.y * P,
                  transform: `translate(-50%, -50%) scale(${k})`,
                  transformOrigin: 'center',
                  // A clear spot sits under the furniture; with none, over it (and see-through).
                  zIndex: picking ? 60 : spot.clear ? 5 : 12,
                };
                if (!picking) {
                  if (screenW < 60) return null;
                  return (
                    <div
                      key={`label-${r.id}`}
                      className={`absolute truncate whitespace-nowrap pointer-events-none rounded-md px-1.5 py-0.5 text-[11px] leading-4 text-slate-600 ring-1 ${
                        spot.clear
                          ? 'bg-white/80 shadow-xs ring-slate-200/80'
                          : 'bg-white/75 shadow-sm ring-slate-300/80 backdrop-blur-[2px]'
                      }`}
                      style={style}
                      aria-hidden="true"
                      data-testid="room-label"
                      data-clear={spot.clear || undefined}
                    >
                      <span className="font-semibold text-slate-800">{name}</span>
                      {roomy && ` ${area}`}
                    </div>
                  );
                }
                const sz = roomSize(r);
                return (
                  <div
                    key={`label-${r.id}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={on}
                    aria-label={`${name}${roomy ? ` ${area}` : ''}: ${feetToDisplay(sz.width, unitSystem)} by ${feetToDisplay(sz.height, unitSystem)}${roomy ? '' : `, ${area}`}. Drag it or use the arrow keys to move it.`}
                    className={`touch-hit absolute flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold leading-4 shadow-sm outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-400 cursor-move ${
                      on
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:ring-indigo-300'
                    }`}
                    style={{ ...style, touchAction: 'none' }}
                    onPointerDown={(e) => picking.onPointerDown(e, r.id)}
                    onFocus={() => picking.onSelect(r.id)}
                    data-draggable
                    data-room-handle={r.id}
                    data-testid="room-handle"
                  >
                    <Move className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{name}</span>
                    {roomy && (
                      <span
                        className={
                          on ? 'font-normal text-indigo-100' : 'font-normal text-slate-500'
                        }
                      >
                        {` ${area}`}
                      </span>
                    )}
                  </div>
                );
              })}

            {plan.rooms.flatMap((r) =>
              doorsOf(r).map((door) => (
                <DoorShape
                  key={door.id}
                  opening={door}
                  room={r}
                  isActive={isActive('door', door.id)}
                  isLocked={!isRoomSetup}
                  unitSystem={unitSystem}
                  zoom={zoom}
                  onSelect={() => onSelectOpening('door', door.id)}
                  onHandlePointerDown={(e) => onDoorPointerDown(e, door)}
                  highlight={highlightDoorIds.includes(door.id)}
                />
              )),
            )}
            {plan.rooms.flatMap((r) =>
              windowsOf(r).map((win) => (
                <WindowShape
                  key={win.id}
                  opening={win}
                  room={r}
                  isActive={isActive('window', win.id)}
                  isLocked={!isRoomSetup}
                  unitSystem={unitSystem}
                  zoom={zoom}
                  onSelect={() => onSelectOpening('window', win.id)}
                  onHandlePointerDown={(e) => onWindowPointerDown(e, win)}
                />
              )),
            )}

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
            {picking?.drag && picking.drag.guides.length > 0 && (
              <svg
                className="absolute pointer-events-none"
                style={floorSvg({ overflow: 'visible', zIndex: 61 })}
                viewBox={viewBox}
                aria-hidden="true"
              >
                {picking.drag.guides.map((g, i) => (
                  <line
                    key={i}
                    x1={(g.axis === 'x' ? g.pos : g.from) * P}
                    y1={(g.axis === 'x' ? g.from : g.pos) * P}
                    x2={(g.axis === 'x' ? g.pos : g.to) * P}
                    y2={(g.axis === 'x' ? g.to : g.pos) * P}
                    stroke="#e11d48"
                    strokeWidth={1.5 * k}
                    strokeDasharray={`${4 * k} ${3 * k}`}
                    data-testid="room-guide"
                  />
                ))}
              </svg>
            )}
            {corners && (
              <CornerHandles room={room} corners={corners} zoom={zoom} unitSystem={unitSystem} />
            )}
            {barAt && (
              <div
                className="absolute"
                style={{
                  left: barAt.x * P,
                  top: barAt.y * P,
                  transform: `translate(-50%, ${barAt.below ? '14px' : 'calc(-100% - 14px)'}) scale(${k})`,
                  transformOrigin: barAt.below ? 'top center' : 'bottom center',
                  zIndex: 70,
                }}
              >
                {selectionBar}
              </div>
            )}
            {ghost?.at && (
              <div
                className={`absolute pointer-events-none border-2 border-dashed ${
                  ghost.item.shape === 'ellipse' ? 'rounded-full' : 'rounded-sm'
                } ${ghost.ok ? 'border-emerald-600' : 'border-red-500'}`}
                style={{
                  left: (ghost.at.x - ghost.item.width / 2) * P,
                  top: (ghost.at.y - ghost.item.depth / 2) * P,
                  width: ghost.item.width * P,
                  height: ghost.item.depth * P,
                  backgroundColor: ghost.ok
                    ? `${migrateColor(ghost.item.color)}b3`
                    : 'rgb(254 202 202 / 0.6)',
                  zIndex: 65,
                }}
                data-testid="placement-ghost"
                data-ok={ghost.ok || undefined}
              />
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
  room: Room;
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
