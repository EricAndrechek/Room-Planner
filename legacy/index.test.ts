import { describe, expect, it } from 'vitest';
import worker, { KILL_SWITCH_SW, buildBridge, type Env } from './index';

const env: Env = { TARGET_ORIGIN: 'https://room-planner.andrechek.com' };
const BROWSER = {
  'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  'sec-fetch-dest': 'document',
  accept: 'text/html,application/xhtml+xml',
};
const get = (path: string, headers: Record<string, string> = BROWSER, method = 'GET') =>
  worker.fetch(new Request(`https://roomplanner.andrechek.com${path}`, { method, headers }), env);

describe('crawlers and non-navigations get a 301', () => {
  for (const ua of [
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Mozilla/5.0 (compatible; YandexBot/3.0)',
    'DuckDuckBot/1.1',
    'Slackbot-LinkExpanding 1.0',
    'Twitterbot/1.0',
    'facebookexternalhit/1.1',
    'SomeCrawler/2.0',
    'MySpider',
    'LinkPreview/1.0',
  ]) {
    it(ua, async () => {
      const res = await get('/help/?a=1', { ...BROWSER, 'user-agent': ua });
      expect(res.status).toBe(301);
      expect(res.headers.get('location')).toBe('https://room-planner.andrechek.com/help/?a=1');
    });
  }

  it('a request without navigation headers', async () => {
    const res = await get('/', { 'user-agent': 'Mozilla/5.0', accept: '*/*' });
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://room-planner.andrechek.com/');
  });

  it('a fetch() / non-document destination from a browser', async () => {
    expect((await get('/', { ...BROWSER, 'sec-fetch-dest': 'empty' })).status).toBe(301);
    expect((await get('/', { ...BROWSER, 'sec-fetch-dest': 'iframe' })).status).toBe(301);
  });

  it('old clients that send only Accept: text/html are still treated as navigations', async () => {
    const res = await get('/', { 'user-agent': 'Mozilla/5.0', accept: 'text/html' });
    expect(res.status).toBe(200);
  });

  it('static asset paths, even for browsers', async () => {
    for (const path of [
      '/_astro/index.abc123.js',
      '/manifest.webmanifest',
      '/favicon.svg',
      '/apple-touch-icon.png',
      '/pwa-192x192.png',
      '/og-image.png',
      '/robots.txt',
      '/sitemap-index.xml',
      '/workbox-1234.js',
      '/screenshots/a.png',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(301);
      expect(res.headers.get('location'), path).toBe(`https://room-planner.andrechek.com${path}`);
    }
  });

  it('non-GET methods redirect with 308', async () => {
    expect((await get('/', BROWSER, 'POST')).status).toBe(308);
  });
});

describe('kill-switch service worker', () => {
  it('serves /sw.js uncached, as JavaScript, even for a bot UA', async () => {
    for (const headers of [BROWSER, { 'user-agent': 'Googlebot' }]) {
      const res = await get('/sw.js', headers);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-type')).toMatch(/javascript/);
      expect(await res.text()).toBe(KILL_SWITCH_SW);
    }
  });

  it('skips waiting, clears caches, unregisters and navigates clients', () => {
    expect(KILL_SWITCH_SW).toContain('skipWaiting()');
    expect(KILL_SWITCH_SW).toContain('caches.delete');
    expect(KILL_SWITCH_SW).toContain('registration.unregister()');
    expect(KILL_SWITCH_SW).toContain("matchAll({ type: 'window'");
    expect(KILL_SWITCH_SW).toContain('client.navigate(client.url)');
    // It must be valid JS.
    expect(() => new Function(KILL_SWITCH_SW.replace(/self\./g, 'noop.'))).not.toThrow();
  });
});

describe('bridge page', () => {
  it('serves HTML with no-store, noindex, canonical and a noscript fallback', async () => {
    const res = await get('/help/?x=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const html = await res.text();
    const dest = 'https://room-planner.andrechek.com/help/?x=1'.replace(/&/g, '&amp;');
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(`<link rel="canonical" href="${dest}">`);
    expect(html).toContain(
      `<noscript><meta http-equiv="refresh" content="0;url=${dest}"></noscript>`,
    );
    expect(html).toContain('room-planner.andrechek.com');
  });

  it('escapes the request path in attributes', async () => {
    const res = await get('/help/?q="><script>alert(1)</script>');
    const html = await res.text();
    expect(html).not.toContain('<script>alert(1)');
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it('CSP allows only the inline script and style by hash, nothing else', async () => {
    const res = await get('/');
    const csp = res.headers.get('content-security-policy')!;
    const html = await res.text();
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
    const hash = async (t: string) =>
      Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))).toString(
        'base64',
      );
    expect(csp).toContain(`script-src 'sha256-${await hash(script)}'`);
    expect(csp).toContain(`style-src 'sha256-${await hash(style)}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('unsafe');
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it('the inline script is syntactically valid and embeds the target origin', async () => {
    const { script } = await buildBridge(new Request('https://roomplanner.andrechek.com/'), env);
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('"https://room-planner.andrechek.com"');
    expect(script).not.toContain('__TARGET__');
  });

  it('cannot be broken out of via TARGET_ORIGIN', async () => {
    const { script } = await buildBridge(new Request('https://x.test/'), {
      TARGET_ORIGIN: 'https://a.test/</script><script>1',
    });
    expect(script).not.toContain('</script>');
  });

  it('HEAD has no body', async () => {
    const res = await get('/', BROWSER, 'HEAD');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});
