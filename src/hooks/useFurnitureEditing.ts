import { useCallback, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { track } from '../lib/analytics';
import { randomPresetColor } from '../lib/colors';
import { PIXELS_PER_UNIT } from '../lib/constants';
import type { FurnitureItem, Id, Layout } from '../types';
import type { History } from './useHistory';
import type { usePointerDrag } from './usePointerDrag';
import type { useRotationDrag } from './useRotationDrag';
import type { useSelection } from './useSelection';

export const patchItem = (l: Layout, id: Id, patch: Partial<FurnitureItem>): Layout => ({
  ...l,
  items: l.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
});

interface Options {
  history: History<Layout>;
  selection: ReturnType<typeof useSelection>;
  /** Room setup locks furniture: selectable, but not movable. */
  isRoomSetup: boolean;
  isMobile: boolean;
  /** Mobile: close the sidebar sheet so the new piece is visible. */
  closeMobileSidebar: () => void;
  startDrag: ReturnType<typeof usePointerDrag>;
  startRotation: ReturnType<typeof useRotationDrag>;
  zoomRef: RefObject<number>;
}

/** Adding, editing, removing, dragging and rotating furniture pieces. */
export function useFurnitureEditing({
  history,
  selection,
  isRoomSetup,
  isMobile,
  closeMobileSidebar,
  startDrag,
  startRotation,
  zoomRef,
}: Options) {
  const { present: layout, set: setLayout, apply: applyLayout, commit } = history;
  const { setSelection, forgetItem, clearSelection } = selection;

  const addItem = () => {
    const { width, height } = layout.roomDims;
    const newItem: FurnitureItem = {
      id: Date.now(),
      label: 'New Item',
      width: 3,
      height: 2,
      x: width / 2 - 1.5,
      y: height / 2 - 1,
      rotation: 0,
      color: randomPresetColor(),
      visible: true,
    };
    applyLayout((l) => ({ ...l, items: [...l.items, newItem] }));
    track('furniture_added', { count: layout.items.length + 1 });
    if (isMobile) closeMobileSidebar();
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

  /** Move a piece by (dx, dy) feet as one undo step. */
  const moveItem = useCallback(
    (id: Id, dx: number, dy: number) =>
      applyLayout((l) => ({
        ...l,
        items: l.items.map((i) => (i.id === id ? { ...i, x: i.x + dx, y: i.y + dy } : i)),
      })),
    [applyLayout],
  );

  const onItemPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, item: FurnitureItem) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      setSelection({ id: item.id, type: 'item' });
      // Locked (by mode or individually): selectable, but not movable.
      if (isRoomSetup || item.locked) return;
      e.stopPropagation();
      e.preventDefault();
      let last = { x: e.clientX, y: e.clientY };
      startDrag(e, {
        onMove: (ev) => {
          const scale = PIXELS_PER_UNIT * zoomRef.current;
          const dx = (ev.clientX - last.x) / scale;
          const dy = (ev.clientY - last.y) / scale;
          last = { x: ev.clientX, y: ev.clientY };
          setLayout((l) => ({
            ...l,
            items: l.items.map((i) => (i.id === item.id ? { ...i, x: i.x + dx, y: i.y + dy } : i)),
          }));
        },
        onEnd: () => commit(),
      });
    },
    [isRoomSetup, startDrag, zoomRef, setLayout, commit, setSelection],
  );

  const onRotatePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, item: FurnitureItem) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const piece = e.currentTarget.parentElement;
      if (!piece) return;
      // The rotated element's bounding box shares its center with the item.
      const rect = piece.getBoundingClientRect();
      startRotation(e, {
        center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
        startRotation: item.rotation,
        onRotate: (deg) => setLayout((l) => patchItem(l, item.id, { rotation: deg })),
        onEnd: (deg) => applyLayout((l) => patchItem(l, item.id, { rotation: deg })),
      });
    },
    [startRotation, setLayout, applyLayout],
  );

  return {
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
