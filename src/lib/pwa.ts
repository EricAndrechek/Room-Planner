/**
 * PWA runtime: service-worker registration, update/offline notices, the install
 * prompt and storage persistence. A tiny external store (no React) so the
 * registration happens once per page and any component can subscribe.
 */
import { registerSW } from 'virtual:pwa-register';
import { track } from './analytics';

/** Chromium's install-prompt event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
  /** A new build is installed and waiting; reloading activates it. */
  needRefresh: boolean;
  /** The app was just cached for offline use for the first time. */
  offlineReady: boolean;
  /** The browser offered installation (Chromium only). */
  canInstall: boolean;
  /** Running as an installed app already. */
  standalone: boolean;
}

const OFFLINE_NOTICE_KEY = 'room-planner-offline-notice';
const UPDATE_CHECK_MS = 60 * 60 * 1000;

const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true);

let state: PwaState = {
  needRefresh: false,
  offlineReady: false,
  canInstall: false,
  standalone: isStandalone(),
};
const listeners = new Set<() => void>();
const setState = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const subscribePwa = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getPwaState = () => state;

const flag = {
  get(key: string): boolean {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  },
  set(key: string) {
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* private mode: the notice may repeat, nothing else */
    }
  },
};

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
let started = false;

/** Register the service worker and start listening for install events. Idempotent, browser only. */
export function initPwa(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    if (!isStandalone()) setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    setState({ canInstall: false, standalone: true });
    track('pwa_installed');
  });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', () => {
    setState({ standalone: isStandalone() });
  });

  if (!('serviceWorker' in navigator)) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => setState({ needRefresh: true }),
    onOfflineReady: () => {
      if (flag.get(OFFLINE_NOTICE_KEY)) return;
      flag.set(OFFLINE_NOTICE_KEY);
      setState({ offlineReady: true });
    },
    onRegisteredSW: (_url, registration) => {
      if (!registration) return;
      // Long-lived tabs and installed apps should notice new builds without a manual reload.
      const check = () => {
        if (navigator.onLine) registration.update().catch(() => {});
      };
      setInterval(check, UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}

/** Activate the waiting service worker and reload. Data autosaves, so this is safe. */
export function applyUpdate(): void {
  track('app_update_applied');
  // Reload on controllerchange ourselves: workbox-window only reloads when the page already had
  // a controller at registration, which is not true for a tab that has been open since the first visit.
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  });
  void updateSW?.(false);
}

export function dismissOfflineReady(): void {
  setState({ offlineReady: false });
}

export function dismissUpdate(): void {
  setState({ needRefresh: false });
}

/** Show the browser's install dialog (only possible after `beforeinstallprompt`). */
export async function promptInstall(): Promise<void> {
  const event = deferredPrompt;
  if (!event) return;
  track('pwa_install_prompted');
  deferredPrompt = null;
  setState({ canInstall: false });
  try {
    await event.prompt();
    await event.userChoice;
  } catch {
    /* the browser refused to show it; nothing to recover */
  }
}
