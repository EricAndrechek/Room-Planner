import { useCallback, useEffect, useRef, useState } from 'react';
import { warningText, type ItemWarning } from '../lib/geometry';
import { feetToDisplay } from '../lib/units';
import type { FurnitureItem, Id, Layout, SaveStatus, UnitSystem } from '../types';

/** Rapid changes (key repeat, drags) are coalesced into one announcement. */
const DEBOUNCE_MS = 350;

const describeItem = (item: FurnitureItem, unitSystem: UnitSystem) =>
  `${feetToDisplay(item.x, unitSystem)}, ${feetToDisplay(item.y, unitSystem)}`;

/** Spoken summary of what changed between two layouts (items only), or ''. */
export function describeLayoutChange(prev: Layout, next: Layout, unitSystem: UnitSystem): string {
  const before = new Map(prev.items.map((i) => [i.id, i]));
  const parts: string[] = [];
  for (const item of next.items) {
    const old = before.get(item.id);
    if (!old) {
      parts.push(`${item.label} added`);
      continue;
    }
    if (old.x !== item.x || old.y !== item.y) {
      parts.push(`${item.label} moved to ${describeItem(item, unitSystem)}`);
    }
    if (old.rotation !== item.rotation) parts.push(`${item.label} rotated ${item.rotation}°`);
    if (!!old.locked !== !!item.locked) {
      parts.push(`${item.label} ${item.locked ? 'locked' : 'unlocked'}`);
    }
  }
  const nextIds = new Set(next.items.map((i) => i.id));
  for (const old of prev.items) if (!nextIds.has(old.id)) parts.push(`${old.label} removed`);
  return parts.slice(0, 3).join('. ');
}

/** Newly appearing overlap / out-of-bounds warnings, spoken. */
export function describeNewWarnings(
  prev: Map<Id, ItemWarning>,
  next: Map<Id, ItemWarning>,
  items: FurnitureItem[],
): string {
  const parts: string[] = [];
  for (const item of items) {
    const now = next.get(item.id);
    if (!now || (!now.collision && !now.outOfBounds)) continue;
    const was = prev.get(item.id);
    const isNew = (now.collision && !was?.collision) || (now.outOfBounds && !was?.outOfBounds);
    if (isNew) parts.push(`Warning: ${item.label}. ${warningText(now, true)}`);
  }
  return parts.slice(0, 2).join('. ');
}

/**
 * Debounced text for a polite `aria-live` region: moves, rotations, new
 * collisions, undo/redo and saves. `noteAction('Undo')` prefixes the next
 * layout-change announcement so "Undo. Bed moved to …" is spoken as one.
 */
export function useAnnouncements(
  layout: Layout,
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
    queue([act, change, newWarnings].filter(Boolean).join('. '));
  }, [layout, warnings, unitSystem, queue]);

  useEffect(() => {
    if (prevSave.current !== 'saved' && saveStatus === 'saved') queue('Project saved');
    prevSave.current = saveStatus;
  }, [saveStatus, queue]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { message, noteAction, announce: queue };
}
