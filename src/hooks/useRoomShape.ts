import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { track } from '../lib/analytics';
import { PIXELS_PER_UNIT } from '../lib/constants';
import {
  addCorner as addCornerEdit,
  defaultLShape,
  moveCorner,
  removeCorner as removeCornerEdit,
  setRoomShape,
  setWallLength as setWallLengthEdit,
  type ShapeChoice,
} from '../lib/edits';
import { roomById, roomSize } from '../lib/plans';
import { floorBounds } from '../core/floor';
import { snapCorner, type CornerGuide } from '../core/geometry/corners';
import { roomBounds, roomShapeOf, wallLength, type LShape } from '../core/geometry/walls';
import { SNAP_THRESHOLD_PX, SNAP_THRESHOLD_TOUCH_PX, thresholdFeet } from '../core/snapping';
import { feetToDisplay, nudgeStep } from '../core/units';
import type { Plan, UnitSystem } from '../types';
import type { History } from './useHistory';
import type { usePointerDrag } from './usePointerDrag';

type Bounds = ReturnType<typeof roomBounds>;

/** A corner being dragged: which, the guides it lines up with, and whether it hit another wall. */
export interface CornerDrag {
  index: number;
  guides: CornerGuide[];
}

interface Options {
  history: History<Plan>;
  unitSystem: UnitSystem;
  isRoomSetup: boolean;
  snapEnabled: boolean;
  announce: (text: string) => void;
  startDrag: ReturnType<typeof usePointerDrag>;
  zoomRef: RefObject<number>;
  /** The canvas: corner handles are found in it, and the floor's origin marker. */
  containerRef: RefObject<HTMLElement | null>;
  /** Keep the plan where it is on screen while the room's bounding box changes (a drag). */
  keepView: (prev: Bounds, next: Bounds) => void;
  /** After an edit that changed the walls: offer to bring pieces now outside back in. */
  onWallsChanged: (before: Plan, after: Plan) => void;
  /** A corner was selected: whatever else was selected is not any more. */
  onSelectCorner: () => void;
  /** The room being edited. */
  roomId: string;
}

/** "Corner 3" for corner index 2. */
export const cornerName = (i: number) => `Corner ${i + 1}`;

/**
 * The room's shape (docs/design/plan-format.md, section 9): the Shape control (Rectangle, L-shape,
 * Custom), and in Custom the corners: dragged with snapping, nudged with the arrow keys, added in
 * the middle of a wall, removed; and wall lengths typed in the wall list. Every edit is one undo
 * step through core/ops.ts, which keeps the outline simple and the doors and windows on their
 * walls; an edit that would make walls cross is refused and said so.
 */
