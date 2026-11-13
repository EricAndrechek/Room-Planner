// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { AstroPWAIntegration } from '@vite-pwa/astro';
import { pwaOptions } from './pwa-options.mjs';

/** Dev-only mirror of the Worker's /rpq reverse proxy (worker/proxy.ts), for opted-in analytics debugging. */
const posthogDevProxy = {
  '/rpq/static': {
    target: 'https://us-assets.i.posthog.com',
    changeOrigin: true,
    rewrite: (/** @type {string} */ p) => p.replace(/^\/rpq/, ''),
  },
  '/rpq/array': {
    target: 'https://us-assets.i.posthog.com',
    changeOrigin: true,
    rewrite: (/** @type {string} */ p) => p.replace(/^\/rpq/, ''),
  },
  '/rpq': {
    target: 'https://us.i.posthog.com',
    changeOrigin: true,
    rewrite: (/** @type {string} */ p) => p.replace(/^\/rpq/, ''),
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
    AstroPWAIntegration(pwaOptions),
  ],
  vite: {
    plugins: [tailwindcss()],
    // 'hidden': maps are emitted but not referenced; scripts/upload-sourcemaps.sh uploads them to PostHog (.assetsignore keeps them off the CDN).
    build: { sourcemap: 'hidden' },
    server: { proxy: posthogDevProxy },
  },
});
