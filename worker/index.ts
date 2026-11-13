import { mapIngestPath } from './proxy.ts';

const PH_BEARER = /^Bearer ph[csx]_/;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const target = mapIngestPath(new URL(request.url));
    // Everything that is not the PostHog proxy is a static asset.
    if (!target) return env.ASSETS.fetch(request);

    // Static SDK assets: GET only, cached at the edge for the lifetime PostHog sets.
    if (target.isAsset && request.method === 'GET') {
      const cache = caches.default;
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(target.url, {
        headers: { accept: request.headers.get('accept') ?? '*/*' },
      });
      if (res.ok) ctx.waitUntil(cache.put(request, res.clone()));
      return res;
    }

    // API (events, flags, replay): never cached, cookies stripped, real client IP forwarded.
    const headers = new Headers(request.headers);
    headers.delete('cookie');
    if (!PH_BEARER.test(headers.get('authorization') ?? '')) headers.delete('authorization');
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) headers.set('X-Forwarded-For', ip);

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    return fetch(
      new Request(target.url, {
        method: request.method,
        headers,
        // Buffer the body: forwarding the raw stream can drop POSTs (per PostHog docs).
        // Session-replay payloads are bounded by PostHog's own limits.
        body: hasBody ? await request.arrayBuffer() : null,
        redirect: 'manual',
      }),
    );
  },
} satisfies ExportedHandler<Env>;
