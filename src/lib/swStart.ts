/**
 * Cold start on the newest build. A service worker that installed while the app was open waits
 * until every tab of the old one has gone; an installed app (above all on a phone, where the OS
 * keeps it alive) may never get there, and stays on an old build for weeks. So before the planner
 * mounts, and so before any edit, a waiting worker is told to take over and the page reloads once
 * onto it. Everything autosaves, and nothing has been edited yet, so nothing is lost.
 *
 * Updates found later in a session keep the "Update available" toast (pwa.ts): reloading under a
 * user's hands is not ours to decide.
 *
 * No workbox-window here: the generated worker answers `{type: 'SKIP_WAITING'}` itself
 * (Workbox `generateSW` with `skipWaiting: false`), and this module is loaded on every visit.
 */

/** Set (to a time) just before the reload, so a worker that will not activate cannot loop us. */
export const RELOAD_KEY = 'room-planner-sw-start-reload';
/** How long a reload guard holds: a second reload within this is not attempted. */
const GUARD_MS = 60_000;

export interface StartUpdateEnv {
  serviceWorker?: Pick<ServiceWorkerContainer, 'getRegistration' | 'controller'> &
    Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  session?: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload: () => void;
  now?: () => number;
  /** How long to wait for the registration and then for the new worker (ms). */
  timeoutMs?: number;
}

const browserEnv = (): StartUpdateEnv | null => {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  let session: Storage | null = null;
  try {
    session = window.sessionStorage;
  } catch {
    /* blocked storage: no guard, so no reload either (see below) */
  }
  return {
    serviceWorker: navigator.serviceWorker,
    session,
    reload: () => window.location.reload(),
  };
};

const within = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);

/**
 * Activate a waiting service worker and reload onto it. Resolves `true` when the page is about to
 * reload (do not mount the planner), `false` to carry on as usual: no service worker, nothing
 * waiting, a first visit (no controller), a reload already tried this minute, storage blocked
 * (the guard cannot be kept), or a worker that did not take over in time.
 */
export async function activateWaitingWorker(
  env: StartUpdateEnv | null = browserEnv(),
): Promise<boolean> {
  const sw = env?.serviceWorker;
  if (!env || !sw || !sw.controller || !env.session) return false;
  const now = env.now ?? Date.now;
  const timeoutMs = env.timeoutMs ?? 1500;
  try {
    const last = Number(env.session.getItem(RELOAD_KEY) ?? 0);
    if (last && now() - last < GUARD_MS) return false;
    const registration = await within(sw.getRegistration(), timeoutMs);
    const waiting = registration?.waiting;
    if (!waiting) return false;
    env.session.setItem(RELOAD_KEY, String(now()));

    return await new Promise<boolean>((resolve) => {
      const onChange = () => {
        clearTimeout(timer);
        resolve(true);
        env.reload();
      };
      const timer = setTimeout(() => {
        sw.removeEventListener('controllerchange', onChange);
        resolve(false);
      }, timeoutMs);
      sw.addEventListener('controllerchange', onChange, { once: true });
      waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  } catch {
    return false;
  }
}
