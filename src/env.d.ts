/** The PostHog web snippet (src/components/PostHog.astro) installs `window.posthog`. */
interface Window {
  posthog?: {
    capture(event: string, props?: Record<string, unknown>): void;
    captureException(error: unknown, props?: Record<string, unknown>): void;
    opt_in_capturing(): void;
    opt_out_capturing(): void;
  };
}
