// Pure path-mapping for the PostHog reverse proxy (kept separate so it is unit-testable).

export const PROXY_PREFIX = '/rpq';
export const API_HOST = 'us.i.posthog.com';
export const ASSET_HOST = 'us-assets.i.posthog.com';

export interface ProxyTarget {
  /** Upstream URL to fetch. */
  url: string;
  /** True for static SDK assets (cacheable at the edge). */
  isAsset: boolean;
}

/** Map a request URL under /rpq to its PostHog upstream, or null if not a proxy path. */
export function mapProxyPath(input: URL): ProxyTarget | null {
  const { pathname, search } = input;
  if (pathname !== PROXY_PREFIX && !pathname.startsWith(PROXY_PREFIX + '/')) return null;
  const rest = pathname.slice(PROXY_PREFIX.length) || '/';
  const isAsset = rest.startsWith('/static/') || rest.startsWith('/array/');
  return { url: `https://${isAsset ? ASSET_HOST : API_HOST}${rest}${search}`, isAsset };
}
