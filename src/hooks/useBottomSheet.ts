import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { track } from '../lib/analytics';
import {
  cycleDetent,
  detentHeights,
  loadDetent,
  saveDetent,
  snapDetent,
  stepDetent,
  type Detent,
  type DetentHeights,
} from '../lib/sheet';

/** How the sheet was resized (analytics). */
export type SheetInput = 'drag' | 'tap' | 'keyboard';

/** Movement (px) before a press on the sheet becomes a drag rather than a tap. */
const DRAG_SLOP = 6;
/** Release velocity is measured over this last stretch of the drag (ms). */
const VELOCITY_WINDOW_MS = 100;
/** Past the lowest/highest detent the sheet follows the finger at this fraction (rubber band). */
const OVERDRAG = 0.25;
/** A click right after a drag ended (ms) is the drag's own release, not a tap. */
const CLICK_AFTER_DRAG_MS = 400;

interface Metrics {
  heights: DetentHeights;
  /** How much of the bottom of the screen the on-screen keyboard covers (px), else 0. */
  keyboard: number;
}

/** The height the sheet rests at: its detent, kept below the top bar above the keyboard. */
const restingHeight = (d: Detent, m: Metrics) =>
  Math.max(m.heights.peek, Math.min(m.heights[d], m.heights.full - m.keyboard));

/**
 * The phone editor's bottom sheet: which detent it rests at (remembered for the session), its
 * heights for this screen, dragging it by its header (or down from the top of its content), the
 * handle's tap and keyboard resizing, and keeping it above the on-screen keyboard.
 *
 * The sheet's height is written to the element directly (also every frame of a drag); React only
 * renders its contents. `enabled` is false on wide screens, where the same element is the sidebar.
 */
