import { useEffect, useRef, type RefObject } from 'react';

export interface ShortcutHandlers {
  undo: () => void;
  redo: () => void;
  /** Return true if something was deleted (the key's default is then suppressed). */
  deleteSelected: () => boolean;
  deselect: () => void;
  /** Move the selected item by (dx, dy) feet; true if an item was moved. */
  nudge: (dx: number, dy: number) => boolean;
  /** Rotate the selected item by `degrees` (clockwise if positive); true if it was rotated. */
  rotateSelected: (degrees: number) => boolean;
}

const isTyping = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
};

/**
 * Whether a key event is aimed at the canvas: nothing focused, the canvas itself, or one of its
 * pieces/handles (`[data-draggable]`). Not a sidebar control, a dialog, or a button over the canvas.
 */
export const isCanvasTarget = (target: EventTarget | null, canvas: HTMLElement | null): boolean => {
  if (!(target instanceof Element)) return true;
  if (target === document.body || target === document.documentElement) return true;
  if (!canvas || !canvas.contains(target)) return false;
  return target === canvas || target.closest('[data-draggable]') !== null;
};

/**
 * Keyboard shortcuts. Anywhere (except while typing): Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo.
 * Only with focus on the canvas or one of its pieces (or nothing focused): Delete/Backspace
 * delete, Escape deselect, arrows nudge 0.25 ft (Shift: 1 ft), R rotate 90deg (Shift+R: back),
 * Alt/Option+R rotate 1deg (with Shift: back). Off when `enabled` is false (a modal is open).
 */
export function useKeyboardShortcuts(
  handlers: ShortcutHandlers,
  canvasRef: RefObject<HTMLElement | null>,
  enabled = true,
) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const h = ref.current;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      if (mod && key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) h.redo();
        else h.undo();
        return;
      }
      if (e.defaultPrevented || !isCanvasTarget(e.target, canvasRef.current)) return;
      if (key === 'Delete' || key === 'Backspace') {
        if (h.deleteSelected()) e.preventDefault();
        return;
      }
      if (key === 'Escape') {
        h.deselect();
        return;
      }
      const step = e.shiftKey ? 1 : 0.25;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (key in arrows) {
        if (h.nudge(...arrows[key]!)) e.preventDefault();
        return;
      }
      // By physical key: Option+R types "®" on a Mac keyboard.
      if (!mod && (e.code === 'KeyR' || key === 'r' || key === 'R')) {
        const degrees = (e.altKey ? 1 : 90) * (e.shiftKey ? -1 : 1);
        if (h.rotateSelected(degrees)) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, canvasRef]);
}
