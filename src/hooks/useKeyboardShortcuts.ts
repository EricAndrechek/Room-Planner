import { useEffect, useRef, type RefObject } from 'react';
import type { NudgeSize } from '../core/units';

export interface ShortcutHandlers {
  undo: () => void;
  redo: () => void;
  /** Return true if something was deleted (the key's default is then suppressed). */
  deleteSelected: () => boolean;
  deselect: () => void;
  /**
   * Move the selected item one step in direction (dx, dy), each -1, 0 or 1; `size` picks the step
   * (see `nudgeStep`). True if something moved.
   */
  nudge: (dx: number, dy: number, size: NudgeSize) => boolean;
  /** Rotate the selected item by `degrees` (clockwise if positive); true if it was rotated. */
  rotateSelected: (degrees: number) => boolean;
  /** `I`: move the selected piece to the inventory; true if it was moved. */
  toInventory: () => boolean;
  /** `?`: show the keyboard shortcuts. */
  showShortcuts: () => void;
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
 * Keyboard shortcuts (listed in lib/shortcuts.ts). Anywhere (except while typing): Ctrl/Cmd+Z
 * undo, Ctrl/Cmd+Shift+Z redo, `?` the shortcuts panel.
 * Only with focus on the canvas or one of its pieces (or nothing focused): Delete/Backspace
 * delete, Escape deselect, arrows nudge (Shift: a bigger step; Alt/Option or Ctrl/Cmd: a fine
 * step), R rotate 90deg (Shift+R: back), Alt/Option+R rotate 1deg (with Shift: back), I move to the
 * inventory. Off when
 * `enabled` is false (a modal is open).
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
      // `?` (Shift+/ on most layouts) works from anywhere except a text field.
      if (key === '?' && !mod && !e.altKey) {
        e.preventDefault();
        h.showShortcuts();
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
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (key in arrows) {
        // Shift = bigger (Figma, Keynote, Slides); Alt/Option, or Ctrl/Cmd as in PowerPoint = finer.
        const size: NudgeSize = e.altKey || mod ? 'fine' : e.shiftKey ? 'coarse' : 'normal';
        if (h.nudge(...arrows[key]!, size)) e.preventDefault();
        return;
      }
      if (!mod && !e.altKey && !e.shiftKey && (e.code === 'KeyI' || key === 'i' || key === 'I')) {
        if (h.toInventory()) e.preventDefault();
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
