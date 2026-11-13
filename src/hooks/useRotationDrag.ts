import { useCallback } from 'react';
import {
  angleAround,
  angleDelta,
  normalizeDegrees,
  snapRotation,
  type Point,
} from '../lib/geometry';
import { usePointerDrag } from './usePointerDrag';

export interface RotationDragOptions {
  /** Rotation center in client (viewport) coordinates. */
  center: Point;
  /** The item's rotation when the drag starts (degrees, clockwise). */
  startRotation: number;
  /** Live rotation in [0, 360) while dragging. */
  onRotate: (deg: number) => void;
  /** Final rotation, normalized and snapped (see `snapRotation`). */
  onEnd: (deg: number) => void;
}

/**
 * Pointer-driven rotation handle (replaces the vendored Knob.js): the item
 * turns by the angle the pointer sweeps around the item's center, relative to
 * where it was grabbed, so it follows the pointer without jumping. Works for
 * mouse, touch and pen; on release it snaps to the nearest 15deg (every 45deg
 * and 90deg included) when within 5deg.
 */
export function useRotationDrag() {
  const startDrag = usePointerDrag();
  return useCallback(
    (e: { pointerId: number; clientX: number; clientY: number }, opts: RotationDragOptions) => {
      let lastAngle = angleAround(opts.center, { x: e.clientX, y: e.clientY });
      let rotation = opts.startRotation;
      startDrag(e, {
        onMove: (ev) => {
          const angle = angleAround(opts.center, { x: ev.clientX, y: ev.clientY });
          rotation += angleDelta(lastAngle, angle);
          lastAngle = angle;
          opts.onRotate(normalizeDegrees(rotation));
        },
        onEnd: () => opts.onEnd(snapRotation(rotation)),
      });
    },
    [startDrag],
  );
}
