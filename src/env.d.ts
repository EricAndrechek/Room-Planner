interface ImportMetaEnv {
  /** PostHog project token (public). Unset = analytics disabled. */
  readonly PUBLIC_POSTHOG_KEY?: string;
  /** PostHog API host; defaults to the same-origin `/ingest` proxy. */
  readonly PUBLIC_POSTHOG_HOST?: string;
  /** `production` (default) | `preview`. */
  readonly PUBLIC_DEPLOY_ENV?: string;
}

/** Injected at build time (astro.config.mjs `vite.define`). */
declare const __APP_VERSION__: string;
