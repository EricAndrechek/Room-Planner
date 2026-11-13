import { useCallback, useEffect, useRef } from 'react';

export interface DragHandlers {
  onMove: (e: PointerEvent) => void;
  onEnd?: (e: PointerEvent | null) => void;
}

/**
 * Track one pointer (mouse, touch or pen) from pointerdown until it is
 * released or cancelled, via window listeners so the drag continues outside
 * the element. Starting a new drag ends the previous one.
 */
export function usePointerDrag() {
  const active = useRef<{ cleanup: () => void; handlers: DragHandlers } | null>(null);

  useEffect(
    () => () => {
      active.current?.cleanup();
      active.current = null;
    },
    [],
  );

  return useCallback((start: { pointerId: number }, handlers: DragHandlers) => {
    if (active.current) {
      const prev = active.current;
      prev.cleanup();
      prev.handlers.onEnd?.(null);
    }
    const id = start.pointerId;
    const move = (e: PointerEvent) => {
      if (e.pointerId === id) handlers.onMove(e);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      cleanup();
      handlers.onEnd?.(e);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (active.current?.cleanup === cleanup) active.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    active.current = { cleanup, handlers };
  }, []);
}
