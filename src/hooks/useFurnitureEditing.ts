import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { track } from '../lib/analytics';
import { randomPresetColor } from '../lib/colors';
import { PIXELS_PER_UNIT } from '../lib/constants';
import type { AngleSnap } from '../lib/geometry';
import { findFurnitureSpot } from '../lib/placement';
import {
  SNAP_THRESHOLD_PX,
  SNAP_THRESHOLD_TOUCH_PX,
  buildSnapCandidates,
  describeSnap,
  snapItem,
  snapNudge,
  thresholdFeet,
  type SnapResult,
} from '../lib/snapping';
import type { FurnitureItem, Id, Layout } from '../types';
import { nextCardSeq, type CardRef } from './useCardHighlight';
import type { History } from './useHistory';
import type { usePointerDrag } from './usePointerDrag';
import type { useRotationDrag } from './useRotationDrag';
import type { useSelection } from './useSelection';

/** A press that moves less than this (px) and is let go is a tap (it may still nudge the piece). */
const TAP_SLOP_PX = 8;

export const patchItem = (l: Layout, id: Id, patch: Partial<FurnitureItem>): Layout => ({
  ...l,
  items: l.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
});

interface Options {
  history: History<Layout>;
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
  onLockedPress?: (item: FurnitureItem) => void;
  /** A piece was tapped (pressed and let go without moving it) while furniture is editable. */
  onTap?: (item: FurnitureItem) => void;
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
}: Options) {
  const { present: layout, set: setLayout, apply: applyLayout, commit } = history;
  const { setSelection, forgetItem, clearSelection } = selection;
  // Read at drag start / per move without re-creating the (memoized) pointer handlers.
  const layoutRef = useRef(layout);
  const snapRef = useRef(snapEnabled);
  useEffect(() => {
    layoutRef.current = layout;
    snapRef.current = snapEnabled;
  });

  /** The piece added last, for the sidebar to scroll to and highlight. */
  const [lastAdded, setLastAdded] = useState<CardRef | null>(null);

  /** A new piece goes to the free spot nearest the middle of the room, and is selected. */
  const addItem = () => {
    const size = { width: 3, height: 2 };
    const spot = findFurnitureSpot(layout, size);
    const newItem: FurnitureItem = {
      id: Date.now(),
      label: 'New Item',
      ...size,
      ...spot,
      rotation: 0,
      color: randomPresetColor(),
      visible: true,
    };
    applyLayout((l) => ({ ...l, items: [...l.items, newItem] }));
    setSelection({ id: newItem.id, type: 'item' });
    setLastAdded({ type: 'item', id: newItem.id, seq: nextCardSeq() });
    track('furniture_added', { count: layout.items.length + 1 });
  };

  const deleteItem = useCallback(
    (id: Id) => {
      applyLayout((l) => ({ ...l, items: l.items.filter((i) => i.id !== id) }));
      forgetItem(id);
      track('furniture_removed');
    },
    [applyLayout, forgetItem],
  );

  const changeItem = useCallback(
    (id: Id, patch: Partial<FurnitureItem>, shouldCommit = true) =>
      (shouldCommit ? applyLayout : setLayout)((l) => patchItem(l, id, patch)),
    [applyLayout, setLayout],
  );

  const clearRoom = useCallback(() => {
    track('room_cleared', { count: layout.items.length });
    applyLayout((l) => ({ ...l, items: [] }));
    clearSelection();
  }, [applyLayout, layout.items.length, clearSelection]);

  const toggleLock = useCallback(
    (id: Id) =>
      applyLayout((l) => ({
        ...l,
        items: l.items.map((i) => (i.id === id ? { ...i, locked: !i.locked } : i)),
      })),
    [applyLayout],
  );

  const toggleVisibility = useCallback(
    (id: Id) =>
      applyLayout((l) => ({
        ...l,
        items: l.items.map((i) => (i.id === id ? { ...i, visible: !(i.visible !== false) } : i)),
      })),
    [applyLayout],
  );

  /**
   * Keyboard move by a fixed (dx, dy) step as one undo step. With snapping on (and `snap` true; fine
   * steps pass false), a step that lands within the snap threshold of a wall or piece edge snaps
   * onto it, and that is announced.
   */
  const moveItem = useCallback(
    (id: Id, dx: number, dy: number, snap = true) => {
      const l = layoutRef.current;
      const item = l.items.find((i) => i.id === id);
      if (!item) return;
      let x = item.x + dx;
      let y = item.y + dy;
      let said = '';
      if (snap && snapRef.current) {
        const threshold = thresholdFeet(SNAP_THRESHOLD_PX, zoomRef.current, PIXELS_PER_UNIT);
        const r = snapNudge(item, dx, dy, buildSnapCandidates(l.items, l.roomDims, id), threshold);
        x = r.x;
        y = r.y;
        said = describeSnap(r);
      }
      applyLayout((cur) => patchItem(cur, id, { x, y }));
      if (said) announce(said);
    },
    [applyLayout, announce, zoomRef],
  );

  const onItemPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, item: FurnitureItem) => {
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
      const { items, roomDims } = layoutRef.current;
      // The other pieces stay put during the drag: collect their lines once.
      const candidates = buildSnapCandidates(items, roomDims, item.id);
      const thresholdPx = e.pointerType === 'touch' ? SNAP_THRESHOLD_TOUCH_PX : SNAP_THRESHOLD_PX;
      // Where the pointer alone would put the piece; snapping is applied on top each frame.
      const raw = { x: item.x, y: item.y };
      let last = { x: e.clientX, y: e.clientY };
      let snap: SnapResult | null = null;
      // Furthest the pointer got from where it went down (a tap wobbles a little).
      let travel = 0;
      const down = { x: e.clientX, y: e.clientY };
      startDrag(e, {
        onMove: (ev) => {
          const scale = PIXELS_PER_UNIT * zoomRef.current;
          raw.x += (ev.clientX - last.x) / scale;
          raw.y += (ev.clientY - last.y) / scale;
          last = { x: ev.clientX, y: ev.clientY };
          travel = Math.max(travel, Math.hypot(ev.clientX - down.x, ev.clientY - down.y));
          snap =
            snapRef.current && !ev.altKey
              ? snapItem(
                  { ...item, x: raw.x, y: raw.y },
                  candidates,
                  thresholdFeet(thresholdPx, zoomRef.current, PIXELS_PER_UNIT),
                )
              : null;
          const pos = snap ?? raw;
          const x = pos.x;
          const y = pos.y;
          setLayout((l) => patchItem(l, item.id, { x, y }));
          onDragFrame({ id: item.id, snap: snap && (snap.snapX || snap.snapY) ? snap : null });
        },
        onEnd: (end) => {
          commit();
          onDragFrame(null);
          const said = snap ? describeSnap(snap) : '';
          if (said) announce(said);
          // A press without a move is a selection, not a move.
          if (raw.x !== item.x || raw.y !== item.y) {
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
      setLayout,
      commit,
      setSelection,
      onDragFrame,
      announce,
      onLockedPress,
      onTap,
    ],
  );

  const onRotatePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, item: FurnitureItem) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const piece = e.currentTarget.closest<HTMLElement>('[data-item-id]');
      if (!piece) return;
      // The rotated element's bounding box shares its center with the item.
      const rect = piece.getBoundingClientRect();
      let lastAngle: AngleSnap | null = null;
      startRotation(e, {
        center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        startRotation: item.rotation,
        snapEnabled: () => snapRef.current,
        onRotate: (angle) => {
          lastAngle = angle;
          setLayout((l) => patchItem(l, item.id, { rotation: angle.deg }));
          onRotateFrame({ id: item.id, angle });
        },
        onEnd: (deg) => {
          applyLayout((l) => patchItem(l, item.id, { rotation: deg }));
          onRotateFrame(null);
          if (deg !== item.rotation) {
            track('item_rotated', { snapped: lastAngle?.snapped != null, input: e.pointerType });
          }
        },
      });
    },
    [startRotation, setLayout, applyLayout, onRotateFrame],
  );

  return {
    lastAdded,
    addItem,
    deleteItem,
    changeItem,
    clearRoom,
    toggleLock,
    toggleVisibility,
    moveItem,
    onItemPointerDown,
    onRotatePointerDown,
  };
}
