/**
 * Analytics / error-reporting seam.
 *
 * Both functions are deliberate no-ops today. A later change wires a provider
 * (e.g. PostHog) in HERE ONLY - call sites throughout the app already report
 * the events below, so nothing else needs to change. Keep payloads free of
 * user content (furniture names, project names): counts and enums only.
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
  | 'redo';

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

/** Record a product event. */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  void event;
  void props;
}

export interface ErrorContext {
  /** Where the error was caught, e.g. `error_boundary`, `share_link`. */
  source?: string;
  [key: string]: unknown;
}

/** Report an unexpected error. */
export function captureError(error: unknown, context?: ErrorContext): void {
  void error;
  void context;
}
