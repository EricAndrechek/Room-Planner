/**
 * Typed facade over the PostHog web snippet (src/components/PostHog.astro), which stubs
 * `window.posthog` and queues calls until the SDK loads. When analytics is off (tests,
 * localhost, blocked) these are harmless no-ops. Keep payloads free of user content
 * (furniture names, project names): counts and enums only.
 */

export type AnalyticsEvent =
  | 'project_created'
  | 'project_opened'
  | 'project_renamed'
  | 'project_deleted'
  | 'furniture_added'
  | 'furniture_removed'
  | 'room_cleared'
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

const OPT_OUT_KEY = 'rp:analytics-optout';

const ph = (fn: (p: NonNullable<Window['posthog']>) => void): void => {
  try {
    if (window.posthog) fn(window.posthog);
  } catch {
    /* analytics must never break the app */
  }
};

/** Whether this visitor turned analytics off on this device (help page toggle). */
export function isAnalyticsOptedOut(): boolean {
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Record a product event. */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  ph((p) => p.capture(event, props));
}

/** Report an unexpected error. */
export function captureError(error: unknown, context?: ErrorContext): void {
  ph((p) => p.captureException(error, context));
}

/** Turn analytics off/on for this device. Persists, and applies to a running SDK. */
export function setAnalyticsEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.removeItem(OPT_OUT_KEY);
    else window.localStorage.setItem(OPT_OUT_KEY, '1');
  } catch {
    /* storage unavailable */
  }
  ph((p) => (enabled ? p.opt_in_capturing() : p.opt_out_capturing()));
}
