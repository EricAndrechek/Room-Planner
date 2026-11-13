/**
 * Analytics / error-reporting seam, backed by PostHog (posthog-js).
 *
 * The SDK is lazy-loaded (`initAnalytics`, called after first paint) so it never
 * blocks the planner; `track` / `captureError` calls made before it is ready are
 * queued. With no PUBLIC_POSTHOG_KEY, in dev, or under automation (webdriver)
 * everything is a silent no-op. Keep payloads free of user content (furniture
 * names, project names): counts and enums only.
 */

export type AnalyticsEvent =
  | 'project_created'
  | 'project_opened'
  | 'project_renamed'
  | 'project_deleted'
  | 'furniture_added'
  | 'furniture_removed'
  | 'door_added'
  | 'window_added'
  | 'share_link_created'
  | 'share_link_opened'
  | 'export_json'
  | 'import_json'
  | 'units_changed'
  | 'mode_changed'
  | 'undo'
  | 'redo'
  | 'pwa_install_prompted'
  | 'pwa_installed'
  | 'app_update_applied'
  | 'storage_persist_result';

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

export interface ErrorContext {
  /** Where the error was caught, e.g. `error_boundary`, `share_link`. */
  source?: string;
  [key: string]: unknown;
}

type PostHog = typeof import('posthog-js').default;
type Job = (ph: PostHog) => void;

const KEY: string = import.meta.env.PUBLIC_POSTHOG_KEY ?? '';
const HOST: string = import.meta.env.PUBLIC_POSTHOG_HOST || '/ingest';
const UI_HOST = 'https://us.posthog.com';
const DEPLOY_ENV: string = import.meta.env.PUBLIC_DEPLOY_ENV || 'production';

const DEBUG_KEY = 'rp:analytics-debug';
const OPT_OUT_KEY = 'rp:analytics-optout';
const MAX_QUEUE = 100;

let queue: Job[] = [];
let ph: PostHog | null = null;
let state: 'idle' | 'loading' | 'ready' | 'disabled' = 'idle';

const readLocal = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const debugRequested = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    readLocal(DEBUG_KEY) === '1' ||
    new URLSearchParams(window.location.search).has('__posthog_debug')
  );
};

/** Whether this visitor turned analytics off on this device (help page toggle). */
export function isAnalyticsOptedOut(): boolean {
  return typeof window !== 'undefined' && readLocal(OPT_OUT_KEY) === '1';
}

function run(job: Job): void {
  if (state === 'disabled') return;
  if (ph) {
    try {
      job(ph);
    } catch {
      /* analytics must never break the app */
    }
  } else if (queue.length < MAX_QUEUE) {
    queue.push(job);
  }
}

/**
 * Load and configure PostHog (idempotent). Call once per page, after first paint.
 * Never throws; a failed load just disables analytics for the page view.
 */
export function initAnalytics(): void {
  if (state !== 'idle' || typeof window === 'undefined') return;
  const debug = debugRequested();
  const automated = typeof navigator !== 'undefined' && navigator.webdriver;
  if (!KEY || ((import.meta.env.DEV || automated) && !debug)) {
    state = 'disabled';
    queue = [];
    return;
  }
  state = 'loading';
  const start = () => {
    import('posthog-js')
      .then(({ default: posthog }) => {
        posthog.init(KEY, {
          api_host: HOST,
          ui_host: UI_HOST,
          defaults: '2026-08-30',
          // Anonymous app: no identify() calls, so no person profiles.
          person_profiles: 'identified_only',
          capture_exceptions: true,
          respect_dnt: true,
          opt_out_capturing_by_default: isAnalyticsOptedOut(),
          session_recording: { maskAllInputs: true },
          debug,
          // Let headless-browser integration tests through the bot filter (debug mode only).
          opt_out_useragent_filter: debug,
          loaded: (client) => {
            client.register({
              app_version: __APP_VERSION__,
              // Debug/test traffic is always labelled so it is filterable.
              environment: debug ? 'development' : DEPLOY_ENV,
            });
            if (debug) {
              (window as unknown as { __rpTestError?: () => void }).__rpTestError = () =>
                client.captureException(new Error('rp-integration-test'), { source: 'test' });
            }
          },
        });
        ph = posthog;
        state = 'ready';
        const jobs = queue;
        queue = [];
        jobs.forEach(run);
      })
      .catch(() => {
        state = 'disabled';
        queue = [];
      });
  };
  // Keep the SDK off the critical path.
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 200);
}

/** Record a product event. */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  run((p) => p.capture(event, props));
}

/** Report an unexpected error. */
export function captureError(error: unknown, context?: ErrorContext): void {
  run((p) => p.captureException(error, context));
}

/** Turn analytics off/on for this device. Persists, and applies to a running SDK. */
export function setAnalyticsEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.removeItem(OPT_OUT_KEY);
    else window.localStorage.setItem(OPT_OUT_KEY, '1');
  } catch {
    /* storage unavailable */
  }
  run((p) => (enabled ? p.opt_in_capturing() : p.opt_out_capturing()));
}