export function useBottomSheet(enabled: boolean) {
  const [detent, setDetentState] = useState<Detent>(loadDetent);
  const [metrics, setMetrics] = useState<Metrics>({
    heights: { peek: 72, half: 380, full: 760 },
    keyboard: 0,
  });
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);

  const detentRef = useRef(detent);
  const metricsRef = useRef(metrics);
  useEffect(() => {
    detentRef.current = detent;
    metricsRef.current = metrics;
  });

  const visibleHeight = restingHeight(detent, metrics);

  const dragging = useRef(false);
  const applyHeight = useCallback(() => {
    const sheet = sheetRef.current;
    if (sheet) sheet.style.height = `${restingHeight(detentRef.current, metricsRef.current)}px`;
  }, []);

  const setDetent = useCallback(
    (d: Detent, input?: SheetInput) => {
      if (d === detentRef.current) {
        applyHeight(); // e.g. a drag let go near where it started: settle back
        return;
      }
      detentRef.current = d;
      setDetentState(d);
      saveDetent(d);
      if (input) track('sheet_resized', { to: d, input });
    },
    [applyHeight],
  );

  /** Collapsed? Open to half (e.g. a piece tapped on the plan, to show its card). */
  const expand = useCallback(
    (input?: SheetInput) => {
      if (enabled && detentRef.current === 'peek') setDetent('half', input);
    },
    [enabled, setDetent],
  );
  /** Covering the plan (full)? Lower to half (e.g. something was added, so it can be seen). */
  const lower = useCallback(() => {
    if (enabled && detentRef.current === 'full') setDetent('half');
  }, [enabled, setDetent]);

  // --- Measuring: detent heights for this screen, and the on-screen keyboard ---------------------
  const measure = useCallback(() => {
    const sheet = sheetRef.current;
    const header = headerRef.current;
    if (!sheet || !header) return;
    const screen = window.innerHeight;
    // The sheet lives in the planner's main area, which starts right below the top bar.
    const top = sheet.parentElement?.getBoundingClientRect().top ?? 0;
    const safeBottom = parseFloat(getComputedStyle(sheet).paddingBottom) || 0;
    const vv = window.visualViewport;
    // With the page pinch-zoomed the visual viewport is smaller too; that is not a keyboard.
    const covered =
      vv && Math.abs(vv.scale - 1) < 0.01 ? Math.round(screen - vv.height - vv.offsetTop) : 0;
    const next: Metrics = {
      heights: detentHeights(screen, header.offsetHeight + safeBottom, screen - top),
      keyboard: covered > 1 ? covered : 0,
    };
    setMetrics((m) =>
      m.keyboard === next.keyboard &&
      m.heights.peek === next.heights.peek &&
      m.heights.half === next.heights.half &&
      m.heights.full === next.heights.full
        ? m
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    if (!enabled) return;
    measure();
    const header = headerRef.current;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (header) observer?.observe(header);
    const vv = window.visualViewport;
    window.addEventListener('resize', measure);
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
    };
  }, [enabled, measure]);

  // --- Applying the resting height (animated by the sheet's CSS transition) ----------------------
  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    if (!enabled) {
      // Wide screen: the same element is the sidebar again.
      sheet.style.height = '';
      sheet.style.bottom = '';
      sheet.style.transition = '';
      return;
    }
    if (dragging.current) return;
    sheet.style.bottom = metrics.keyboard ? `${metrics.keyboard}px` : '';
    // Follow the keyboard at once (no height animation), so the focused field can be scrolled to.
    sheet.style.transition = metrics.keyboard ? 'none' : '';
    sheet.style.height = `${visibleHeight}px`;
  }, [enabled, visibleHeight, metrics.keyboard]);

  // The keyboard opened (or the sheet changed size under it): keep the focused field in view.
  useEffect(() => {
    if (!enabled || !metrics.keyboard) return;
    const id = requestAnimationFrame(() => {
      const el = document.activeElement;
      if (el instanceof HTMLElement && contentRef.current?.contains(el)) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
    return () => cancelAnimationFrame(id);
  }, [enabled, metrics.keyboard, visibleHeight]);

  // Collapsed to peek with focus in the (now inert) content: keep focus on the sheet, at its handle.
  useEffect(() => {
    if (!enabled || detent !== 'peek') return;
    if (contentRef.current?.contains(document.activeElement)) {
      handleRef.current?.focus({ preventScroll: true });
    }
  }, [enabled, detent]);

  // --- Dragging ------------------------------------------------------------------------------------
  const drag = useRef<{
    startY: number;
    startHeight: number;
    moved: boolean;
    samples: { t: number; h: number }[];
  } | null>(null);
  const suppressClickUntil = useRef(0);

  const beginDrag = useCallback((y: number) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    drag.current = {
      startY: y,
      startHeight: sheet.getBoundingClientRect().height,
      moved: false,
      samples: [],
    };
  }, []);

  /** Follow the pointer; returns whether this press is (now) a drag. */
  const moveDrag = useCallback((y: number): boolean => {
    const d = drag.current;
    const sheet = sheetRef.current;
    if (!d || !sheet) return false;
    if (!d.moved) {
      if (Math.abs(y - d.startY) < DRAG_SLOP) return false;
      d.moved = true;
      d.startY = y; // follow from here, so the sheet does not jump by the slop
      dragging.current = true;
      sheet.style.transition = 'none';
    }
    const { heights, keyboard } = metricsRef.current;
    const max = heights.full - keyboard;
    let h = d.startHeight - (y - d.startY);
    if (h > max) h = max + (h - max) * OVERDRAG;
    if (h < heights.peek) h = heights.peek - (heights.peek - h) * OVERDRAG;
    sheet.style.height = `${h}px`;
    const t = performance.now();
    d.samples.push({ t, h });
    while (d.samples.length > 2 && t - d.samples[0]!.t > VELOCITY_WINDOW_MS) d.samples.shift();
    return true;
  }, []);

  /** Let go: snap to a detent (or back, if cancelled). Returns whether it was a drag. */
  const endDrag = useCallback(
    (cancelled: boolean): boolean => {
      const d = drag.current;
      drag.current = null;
      const sheet = sheetRef.current;
      if (!d?.moved || !sheet) return false;
      dragging.current = false;
      sheet.style.transition = '';
      suppressClickUntil.current = performance.now() + CLICK_AFTER_DRAG_MS;
      const first = d.samples[0];
      const last = d.samples[d.samples.length - 1];
      const velocity =
        first && last && last.t > first.t ? (last.h - first.h) / (last.t - first.t) : 0;
      const height = last?.h ?? d.startHeight;
      const { heights, keyboard } = metricsRef.current;
      const usable = { ...heights, full: Math.max(heights.half, heights.full - keyboard) };
      setDetent(cancelled ? detentRef.current : snapDetent(height, velocity, usable), 'drag');
      return true;
    },
    [setDetent],
  );

  /** Header: drag with any pointer (touch, mouse, pen); window listeners follow it anywhere. */
  const onHeaderPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const id = e.pointerId;
      beginDrag(e.clientY);
      const move = (ev: PointerEvent) => {
        if (ev.pointerId === id) moveDrag(ev.clientY);
      };
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== id) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        endDrag(ev.type === 'pointercancel');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [beginDrag, moveDrag, endDrag],
  );

  /** A drag that started on a button in the header must not also press it. */
  const onHeaderClickCapture = useCallback((e: ReactMouseEvent) => {
    if (performance.now() < suppressClickUntil.current) {
      suppressClickUntil.current = 0;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  // Content: scrolls normally; pulling down from the very top drags the sheet down instead.
  // Touch events (not pointer events): the browser owns a scroll gesture's pointers.
  useEffect(() => {
    const el = contentRef.current;
    if (!enabled || !el) return;
    let start: { x: number; y: number; top: number } | null = null;
    let mode: 'undecided' | 'drag' | 'scroll' = 'scroll';
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length !== 1 || !t) {
        if (mode === 'drag') endDrag(true);
        mode = 'scroll';
        return;
      }
      start = { x: t.clientX, y: t.clientY, top: el.scrollTop };
      mode = 'undecided';
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t || mode === 'scroll') return;
      if (mode === 'undecided') {
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
        if (dy > 0 && dy > Math.abs(dx) && start.top <= 0 && el.scrollTop <= 0) {
          mode = 'drag';
          beginDrag(start.y);
        } else {
          mode = 'scroll';
          return;
        }
      }
      if (e.cancelable) e.preventDefault();
      moveDrag(t.clientY);
    };
    const onEnd = (e: TouchEvent) => {
      if (mode === 'drag') endDrag(e.type === 'touchcancel');
      mode = 'scroll';
      start = null;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [enabled, beginDrag, moveDrag, endDrag]);

  // --- The handle: tap / Enter / Space cycle, Arrow Up / Down step ---------------------------------
  const onHandleClick = useCallback(
    (e: ReactMouseEvent) =>
      // A keyboard "click" (Enter, Space) has no pointer position: detail 0.
      setDetent(cycleDetent(detentRef.current), e.detail === 0 ? 'keyboard' : 'tap'),
    [setDetent],
  );
  const onHandleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      setDetent(stepDetent(detentRef.current, e.key === 'ArrowUp' ? 1 : -1), 'keyboard');
    },
    [setDetent],
  );

  return {
    enabled,
    detent,
    setDetent,
    expand,
    lower,
    heights: metrics.heights,
    /** The sheet's current resting height (px), with the keyboard taken into account. */
    visibleHeight,
    keyboard: metrics.keyboard,
    sheetRef,
    headerRef,
    contentRef,
    handleRef,
    onHeaderPointerDown,
    onHeaderClickCapture,
    onHandleClick,
    onHandleKeyDown,
  };
}

export type BottomSheet = ReturnType<typeof useBottomSheet>;