export function useRoomShape({
  history,
  unitSystem,
  isRoomSetup,
  snapEnabled,
  announce,
  startDrag,
  zoomRef,
  containerRef,
  keepView,
  onWallsChanged,
  onSelectCorner,
  roomId,
}: Options) {
  const { present: plan, set: setPlan, apply: applyPlan, commit } = history;
  const room = roomById(plan, roomId);
  const planRef = useRef(plan);
  useEffect(() => {
    planRef.current = plan;
  });

  // Custom is kept once chosen (a rectangle can be edited corner by corner); otherwise the shape
  // control shows what the outline is.
  const [customChosen, setCustomChosen] = useState(false);
  const detected = roomShapeOf(room);
  const shape: ShapeChoice = customChosen || detected === 'custom' ? 'custom' : detected;
  const editingCorners = isRoomSetup && shape === 'custom';

  const [corner, setCorner] = useState<number | null>(null);
  const [wall, setWall] = useState<number | null>(null);
  const [drag, setDrag] = useState<CornerDrag | null>(null);
  const n = room.outline.length;
  const selectedCorner = editingCorners && corner !== null && corner < n ? corner : null;

  const len = (feet: number) => feetToDisplay(feet, unitSystem);
  const wallsAt = (p: Plan, i: number) => {
    const r = roomById(p, roomId);
    const count = r.outline.length;
    const before = (i - 1 + count) % count;
    return `Wall ${before + 1} is ${len(wallLength(r, before))}, wall ${i + 1} is ${len(wallLength(r, i))}`;
  };

  /** Select a corner (and nothing else); focus moves to its handle when `focus` is set. */
  const selectCorner = useCallback(
    (i: number | null, focus = false) => {
      setCorner(i);
      if (i === null) return;
      onSelectCorner();
      if (focus) {
        requestAnimationFrame(() =>
          containerRef.current
            ?.querySelector<HTMLElement>(`[data-corner="${i}"]`)
            ?.focus({ preventScroll: true }),
        );
      }
    },
    [containerRef, onSelectCorner],
  );
  const clearCorner = useCallback(() => setCorner(null), []);

  // --- The Shape control ---------------------------------------------------------------------

  const changeShape = (next: ShapeChoice) => {
    if (next === shape) return;
    track('room_shape_changed', { shape: next });
    if (next === 'custom') {
      setCustomChosen(true);
      announce(
        `Custom shape. Drag a corner to move it, or use the wall list. ${n} corners, ${n} walls.`,
      );
      return;
    }
    setCustomChosen(false);
    setCorner(null);
    const before = planRef.current;
    const after = setRoomShape(
      before,
      next === 'rect'
        ? { kind: 'rect' }
        : { kind: 'l', l: defaultLShape(roomSize(roomById(before, roomId))) },
      roomId,
    );
    if (after !== before) {
      applyPlan(() => after);
      onWallsChanged(before, after);
    }
    announce(next === 'rect' ? 'Rectangle room' : 'L-shaped room');
  };

  /** New L-shape fields (one undo step). */
  const changeLShape = (l: LShape) => {
    const before = planRef.current;
    const after = setRoomShape(before, { kind: 'l', l }, roomId);
    if (after === before) return;
    applyPlan(() => after);
    onWallsChanged(before, after);
  };

  // --- Corners ---------------------------------------------------------------------------------

  /** Where the pointer is in floor coordinates (feet), from the floor's origin marker. */
  const floorPoint = (clientX: number, clientY: number) => {
    const origin = containerRef.current?.querySelector('[data-floor-origin]');
    if (!origin) return null;
    const r = origin.getBoundingClientRect();
    const scale = PIXELS_PER_UNIT * zoomRef.current;
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };

  const refused = (i: number) =>
    announce(`${cornerName(i)} can't go there: walls would cross or touch.`);

  /** Drag a corner handle (room setup, Custom shape). */
  const startCornerDrag = (e: ReactPointerEvent<HTMLElement>, i: number) => {
    if (!editingCorners || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.stopPropagation();
    e.preventDefault();
    selectCorner(i);
    const start = floorPoint(e.clientX, e.clientY);
    const first = planRef.current;
    const at = roomById(first, roomId).outline[i];
    if (!start || !at) return;
    // The pointer may grab the handle off its centre: keep that offset.
    const grab = { x: at.x - start.x, y: at.y - start.y };
    const thresholdPx = e.pointerType === 'touch' ? SNAP_THRESHOLD_TOUCH_PX : SNAP_THRESHOLD_PX;
    let latest = first;
    let blocked = false;
    let moved = false;
    setDrag({ index: i, guides: [] });
    startDrag(e, {
      onMove: (ev) => {
        const p = floorPoint(ev.clientX, ev.clientY);
        if (!p) return;
        const raw = { x: p.x + grab.x, y: p.y + grab.y };
        const r = roomById(latest, roomId);
        const snapped =
          snapEnabled && !ev.altKey
            ? snapCorner(r, i, raw, {
                threshold: thresholdFeet(thresholdPx, zoomRef.current, PIXELS_PER_UNIT),
                step: nudgeStep('normal', unitSystem),
              })
            : {
                point: {
                  x: Math.round(raw.x * 1e4) / 1e4,
                  y: Math.round(raw.y * 1e4) / 1e4,
                },
                guides: [],
              };
        const cur = r.outline[i]!;
        if (cur.x === snapped.point.x && cur.y === snapped.point.y) return;
        const next = moveCorner(latest, i, snapped.point, roomId);
        if (next === latest) {
          // The corner stops at its last good position.
          blocked = true;
          return;
        }
        moved = true;
        keepView(floorBounds(latest), floorBounds(next));
        latest = next;
        setPlan(() => next);
        setDrag({ index: i, guides: snapped.guides });
      },
      onEnd: () => {
        setDrag(null);
        if (!moved) {
          if (blocked) refused(i);
          return;
        }
        commit();
        announce(
          `${cornerName(i)} moved. ${wallsAt(latest, i)}.${blocked ? ' It stopped where walls would cross.' : ''}`,
        );
        onWallsChanged(first, latest);
      },
    });
  };

  /** Arrow keys on the selected corner: move it by (dx, dy) feet. True if a corner is selected. */
  const nudgeCorner = (dx: number, dy: number): boolean => {
    if (selectedCorner === null) return false;
    const i = selectedCorner;
    const before = planRef.current;
    const at = roomById(before, roomId).outline[i]!;
    const clean = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
    const after = moveCorner(before, i, { x: clean(at.x + dx), y: clean(at.y + dy) }, roomId);
    if (after === before) {
      refused(i);
      return true;
    }
    keepView(floorBounds(before), floorBounds(after));
    applyPlan(() => after);
    announce(`${cornerName(i)} moved. ${wallsAt(after, i)}`);
    onWallsChanged(before, after);
    return true;
  };

  /** A new corner in the middle of `wallIndex`, selected (and focused). */
  const addCorner = (wallIndex: number) => {
    const before = planRef.current;
    const after = addCornerEdit(before, wallIndex, roomId);
    if (after === before) {
      announce(`A corner can't be added to wall ${wallIndex + 1}.`);
      return;
    }
    applyPlan(() => after);
    const count = roomById(after, roomId).outline.length;
    track('room_corner_added', { corners: count });
    selectCorner(wallIndex + 1, true);
    announce(
      `${cornerName(wallIndex + 1)} added in the middle of wall ${wallIndex + 1}. Drag it or use the arrow keys to move it.`,
    );
  };

  /** Remove the selected corner (Delete key, or its Remove button). True if one was selected. */
  const removeCorner = (i: number | null = selectedCorner): boolean => {
    if (i === null || !editingCorners) return false;
    const before = planRef.current;
    if (roomById(before, roomId).outline.length <= 3) {
      announce('A room needs at least 3 corners.');
      return true;
    }
    const after = removeCornerEdit(before, i, roomId);
    if (after === before) {
      announce(`${cornerName(i)} can't be removed: walls would cross or touch.`);
      return true;
    }
    keepView(floorBounds(before), floorBounds(after));
    applyPlan(() => after);
    track('room_corner_removed', { corners: roomById(after, roomId).outline.length });
    setCorner(null);
    announce(`${cornerName(i)} removed. Press Control or Command Z to undo.`);
    onWallsChanged(before, after);
    return true;
  };

  /** A wall's length typed in the wall list. False (nothing changes) if walls would cross. */
  const setWallLength = (wallIndex: number, length: number): boolean => {
    const before = planRef.current;
    const after = setWallLengthEdit(before, wallIndex, length, roomId);
    if (after === before) {
      if (Math.abs(wallLength(roomById(before, roomId), wallIndex) - length) < 1e-9) return true;
      announce(`Wall ${wallIndex + 1} can't be ${len(length)}: walls would cross or touch.`);
      return false;
    }
    applyPlan(() => after);
    announce(`Wall ${wallIndex + 1} is ${len(length)}`);
    onWallsChanged(before, after);
    return true;
  };

  /** Another plan was opened: start from its own shape. */
  const resetShape = useCallback(() => {
    setCustomChosen(false);
    setCorner(null);
    setWall(null);
  }, [setCustomChosen, setCorner, setWall]);

  return {
    shape,
    editingCorners,
    selectedCorner,
    highlightedWall: editingCorners ? wall : null,
    drag,
    changeShape,
    changeLShape,
    selectCorner,
    clearCorner,
    highlightWall: setWall,
    startCornerDrag,
    nudgeCorner,
    addCorner,
    removeCorner,
    setWallLength,
    resetShape,
  };
}
