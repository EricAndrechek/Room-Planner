/**
 * Legacy-domain Worker logic (roomplanner.andrechek.com -> room-planner.andrechek.com).
 *
 * localStorage is per-origin, so a plain redirect would strand every visitor's saved projects. Instead:
 *
 *  - Browser page navigations get a small "bridge" page. Its inline script reads this origin's
 *    storage, packs the app's keys into `#rp-migrate=<base64url(deflate-raw(JSON))>` and redirects to
 *    the new origin, whose boot code (src/lib/migrate.ts) imports them and restores the URL the visitor
 *    originally asked for. Payload: { v: 1, keys: {key: value}, path, search, hash }.
 *  - Crawlers, assets and anything that is not a document navigation get a plain 301.
 *  - GET /sw.js is a kill-switch service worker: visitors who installed the old PWA keep a service
 *    worker that serves the old cached app forever. The browser re-fetches /sw.js on navigation, so
 *    this replaces it, wipes its caches, unregisters itself and reloads open tabs into the bridge.
 */

export interface Env {
  TARGET_ORIGIN: string;
}

/** Roughly the largest URL that browsers reliably accept. Above it we offer a file backup instead. */
const MAX_URL_LENGTH = 1_500_000;

const BOT_UA =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|curl|wget|python-requests|go-http-client|lighthouse|pingdom|uptime|monitor|google|bing|yandex|baidu|duckduck|ia_archiver|petalbot|semrush|ahrefs/i;

const STATIC_PATH =
  /^\/(_astro\/|screenshots\/|workbox-|manifest\.webmanifest|robots\.txt|sitemap|favicon|apple-touch-icon|pwa-|maskable-|og-image)|\.[a-z0-9]{2,5}$/i;

export const isBotRequest = (req: Request): boolean =>
  BOT_UA.test(req.headers.get('user-agent') ?? '');

/** A browser asking for an HTML page (as opposed to fetch(), assets, feed readers, scripts...). */
export const isDocumentNavigation = (req: Request): boolean => {
  const dest = req.headers.get('sec-fetch-dest');
  if (dest) return dest === 'document';
  return (req.headers.get('accept') ?? '').includes('text/html');
};

export const redirectTo = (req: Request, env: Env): Response => {
  const url = new URL(req.url);
  const safe = req.method === 'GET' || req.method === 'HEAD';
  return new Response(null, {
    status: safe ? 301 : 308,
    headers: {
      Location: env.TARGET_ORIGIN + url.pathname + url.search,
      'Cache-Control': 'public, max-age=3600',
    },
  });
};

export const KILL_SWITCH_SW = `// Kill switch: retires the legacy PWA service worker (see legacy/lib.ts).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        for (const key of await caches.keys()) await caches.delete(key);
      } catch (e) {}
      try {
        await self.registration.unregister();
      } catch (e) {}
      try {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          try {
            client.navigate(client.url);
          } catch (e) {}
        }
      } catch (e) {}
    })(),
  );
});
`;

const killSwitch = (req: Request): Response =>
  new Response(req.method === 'HEAD' ? null : KILL_SWITCH_SW, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });

const BRIDGE_STYLE =
  'body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;' +
  'background:#f8fafc;color:#0f172a}main{max-width:28rem;padding:1.5rem;text-align:center}' +
  'a,button{color:#fff;background:#4f46e5;border:0;border-radius:.5rem;padding:.6rem 1rem;font:inherit;' +
  'text-decoration:none;cursor:pointer;display:inline-block;margin:.25rem}' +
  '@media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}}';

/**
 * The inline script. `__TARGET__` is replaced with the JSON-encoded target origin. It must stay
 * dependency-free and small; the CSP allows it by hash only.
 */
