import type { APIRoute } from 'astro';

/** robots.txt pointing crawlers at the sitemap (absolute URL from `site` + base). */
export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');
  const sitemap = new URL(`${base}/sitemap-index.xml`, site ?? 'http://localhost').toString();
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
