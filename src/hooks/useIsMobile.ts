import { useSyncExternalStore } from 'react';
import { MOBILE_BREAKPOINT } from '../lib/constants';

const subscribe = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};

/** True below the `md` breakpoint (768px), tracking window resizes. */
export function useIsMobile(breakpoint = MOBILE_BREAKPOINT): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth < breakpoint,
    () => false,
  );
}
