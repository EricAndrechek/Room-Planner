import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { track } from '../lib/analytics';
import { randomPresetColor } from '../core/colors';
import { PIXELS_PER_UNIT } from '../lib/constants';
import { normalizeDegrees, type AngleSnap } from '../core/geometry';
import {
  SNAP_THRESHOLD_PX,
  SNAP_THRESHOLD_TOUCH_PX,
  buildSnapCandidates,
  describeSnap,
  snapItem,
  snapNudge,
  thresholdFeet,
  type SnapResult,
} from '../core/snapping';
import {
  addPiece,
  changePiece,
  clearPieces,
  deletePiece,
  placePiece,
  takeOutPiece,
  toggleHidden,
  toggleLock as toggleLockEdit,
  type PiecePreset,
} from '../lib/edits';
import { mainRoom, roomSize, snapBox, snapPieces, type PiecePatch } from '../lib/plans';
import { roomSnapLines } from '../core/geometry/corners';
import { isRectangle } from '../core/geometry/walls';
import { addItem as addItemOp } from '../core/ops';
import type { Id, Item, Plan, Room } from '../types';
import { nextCardSeq, type CardRef } from './useCardHighlight';
import type { History } from './useHistory';
import type { usePointerDrag } from './usePointerDrag';
import type { useRotationDrag } from './useRotationDrag';
import type { useSelection } from './useSelection';

/** A room that is not a rectangle snaps pieces to its own walls (a rectangle to its four). */
const roomLines = (room: Room) => (isRectangle(room) ? undefined : roomSnapLines(room));

/** A press that moves less than this (px) and is let go is a tap (it may still nudge the piece). */
const TAP_SLOP_PX = 8;

/** Where a piece dragged with the mouse can be dropped to go to the inventory (the tray). */
export const INVENTORY_DROP_SELECTOR = '[data-inventory-drop]';
/** Set on the drop target while a piece is dragged over it. */
const DROP_ACTIVE = 'dropActive';

/** How a piece went to, or came from, the inventory (analytics `input`). */
export type InventoryInput = 'card' | 'canvas' | 'keyboard' | 'drag' | 'tray';

/** The inventory drop target under a point, if any. */
const dropTargetAt = (x: number, y: number): HTMLElement | null =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>(INVENTORY_DROP_SELECTOR) ?? null;

interface Options {
  history: History<Plan>;
  selection: ReturnType<typeof useSelection>;
  /** Room setup locks furniture: selectable, but not movable. */
  isRoomSetup: boolean;
  startDrag: ReturnType<typeof usePointerDrag>;
  startRotation: ReturnType<typeof useRotationDrag>;
  zoomRef: RefObject<number>;
  /** Snapping preference (the Snap toggle); Alt/Option during a drag bypasses it. */
  snapEnabled: boolean;
  /** Each drag frame: the piece being dragged and its snap (null when free); null on drop. */
  onDragFrame: (frame: DragFrame | null) => void;
  /** Each rotate-handle frame: the piece and its angle (snapped or free); null on release. */
  onRotateFrame: (frame: RotateFrame | null) => void;
  /** Speak a message in the live region. */
  announce: (text: string) => void;
  /** A piece was pressed while room setup locks all furniture (to explain why it does not move). */
  onLockedPress?: (item: Item) => void;
  /** A piece was tapped (pressed and let go without moving it) while furniture is editable. */
  onTap?: (item: Item) => void;
  /** A piece was dragged onto the inventory tray (desktop) and is now in the inventory. */
  onDroppedInInventory?: (item: Item) => void;
}

/** What the canvas draws while a piece is being rotated with its handle. */
export interface RotateFrame {
  id: Id;
  angle: AngleSnap;
}

/** What the canvas draws while a piece is being dragged. */
export interface DragFrame {
  id: Id;
  snap: SnapResult | null;
}

