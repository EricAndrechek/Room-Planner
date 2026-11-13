// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** package.json version, plus the short git sha when available (sent as the `app_version` property). */
const APP_VERSION = (() => {
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  try {
    const sha = (
      process.env.GITHUB_SHA ||
      execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    )
      .trim()
      .slice(0, 7);
    return sha ? `${version}+${sha}` : version;
  } catch {
    return version;
  }
})();

/** Dev-only mirror of the Worker's /ingest reverse proxy (worker/proxy.ts), for opted-in analytics debugging. */
const posthogDevProxy = {
  '/ingest/static': {
    target: 'https://us-assets.i.posthog.com',
    changeOrigin: true,
    rewrite: (/** @type {string} */ p) => p.replace(/^\/ingest/, ''),
  },
  '/ingest/array': {
    target: 'https://us-assets.i.posthog.com',
    changeOrigin: true,
    rewrite: (/** @type {string} */ p) => p.replace(/^\/ingest/, ''),
  },
  '/ingest': {
    target: 'https://us.i.posthog.com',
    changeOrigin: true,
    rewrite: (/** @type {string} */ p) => p.replace(/^\/ingest/, ''),
  },
};

/**
 * The public origin of the site. Every absolute URL (canonical, og:url,
 * sitemap, robots.txt) is derived from this one value, so moving to a new
 * domain is a matter of setting SITE_URL at build time.
 */
const SITE_URL = process.env.SITE_URL || 'https://roomplanner.andrechek.com';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'always',
  integrations: [
    react(),
    sitemap({
      filter: (page) => !/\/404\/?$/.test(page),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
    // 'hidden': maps are emitted but not referenced; CI uploads them to PostHog (.assetsignore keeps them off the CDN).
    build: { sourcemap: 'hidden' },
    server: { proxy: posthogDevProxy },
  },
});
