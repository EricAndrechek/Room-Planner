import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  undo: () => void;
  redo: () => void;
  /** Return true if something was deleted (the key's default is then suppressed). */
  deleteSelected: () => boolean;
  deselect: () => void;
  /** Move the selected item by (dx, dy) feet; true if an item was moved. */
  nudge: (dx: number, dy: number) => boolean;
  rotateSelected: () => boolean;
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
 * Global shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo, Delete/Backspace
 * delete, Escape deselect, arrows nudge 0.25 ft (Shift: 1 ft), R rotate 90deg.
 * Ignored while typing in a form field or when `enabled` is false.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers, enabled = true) {
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
      if (!mod && !e.altKey && (key === 'r' || key === 'R')) {
        if (h.rotateSelected()) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
