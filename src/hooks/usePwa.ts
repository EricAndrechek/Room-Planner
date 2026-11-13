import { useEffect, useSyncExternalStore } from 'react';
import { getPwaState, initPwa, subscribePwa, type PwaState } from '../lib/pwa';

/** PWA state for components; the first caller registers the service worker. */
export function usePwa(): PwaState {
  useEffect(() => initPwa(), []);
  return useSyncExternalStore(subscribePwa, getPwaState, getPwaState);
}
