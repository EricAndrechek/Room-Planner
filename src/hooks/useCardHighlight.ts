import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../lib/browser';
import type { Id } from '../types';

/** A sidebar card to bring into view: a just-added door, window or piece, or one tapped on the plan. */
export interface CardRef {
  type: 'door' | 'window' | 'item';
  id: Id;
  /** Orders requests (see `nextCardSeq`): the same card asked for again is brought back again. */
  seq?: number;
  /** `start`: scroll the card to the top of the list (a piece tapped on the plan, on phones). */
  align?: 'start' | 'nearest';
}

let seq = 0;
/** A new request number, so a newer request wins (`latestCard`) and a repeat is not ignored. */
export const nextCardSeq = (): number => ++seq;

/** The newer of two card requests. */
export const latestCard = <T extends CardRef>(a: T | null | undefined, b: T | null | undefined) =>
  !a ? b : !b ? a : (b.seq ?? 0) > (a.seq ?? 0) ? b : a;

/** How long a new card stays highlighted. */
const HIGHLIGHT_MS = 1500;
/** The phone sheet's resize animation (300ms), and a little more. */
export const SHEET_SETTLE_MS = 320;
const cardKey = (o: CardRef) => `${o.type}:${o.id}`;

/**
 * Bring a card into view (inside the sidebar, which is the scrolling bottom sheet on phones) and
 * report whether it should still glow.
 */
export function useCardHighlight(highlight: CardRef | null | undefined) {
  const cards = useRef(new Map<string, HTMLElement>());
  const [faded, setFaded] = useState<string | null>(null);
  const key = highlight ? cardKey(highlight) : null;
  const request = highlight ? `${key}#${highlight.seq ?? 0}` : null;
  const block = highlight?.align ?? 'nearest';

  useEffect(() => {
    if (!key || !request) return;
    const card = cards.current.get(key);
    const show = () =>
      card?.scrollIntoView({ block, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    show();
    // On a phone the sheet may be changing height at the same time (opening to show the card):
    // once it has settled at another height, bring the card into view again.
    const sheet = card?.closest<HTMLElement>('[data-sheet-content]');
    const height = sheet?.clientHeight;
    const settled = setTimeout(() => {
      if (sheet && sheet.clientHeight !== height) show();
    }, SHEET_SETTLE_MS);
    const timer = setTimeout(() => setFaded(request), HIGHLIGHT_MS);
    return () => {
      clearTimeout(settled);
      clearTimeout(timer);
    };
  }, [key, request, block]);

  /** Ref callback registering a card under its key. */
  const register = (o: CardRef) => (el: HTMLElement | null) => {
    if (el) cards.current.set(cardKey(o), el);
    else cards.current.delete(cardKey(o));
  };
  const isHighlighted = (o: CardRef) => key === cardKey(o) && faded !== request;
  return { register, isHighlighted };
}

/** Ring that fades out (transition) when the highlight ends; instant with reduced motion. */
export const glowClass = (on: boolean, ring: string) =>
  `scroll-mt-3 scroll-mb-4 transition-shadow duration-700 ${on ? `ring-2 ${ring}` : ''}`;
