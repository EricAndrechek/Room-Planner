// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { AstroPWAIntegration } from '@vite-pwa/astro';
import { pwaOptions } from './pwa-options.mjs';

/**
 * The public origin of the site. Every absolute URL (canonical, og:url,
 * sitemap, robots.txt) is derived from this one value, so moving to a new
 * domain is a matter of setting SITE_URL at build time.
 */
const SITE_URL = process.env.SITE_URL || 'https://room-planner.andrechek.com';

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
  },
});
