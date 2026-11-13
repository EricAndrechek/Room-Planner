import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

const focusables = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );

interface Options {
  /** Escape closes the dialog. */
  onClose: () => void;
  /** Keep Tab/Shift+Tab inside the dialog (modal dialogs). Default true. */
  trap?: boolean;
  /** Dialog is mounted/visible. */
  active?: boolean;
}

/**
 * Dialog focus management: moves focus into the dialog on open, optionally
 * traps Tab, closes on Escape, and returns focus to whatever opened it.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, opts: Options) {
  const { trap = true, active = true } = opts;
  const onClose = useRef(opts.onClose);
  useEffect(() => {
    onClose.current = opts.onClose;
  });

  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Prefer the first real control; the close button is first in DOM order, so skip to a field if present.
    const items = focusables(root);
    const target = items.find((el) => el.matches('input, textarea, select')) ?? items[0] ?? root;
    target.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose.current();
        return;
      }
      if (!trap || e.key !== 'Tab') return;
      const list = focusables(root);
      if (list.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !root.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !root.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // The opener may have been unmounted meanwhile (e.g. its item was deleted).
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref, active, trap]);
}
