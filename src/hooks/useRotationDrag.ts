import { useCallback } from 'react';
import {
  angleAround,
  angleDelta,
  snapAngle,
  type AngleSnap,
  type Point,
  type RotationSnapMode,
} from '../core/geometry';
import { usePointerDrag } from './usePointerDrag';

export interface RotationDragOptions {
  /** Rotation center in client (viewport) coordinates. */
  center: Point;
  /** The item's rotation when the drag starts (degrees, clockwise). */
  startRotation: number;
  /** Snapping preference (the Snap toggle): off rotates freely. */
  snapEnabled: () => boolean;
  /** Live rotation while dragging, and the angle it is locked onto (null when free). */
  onRotate: (angle: AngleSnap) => void;
  /** Final rotation: the angle shown when the pointer was released. */
  onEnd: (deg: number) => void;
}

/** Shift steps by 15deg; Alt/Option (or the Snap toggle off) rotates freely; else magnetic. */
const modeFor = (e: { shiftKey: boolean; altKey: boolean }, snap: boolean): RotationSnapMode =>
  e.shiftKey ? 'step' : e.altKey || !snap ? 'free' : 'magnetic';

/**
 * Pointer-driven rotation handle: the item turns by the angle the pointer sweeps around the item's
 * center, relative to where it was grabbed, so it follows the pointer without jumping. Works for
 * mouse, touch and pen. While dragging it is magnetic: it locks onto 0/90/180/270 within 8deg and
 * onto the diagonals within 5deg (see `snapAngle`); Shift steps by 15deg, Alt/Option is free.
 */
export function useRotationDrag() {
  const startDrag = usePointerDrag();
  return useCallback(
    (e: { pointerId: number; clientX: number; clientY: number }, opts: RotationDragOptions) => {
      let lastAngle = angleAround(opts.center, { x: e.clientX, y: e.clientY });
      let raw = opts.startRotation;
      let shown: AngleSnap = { deg: opts.startRotation, snapped: null };
      startDrag(e, {
        onMove: (ev) => {
          const angle = angleAround(opts.center, { x: ev.clientX, y: ev.clientY });
          raw += angleDelta(lastAngle, angle);
          lastAngle = angle;
          const next = snapAngle(raw, modeFor(ev, opts.snapEnabled()));
          // A tiny tick on phones that support it, once per lock (not on every move).
          if (next.snapped !== null && next.snapped !== shown.snapped) {
            try {
              navigator.vibrate?.(10);
            } catch {
              /* unsupported or blocked: no feedback */
            }
          }
          shown = next;
          opts.onRotate(next);
        },
        onEnd: () => opts.onEnd(shown.deg),
      });
    },
    [startDrag],
  );
}