const BRIDGE_SCRIPT = `(function () {
  var T = __TARGET__;
  var L = location;
  var dest = T + L.pathname + L.search;
  var hash = L.hash;
  var KEY = /^(room-planner-|room-sim-v\\d+-|rp:)/;
  var MAX = ${MAX_URL_LENGTH};

  function done(promise) {
    return promise.then(function () {}, function () {});
  }
  // Retire the old PWA (best effort, never blocks for more than a second).
  function cleanup() {
    var jobs = [];
    try {
      if (navigator.serviceWorker) {
        jobs.push(done(navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        })));
      }
      if (window.caches) {
        jobs.push(done(caches.keys().then(function (ks) {
          return Promise.all(ks.map(function (k) { return caches.delete(k); }));
        })));
      }
    } catch (e) {}
    return Promise.race([Promise.all(jobs), new Promise(function (r) { setTimeout(r, 1000); })]);
  }
  function collect() {
    var keys = {}, n = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && KEY.test(k)) { keys[k] = localStorage.getItem(k); n++; }
      }
    } catch (e) { return null; }
    return n ? keys : null;
  }
  function b64u(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }
  async function pack(keys) {
    var bytes = new TextEncoder().encode(JSON.stringify({ v: 1, keys: keys, path: L.pathname, search: L.search, hash: hash }));
    if (typeof CompressionStream === 'undefined') return '#rp-migrate-j=' + b64u(bytes);
    var out = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return '#rp-migrate=' + b64u(new Uint8Array(await new Response(out).arrayBuffer()));
  }
  function tooBig(keys) {
    var main = document.querySelector('main');
    main.textContent = '';
    var p = document.createElement('p');
    p.textContent = 'Your saved floor plans are too large to move automatically. Download a backup, then continue to the new site and use Import to load it.';
    var b = document.createElement('button');
    b.textContent = 'Download a backup';
    b.onclick = function () {
      var projects = [];
      try { projects = JSON.parse(keys['room-planner-projects'] || '[]'); } catch (e) {}
      var file = { version: 1, exportedAt: new Date().toISOString(), projects: projects };
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
      a.download = 'room_planner_backup.json';
      a.click();
    };
    var c = document.createElement('a');
    c.href = dest + hash;
    c.textContent = 'Continue';
    main.append(p, b, c);
  }

  cleanup().then(async function () {
    var keys = collect();
    if (!keys) return L.replace(dest + hash);
    try {
      var frag = await pack(keys);
      if (dest.length + frag.length > MAX) return tooBig(keys);
      L.replace(dest + frag);
    } catch (e) {
      L.replace(dest + hash);
    }
  });
})();`;

const sha256Base64 = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  let bin = '';
  for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
  return btoa(bin);
};

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface Bridge {
  html: string;
  csp: string;
  script: string;
}

export const buildBridge = async (req: Request, env: Env): Promise<Bridge> => {
  const url = new URL(req.url);
  // `<` is escaped so the JSON can never close the script element.
  const target = JSON.stringify(env.TARGET_ORIGIN).replace(/</g, '\\u003c');
  const script = BRIDGE_SCRIPT.replace('__TARGET__', () => target);
  const [scriptHash, styleHash] = await Promise.all([
    sha256Base64(script),
    sha256Base64(BRIDGE_STYLE),
  ]);
  const csp = [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    `style-src 'sha256-${styleHash}'`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  const dest = escapeHtml(env.TARGET_ORIGIN + url.pathname + url.search);
  const host = escapeHtml(new URL(env.TARGET_ORIGIN).host);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Room Planner has moved</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${dest}">
<noscript><meta http-equiv="refresh" content="0;url=${dest}"></noscript>
<style>${BRIDGE_STYLE}</style>
</head>
<body>
<main><p>Moving to <a href="${dest}">${host}</a>&hellip;</p></main>
<script>${script}</script>
</body>
</html>
`;
  return { html, csp, script };
};

const bridge = async (req: Request, env: Env): Promise<Response> => {
  const { html, csp } = await buildBridge(req, env);
  return new Response(req.method === 'HEAD' ? null : html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': csp,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex',
    },
  });
};

/** The Worker's request handler (index.ts only re-exports it: workerd rejects other module exports). */
export const handle = async (req: Request, env: Env): Promise<Response> => {
  const { pathname } = new URL(req.url);
  if (pathname === '/sw.js' && (req.method === 'GET' || req.method === 'HEAD')) {
    return killSwitch(req);
  }
  const page =
    (req.method === 'GET' || req.method === 'HEAD') &&
    !STATIC_PATH.test(pathname) &&
    !isBotRequest(req) &&
    isDocumentNavigation(req);
  return page ? bridge(req, env) : redirectTo(req, env);
};
