/**
 * PWA configuration (@vite-pwa/astro v2 -> @unplugin-pwa/vite -> Workbox generateSW).
 * Kept out of astro.config.mjs so the service-worker and manifest policy reads in one place.
 */

const THEME = '#4f46e5';
const BACKGROUND = '#f8fafc';

/** @type {NonNullable<Parameters<typeof import('@vite-pwa/astro').AstroPWAIntegration>[0]>} */
export const pwaOptions = {
  // The user decides when to swap in a new build (a toast offers "Reload").
  registerType: 'prompt',
  // The island registers the SW itself (src/hooks/usePwa.ts), so no registerSW.js is emitted.
  injectRegister: false,
  // The <link rel="manifest"> is written by hand in layouts/Base.astro.
  includeManifestIcons: false,
  manifest: {
    id: '/',
    name: 'Room Planner',
    short_name: 'Room Planner',
    description:
      'Plan your room layout: set dimensions, add doors, windows and furniture, then drag, rotate and share. Works offline; your data stays on your device.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: THEME,
    background_color: BACKGROUND,
    lang: 'en',
    categories: ['productivity', 'design', 'lifestyle'],
    icons: [
      { src: '/pwa-64x64.png', sizes: '64x64', type: 'image/png', purpose: 'any' },
      { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/maskable-icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    screenshots: [
      {
        src: '/screenshots/wide.webp',
        sizes: '1280x800',
        type: 'image/webp',
        form_factor: 'wide',
        label: 'Arrange furniture to scale on a floor plan',
      },
      {
        src: '/screenshots/narrow.webp',
        sizes: '780x1688',
        type: 'image/webp',
        form_factor: 'narrow',
        label: 'The planner on a phone',
      },
    ],
  },
  generateSW: {
    // The whole app shell: pages, hashed JS/CSS, fonts, icons. Excluded: social card,
    // store screenshots and source maps (only fetched by crawlers / the installer / devtools).
    globPatterns: ['**/*.{html,js,css,svg,png,ico,woff2}'],
    globIgnores: [
      // Cloudflare redirects /404/ -> /404 and serves it with status 404, which fails precaching.
      '404.html',
      'og-image.png',
      'screenshots/**',
      '**/*.map',
      'sitemap*.xml',
      'robots.txt',
    ],
    // `/` is precached. Navigations to `/` (with any query, e.g. legacy ?config= links) are answered
    // from it; /help/ and 404 are precached pages of their own; unknown paths go to the network (404).
    navigateFallback: '/',
    // Only `/` may fall back to the app shell (so unknown URLs still get the real 404 online);
    // the denylist is belt and braces for /help/.
    navigateFallbackAllowlist: [/^\/(\?.*)?$/],
    navigateFallbackDenylist: [/^\/help\//],
    // `/?config=...` (legacy share links) and tracking params must hit the precached `/`.
    ignoreURLParametersMatching: [/.*/],
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    // skipWaiting is deliberately off: with registerType 'prompt' the update toast posts
    // SKIP_WAITING (updateSW(true)) so the swap happens when the user clicks Reload.
    skipWaiting: false,
    // No runtimeCaching at all: cross-origin PostHog requests are never intercepted or cached.
    runtimeCaching: [],
  },
  devOptions: { enabled: false },
};