/** Adding, editing, removing, dragging and rotating furniture pieces. */
export function useFurnitureEditing({
  history,
  selection,
  isRoomSetup,
  startDrag,
  startRotation,
  zoomRef,
  snapEnabled,
  onDragFrame,
  onRotateFrame,
  announce,
  onLockedPress,
  onTap,
  onDroppedInInventory,
}: Options) {
  const { present: plan, set: setPlan, apply: applyPlan, commit } = history;
  const { setSelection, forgetItem, clearSelection } = selection;
  // Read at drag start / per move without re-creating the (memoized) pointer handlers.
  const planRef = useRef(plan);
  const snapRef = useRef(snapEnabled);
  useEffect(() => {
    planRef.current = plan;
    snapRef.current = snapEnabled;
  });

  /** The piece added last, for the sidebar to scroll to and highlight. */
  const [lastAdded, setLastAdded] = useState<CardRef | null>(null);

  /** A new piece goes to the free spot nearest the middle of the room, and is selected. */
  const addItem = (preset: PiecePreset = 'new') => {
    const { item: newItem } = addPiece(plan, randomPresetColor(), preset);
    applyPlan((p) => addItemOp(p, newItem));
    setSelection({ id: newItem.id, type: 'item' });
    setLastAdded({ type: 'item', id: newItem.id, seq: nextCardSeq() });
    track('furniture_added', { count: plan.items.length + 1, preset });
  };

  const deleteItem = useCallback(
    (id: Id) => {
      applyPlan((p) => deletePiece(p, id));
      forgetItem(id);
      track('furniture_removed');
    },
    [applyPlan, forgetItem],
  );

  const changeItem = useCallback(
    (id: Id, patch: PiecePatch, shouldCommit = true) => {
      (shouldCommit ? applyPlan : setPlan)((p) => changePiece(p, id, patch));
      if (patch.shape) track('item_shape_changed', { shape: patch.shape });
    },
    [applyPlan, setPlan],
  );

  const clearRoom = useCallback(() => {
    track('room_cleared', { count: plan.items.length });
    applyPlan(clearPieces);
    clearSelection();
  }, [applyPlan, plan.items.length, clearSelection]);

  const toggleLock = useCallback((id: Id) => applyPlan((p) => toggleLockEdit(p, id)), [applyPlan]);

  const toggleVisibility = useCallback(
    (id: Id) => applyPlan((p) => toggleHidden(p, id)),
    [applyPlan],
  );

  /** Take a piece out of the room into the inventory (one undo step). */
  const takeOutItem = useCallback(
    (id: Id, input: InventoryInput) => {
      if (!planRef.current.items.some((i) => i.id === id && i.placement)) return false;
      applyPlan((p) => takeOutPiece(p, id));
      forgetItem(id);
      track('item_to_inventory', { input });
      return true;
    },
    [applyPlan, forgetItem],
  );

  /**
   * Put a piece from the inventory back at the free spot nearest the middle of the room; it is
   * selected and its card highlighted, as a new piece is.
   */
  const placeItem = useCallback(
    (id: Id) => {
      if (!planRef.current.items.some((i) => i.id === id && !i.placement)) return;
      applyPlan((p) => placePiece(p, id));
      setSelection({ id, type: 'item' });
      setLastAdded({ type: 'item', id, seq: nextCardSeq() });
      track('item_placed_from_inventory', { input: 'tray' });
    },
    [applyPlan, setSelection],
  );

  /**
   * Keyboard move by a fixed (dx, dy) step as one undo step. With snapping on (and `snap` true; fine
   * steps pass false), a step that lands within the snap threshold of a wall or piece edge snaps
   * onto it, and that is announced.
   */
  const moveItem = useCallback(
    (id: Id, dx: number, dy: number, snap = true) => {
      const p = planRef.current;
      const item = p.items.find((i) => i.id === id);
      if (!item?.placement) return;
      const box = snapBox(item);
      let x = box.x + dx;
      let y = box.y + dy;
      let said = '';
      if (snap && snapRef.current) {
        const threshold = thresholdFeet(SNAP_THRESHOLD_PX, zoomRef.current, PIXELS_PER_UNIT);
        const candidates = buildSnapCandidates(
          snapPieces(p),
          roomSize(mainRoom(p)),
          id,
          roomLines(mainRoom(p)),
        );
        const r = snapNudge(box, dx, dy, candidates, threshold);
        x = r.x;
        y = r.y;
        said = describeSnap(r);
      }
      applyPlan((cur) => changePiece(cur, id, { x, y }));
      if (said) announce(said);
    },
    [applyPlan, announce, zoomRef],
  );

  const onItemPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, item: Item) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      setSelection({ id: item.id, type: 'item' });
      // If focus is elsewhere (a sidebar control), bring it back to the canvas so arrows, R and
      // Delete act on this piece next (canvas shortcuts only act with focus on the canvas).
      const canvas = e.currentTarget.closest<HTMLElement>('#floor-plan');
      if (canvas && !canvas.contains(document.activeElement)) canvas.focus({ preventScroll: true });
      // Locked (by mode or individually): selectable, but not movable. The mode lock says why.
      if (isRoomSetup) {
        onLockedPress?.(item);
        return;
      }
      if (item.locked) {
        onTap?.(item);
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      const current = planRef.current;
      // The other pieces stay put during the drag: collect their lines once.
      const candidates = buildSnapCandidates(
        snapPieces(current),
        roomSize(mainRoom(current)),
        item.id,
        roomLines(mainRoom(current)),
      );
      const thresholdPx = e.pointerType === 'touch' ? SNAP_THRESHOLD_TOUCH_PX : SNAP_THRESHOLD_PX;
      const box = snapBox(item);
      // Where the pointer alone would put the piece; snapping is applied on top each frame.
      const raw = { x: box.x, y: box.y };
      let last = { x: e.clientX, y: e.clientY };
      let snap: SnapResult | null = null;
      // Furthest the pointer got from where it went down (a tap wobbles a little).
      let travel = 0;
      const down = { x: e.clientX, y: e.clientY };
      // With a mouse, the piece can be dropped on the inventory tray (lit while it is over it).
      const canDrop = e.pointerType === 'mouse';
      let dropTarget: HTMLElement | null = null;
      const setDropTarget = (el: HTMLElement | null) => {
        if (el === dropTarget) return;
        if (dropTarget) delete dropTarget.dataset[DROP_ACTIVE];
        if (el) el.dataset[DROP_ACTIVE] = '';
        dropTarget = el;
      };
      startDrag(e, {
        onMove: (ev) => {
          if (canDrop) setDropTarget(dropTargetAt(ev.clientX, ev.clientY));
          const scale = PIXELS_PER_UNIT * zoomRef.current;
          raw.x += (ev.clientX - last.x) / scale;
          raw.y += (ev.clientY - last.y) / scale;
          last = { x: ev.clientX, y: ev.clientY };
          travel = Math.max(travel, Math.hypot(ev.clientX - down.x, ev.clientY - down.y));
          snap =
            snapRef.current && !ev.altKey
              ? snapItem(
                  { ...box, x: raw.x, y: raw.y },
                  candidates,
                  thresholdFeet(thresholdPx, zoomRef.current, PIXELS_PER_UNIT),
                )
              : null;
          const pos = snap ?? raw;
          const x = pos.x;
          const y = pos.y;
          setPlan((p) => changePiece(p, item.id, { x, y }));
          onDragFrame({ id: item.id, snap: snap && (snap.snapX || snap.snapY) ? snap : null });
        },
        onEnd: (end) => {
          const dropped = !!end && !!dropTarget;
          setDropTarget(null);
          if (dropped) {
            // Dropped on the tray: one undo step from where it was to the inventory.
            setPlan((p) => takeOutPiece(p, item.id));
            commit();
            onDragFrame(null);
            forgetItem(item.id);
            track('item_to_inventory', { input: 'drag' });
            onDroppedInInventory?.(item);
            return;
          }
          commit();
          onDragFrame(null);
          const said = snap ? describeSnap(snap) : '';
          if (said) announce(said);
          // A press without a move is a selection, not a move.
          if (raw.x !== box.x || raw.y !== box.y) {
            track('item_moved', {
              snapped: !!(snap && (snap.snapX || snap.snapY)),
              input: e.pointerType,
            });
          }
          if (end && travel < TAP_SLOP_PX) onTap?.(item);
        },
      });
    },
    [
      isRoomSetup,
      startDrag,
      zoomRef,
      setPlan,
      commit,
      setSelection,
      onDragFrame,
      announce,
      onLockedPress,
      onTap,
      forgetItem,
      onDroppedInInventory,
    ],
  );

  const onRotatePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, item: Item) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const piece = e.currentTarget.closest<HTMLElement>('[data-item-id]');
      if (!piece) return;
      // The rotated element's bounding box shares its center with the item.
      const rect = piece.getBoundingClientRect();
      let lastAngle: AngleSnap | null = null;
      const start = item.placement?.rotation ?? 0;
      startRotation(e, {
        center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        startRotation: start,
        snapEnabled: () => snapRef.current,
        onRotate: (angle) => {
          lastAngle = angle;
          setPlan((p) => changePiece(p, item.id, { rotation: angle.deg }));
          onRotateFrame({ id: item.id, angle });
        },
        onEnd: (deg) => {
          applyPlan((p) => changePiece(p, item.id, { rotation: deg }));
          onRotateFrame(null);
          if (normalizeDegrees(deg) !== start) {
            track('item_rotated', { snapped: lastAngle?.snapped != null, input: e.pointerType });
          }
        },
      });
    },
    [startRotation, setPlan, applyPlan, onRotateFrame],
  );

  return {
    lastAdded,
    addItem,
    deleteItem,
    changeItem,
    clearRoom,
    toggleLock,
    toggleVisibility,
    takeOutItem,
    placeItem,
    moveItem,
    onItemPointerDown,
    onRotatePointerDown,
  };
}
