import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../lib/browser';
import type { Id } from '../types';

/** A sidebar card to bring into view: a just-added door, window or furniture piece. */
export interface CardRef {
  type: 'door' | 'window' | 'item';
  id: Id;
}

/** How long a new card stays highlighted. */
const HIGHLIGHT_MS = 1500;
const cardKey = (o: CardRef) => `${o.type}:${o.id}`;

/**
 * Bring the card of a just-added door/window/piece into view (inside the sidebar, which is the
 * scrolling sheet on phones) and report whether it should still glow.
 */
export function useCardHighlight(highlight: CardRef | null | undefined) {
  const cards = useRef(new Map<string, HTMLElement>());
  const [faded, setFaded] = useState<string | null>(null);
  const key = highlight ? cardKey(highlight) : null;

  useEffect(() => {
    if (!key) return;
    cards.current.get(key)?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    const timer = setTimeout(() => setFaded(key), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [key]);

  /** Ref callback registering a card under its key. */
  const register = (o: CardRef) => (el: HTMLElement | null) => {
    if (el) cards.current.set(cardKey(o), el);
    else cards.current.delete(cardKey(o));
  };
  const isHighlighted = (o: CardRef) => key === cardKey(o) && faded !== key;
  return { register, isHighlighted };
}

/** Ring that fades out (transition) when the highlight ends; instant with reduced motion. */
export const glowClass = (on: boolean, ring: string) =>
  `scroll-mt-20 scroll-mb-4 transition-shadow duration-700 ${on ? `ring-2 ${ring}` : ''}`;
