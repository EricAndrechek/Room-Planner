import { useCallback, useEffect, useRef, useState } from 'react';

/** A short, non-blocking message at the bottom of the screen, with an optional action button. */
export interface Notice {
  /** What the notice is about; showing a notice with the same key again just updates it. */
  key: string;
  message: string;
  action?: { label: string; onClick: () => void };
  /** Hide by itself after this many ms (default: stays until dismissed or replaced). */
  timeoutMs?: number;
}

/**
 * One app notice at a time (the latest replaces the previous one). Notices never take focus; they
 * render in the polite toast dock so screen readers hear them.
 */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback((next: Notice) => {
    clearTimeout(timer.current);
    setNotice(next);
    if (next.timeoutMs) {
      timer.current = setTimeout(
        () => setNotice((n) => (n?.key === next.key ? null : n)),
        next.timeoutMs,
      );
    }
  }, []);

  /** Hide the notice (only if it is the one with `key`, when given). */
  const dismiss = useCallback((key?: string) => {
    setNotice((n) => {
      if (!n || (key !== undefined && n.key !== key)) return n;
      clearTimeout(timer.current);
      return null;
    });
  }, []);

  return { notice, show, dismiss };
}
