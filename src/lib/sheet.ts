/**
 * The phone editor is a bottom sheet with three resting heights ("detents"): `peek` (a one-line
 * summary), `half` (the plan above, the controls below) and `full` (the editor over the plan).
 * Pure helpers: detent order, snapping a drag, the remembered detent and the summary line.
 */
import { DESIGN_MODES } from './constants';
import { feetToDisplay } from '../core/units';
import type { DesignMode, Layout, Selection, UnitSystem } from '../types';

export type Detent = 'peek' | 'half' | 'full';

/** Lowest to highest. */
export const DETENTS: readonly Detent[] = ['peek', 'half', 'full'];

/** Sheet heights (CSS px above the bottom of the screen) for each detent. */
export type DetentHeights = Record<Detent, number>;

/** `half` is this share of the screen height: the plan stays visible above it. */
export const HALF_RATIO = 0.45;

/** Where a session starts (a first visit too): the plan and the controls both in view. */
export const DEFAULT_DETENT: Detent = 'half';

/** The next detent up (+1) or down (-1), staying at the ends. */
export const stepDetent = (d: Detent, dir: 1 | -1): Detent =>
  DETENTS[Math.min(DETENTS.length - 1, Math.max(0, DETENTS.indexOf(d) + dir))]!;

/** Tapping the handle cycles peek -> half -> full -> peek. */
export const cycleDetent = (d: Detent): Detent =>
  DETENTS[(DETENTS.indexOf(d) + 1) % DETENTS.length]!;

/** How far ahead (ms) a release's velocity carries the sheet before it snaps. */
const MOMENTUM_MS = 180;
/** A release faster than this (px/ms) always moves at least one detent that way. */
const FLICK_SPEED = 0.5;

/**
 * Where a released drag settles. A quick flick goes on to the next detent in its direction (from
 * where the sheet is now); a slower release settles on the nearest detent, a little ahead of where
 * it was let go. `velocity` is the sheet's height change in px/ms (positive: growing, dragged up).
 */
export function snapDetent(height: number, velocity: number, heights: DetentHeights): Detent {
  if (Math.abs(velocity) >= FLICK_SPEED) {
    const ahead = DETENTS.filter((d) =>
      velocity > 0 ? heights[d] > height + 1 : heights[d] < height - 1,
    );
    if (ahead.length) return velocity > 0 ? ahead[0]! : ahead[ahead.length - 1]!;
    return velocity > 0 ? 'full' : 'peek';
  }
  const projected = height + velocity * MOMENTUM_MS;
  return DETENTS.reduce((best, d) =>
    Math.abs(heights[d] - projected) < Math.abs(heights[best] - projected) ? d : best,
  );
}

/** Heights for a screen: `peek` fits the summary row, `full` reaches the top bar. */
export function detentHeights(screen: number, peek: number, full: number): DetentHeights {
  const top = Math.max(peek, full);
  // Keep `half` clearly between the other two, even on a very short (landscape) screen.
  const half = Math.round(
    Math.min(Math.max(screen * HALF_RATIO, peek + (top - peek) / 3), top - (top - peek) / 4),
  );
  return { peek: Math.round(peek), half, full: Math.round(top) };
}

const STORAGE_KEY = 'room-planner-sheet';
const isDetent = (v: unknown): v is Detent => DETENTS.includes(v as Detent);

/** The detent last used this session (sessionStorage), or the default. */
export function loadDetent(): Detent {
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    return isDetent(v) ? v : DEFAULT_DETENT;
  } catch {
    return DEFAULT_DETENT;
  }
}

export function saveDetent(d: Detent): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, d);
  } catch {
    /* storage unavailable: the sheet just starts at the default next time */
  }
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The sheet's one-line summary: the selected piece, door or window, or else the active step,
 * e.g. `1. Room · 12' × 12' · 1 door · 1 window`, `2. Items · 6 pieces`, `Chair · 1'6" × 1'6"`.
 */
export function sheetSummary(
  layout: Pick<Layout, 'roomDims' | 'items' | 'doors' | 'windows'>,
  mode: DesignMode,
  selection: Selection | null,
  units: UnitSystem,
): string {
  const size = (w: number, h: number) => `${feetToDisplay(w, units)} × ${feetToDisplay(h, units)}`;
  if (selection?.type === 'item') {
    const item = layout.items.find((i) => i.id === selection.id);
    if (item) return `${item.label.trim() || 'Item'} · ${size(item.width, item.height)}`;
  } else if (selection) {
    const list = selection.type === 'door' ? layout.doors : layout.windows;
    const index = list.findIndex((o) => o.id === selection.id);
    if (index >= 0) {
      const name = selection.type === 'door' ? 'Door' : 'Window';
      return `${name} ${index + 1} · ${list[index]!.wall} wall`;
    }
  }
  if (mode === DESIGN_MODES.ROOM_SETUP) {
    const { width, height } = layout.roomDims;
    return [
      `1. Room · ${size(width, height)}`,
      layout.doors.length ? count(layout.doors.length, 'door') : '',
      layout.windows.length ? count(layout.windows.length, 'window') : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  const n = layout.items.length;
  return `2. Items · ${n ? count(n, 'piece') : 'no furniture yet'}`;
}
