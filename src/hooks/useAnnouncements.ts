import { useCallback, useEffect, useRef, useState } from 'react';
import { warningText, type ItemWarning } from '../core/geometry';
import { feetToDisplay } from '../core/units';
import { boxOf, doorsOf, mainRoom, windowsOf } from '../lib/plans';
import type { Id, Item, Plan, SaveStatus, UnitSystem } from '../types';

/** Rapid changes (key repeat, drags) are coalesced into one announcement. */
const DEBOUNCE_MS = 350;

/** Where a piece is, as its box's top-left corner. */
const describeItem = (item: Item, unitSystem: UnitSystem) => {
  const { x, y } = boxOf(item);
  return `${feetToDisplay(x, unitSystem)}, ${feetToDisplay(y, unitSystem)}`;
};

const rotationOf = (item: Item) => item.placement?.rotation ?? 0;

/** A piece's shape as spoken: "a rectangle", "L-shaped", "round" (or "oval"). */
const shapeName = (item: Item) =>
  item.shape === 'l'
    ? 'L-shaped'
    : item.shape === 'ellipse'
      ? item.width === item.depth
        ? 'round'
        : 'oval'
      : 'a rectangle';

const CORNER_NAMES = {
  tl: 'top left',
  tr: 'top right',
  br: 'bottom right',
  bl: 'bottom left',
} as const;

/** Spoken summary of what changed between two plans (pieces only), or ''. */
export function describeLayoutChange(prev: Plan, next: Plan, unitSystem: UnitSystem): string {
  const before = new Map(prev.items.map((i) => [i.id, i]));
  const parts: string[] = [];
  for (const item of next.items) {
    const old = before.get(item.id);
    if (!old) {
      parts.push(`${item.label} added`);
      continue;
    }
    if (!!old.placement !== !!item.placement) {
      parts.push(`${item.label} ${item.placement ? 'placed in the room' : 'moved to inventory'}`);
      continue;
    }
    if (
      old.placement?.x !== item.placement?.x ||
      old.placement?.y !== item.placement?.y ||
      old.width !== item.width ||
      old.depth !== item.depth
    ) {
      const was = boxOf(old);
      const now = boxOf(item);
      // A resize keeps the corner (to within rounding): not a move.
      if (Math.abs(was.x - now.x) > 1e-9 || Math.abs(was.y - now.y) > 1e-9) {
        parts.push(`${item.label} moved to ${describeItem(item, unitSystem)}`);
      }
    }
    if (rotationOf(old) !== rotationOf(item)) {
      parts.push(`${item.label} rotated ${rotationOf(item)}°`);
    }
    if (old.shape !== item.shape) {
      parts.push(`${item.label} is now ${shapeName(item)}`);
    } else if (old.cut && item.cut && old.cut.corner !== item.cut.corner) {
      parts.push(`${item.label}: cut at the ${CORNER_NAMES[item.cut.corner]} corner`);
    }
    if (!!old.locked !== !!item.locked) {
      parts.push(`${item.label} ${item.locked ? 'locked' : 'unlocked'}`);
    }
  }
  const nextIds = new Set(next.items.map((i) => i.id));
  for (const old of prev.items) if (!nextIds.has(old.id)) parts.push(`${old.label} removed`);
  return parts.slice(0, 3).join('. ');
}

/** Doors/windows that came back or went away (spoken after undo/redo), or ''. */
export function describeOpeningsChange(prev: Plan, next: Plan): string {
  const parts: string[] = [];
  const diff = (before: number, after: number, kind: string) => {
    if (after > before) parts.push(`${kind} restored`);
    else if (after < before) parts.push(`${kind} removed`);
  };
  diff(doorsOf(mainRoom(prev)).length, doorsOf(mainRoom(next)).length, 'Door');
  diff(windowsOf(mainRoom(prev)).length, windowsOf(mainRoom(next)).length, 'Window');
  return parts.join('. ');
}

/** Newly appearing overlap / out-of-bounds warnings, spoken. */
export function describeNewWarnings(
  prev: Map<Id, ItemWarning>,
  next: Map<Id, ItemWarning>,
  items: readonly Item[],
): string {
  const parts: string[] = [];
  for (const item of items) {
    const now = next.get(item.id);
    if (!now) continue;
    const was = prev.get(item.id);
    if (now.collision || now.outOfBounds) {
      const isNew = (now.collision && !was?.collision) || (now.outOfBounds && !was?.outOfBounds);
      if (isNew) parts.push(`Warning: ${item.label}. ${warningText(now, true)}`);
    }
    if (now.blocksDoor && !was?.blocksDoor) parts.push(`${item.label} blocks a door`);
    else if (now.blocksDoorway && !now.blocksDoor && !was?.blocksDoorway && !was?.blocksDoor) {
      parts.push(`${item.label} is in a doorway`);
    }
  }
  return parts.slice(0, 2).join('. ');
}

/**
 * Debounced text for a polite `aria-live` region: moves, rotations, new
 * collisions, undo/redo and saves. `noteAction('Undo')` prefixes the next
 * layout-change announcement so "Undo. Bed moved to …" is spoken as one.
 */
export function useAnnouncements(
  layout: Plan,
  warnings: Map<Id, ItemWarning>,
  unitSystem: UnitSystem,
  saveStatus: SaveStatus,
) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string[]>([]);
  const prevLayout = useRef(layout);
  const prevWarnings = useRef(warnings);
  const prevSave = useRef(saveStatus);
  const action = useRef<string | null>(null);
  const flushedOnce = useRef(false);

  const queue = useCallback((text: string) => {
    if (!text) return;
    pending.current.push(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // Alternate a trailing non-breaking space so identical repeats are re-announced.
      flushedOnce.current = !flushedOnce.current;
      setMessage(pending.current.join('. ') + (flushedOnce.current ? '' : ' '));
      pending.current = [];
    }, DEBOUNCE_MS);
  }, []);

  /** Call right before triggering an undo/redo so the result is spoken with it. */
  const noteAction = useCallback(
    (name: string) => {
      action.current = name;
      // If nothing visible changes, still confirm the action.
      queue(name);
    },
    [queue],
  );

  useEffect(() => {
    const prev = prevLayout.current;
    prevLayout.current = layout;
    if (prev === layout) return;
    const change = describeLayoutChange(prev, layout, unitSystem);
    const prevW = prevWarnings.current;
    // Warnings are derived from the same layout, so they are already current here.
    const newWarnings = describeNewWarnings(prevW, warnings, layout.items);
    prevWarnings.current = warnings;
    const act = action.current;
    action.current = null;
    if (act) {
      // Replace the bare "Undo" queued by noteAction with the detailed version.
      pending.current = pending.current.filter((m) => m !== act);
    }
    // Openings are announced by their own actions; after undo/redo say what came back or went.
    const openings = act ? describeOpeningsChange(prev, layout) : '';
    queue([act, change, openings, newWarnings].filter(Boolean).join('. '));
  }, [layout, warnings, unitSystem, queue]);

  useEffect(() => {
    if (prevSave.current !== 'saved' && saveStatus === 'saved') queue('Project saved');
    prevSave.current = saveStatus;
  }, [saveStatus, queue]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { message, noteAction, announce: queue };
}
