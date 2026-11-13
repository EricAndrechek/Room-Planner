import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { MAX_ZOOM, MIN_ZOOM, PIXELS_PER_UNIT, ZOOM_STEP } from '../lib/constants';
import { clampZoom, computeFitZoom } from '../lib/geometry';
import type { RoomDims } from '../types';

/** Elements that start their own drag; a one-finger touch on them must not pan. */
const DRAGGABLE_SELECTOR = '[data-draggable], [role="button"], .cursor-grab, .cursor-crosshair';

/**
 * Canvas zoom & pan: trackpad pinch (ctrl+wheel) zooms, two-finger scroll
 * pans, touch pinch zooms + pans, one-finger touch on the background pans.
 * The room is fitted to the view shortly after mount and on window resize.
 */
export function usePanZoom(containerRef: RefObject<HTMLElement | null>, room: RoomDims, isMobile: boolean) {
  const [zoom, setZoomState] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);

  const setZoom = useCallback((value: number | ((z: number) => number)) => {
    const next = clampZoom(typeof value === 'function' ? value(zoomRef.current) : value);
    zoomRef.current = next;
    setZoomState(next);
  }, []);

  const fitToView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const padding = isMobile ? 32 : 64;
    setZoom(
      computeFitZoom({ width: rect.width - padding, height: rect.height - padding }, room, PIXELS_PER_UNIT),
    );
    setPan({ x: 0, y: 0 });
  }, [containerRef, isMobile, room, setZoom]);

  // Auto-fit once after layout settles (the sidebar animates for 300ms), so
  // shared links and small screens open with the whole room visible.
  const fitRef = useRef(fitToView);
  useEffect(() => {
    fitRef.current = fitToView;
  }, [fitToView]);
  useEffect(() => {
    const timer = setTimeout(() => fitRef.current(), 500);
    return () => clearTimeout(timer);
  }, []);

  // Re-fit on window resize (debounced).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => fitRef.current(), 300);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(timer);
    };
  }, []);

  // Wheel + touch gestures (non-passive so they can preventDefault).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastDistance: number | null = null;
    let lastCenter: { x: number; y: number } | null = null;
    let pinching = false;
    let lastSingle: { x: number; y: number } | null = null;
    let singlePanning = false;

    const distance = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const center = (t: TouchList) => ({
      x: (t[0]!.clientX + t[1]!.clientX) / 2,
      y: (t[0]!.clientY + t[1]!.clientY) / 2,
    });

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        setZoom(zoomRef.current - e.deltaY * 0.01);
      } else {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinching = true;
        singlePanning = false;
        lastDistance = distance(e.touches);
        lastCenter = center(e.touches);
        e.preventDefault();
      } else if (e.touches.length === 1) {
        const target = e.target instanceof Element ? e.target : null;
        if (!target?.closest(DRAGGABLE_SELECTOR)) {
          singlePanning = true;
          lastSingle = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinching) {
        e.preventDefault();
        const d = distance(e.touches);
        if (lastDistance !== null) setZoom(zoomRef.current + (d - lastDistance) * 0.008);
        lastDistance = d;
        const c = center(e.touches);
        if (lastCenter !== null) {
          const prev = lastCenter;
          setPan((p) => ({ x: p.x + c.x - prev.x, y: p.y + c.y - prev.y }));
        }
        lastCenter = c;
      } else if (e.touches.length === 1 && singlePanning && lastSingle) {
        e.preventDefault();
        const cur = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
        const prev = lastSingle;
        setPan((p) => ({ x: p.x + cur.x - prev.x, y: p.y + cur.y - prev.y }));
        lastSingle = cur;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinching = false;
        lastDistance = null;
        lastCenter = null;
      }
      if (e.touches.length === 0) {
        singlePanning = false;
        lastSingle = null;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [containerRef, setZoom]);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP)), [setZoom]);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP)), [setZoom]);

  return { zoom, zoomRef, pan, zoomIn, zoomOut, fitToView };
}
