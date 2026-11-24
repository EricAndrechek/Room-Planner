import type { APIRoute, GetStaticPaths } from 'astro';
import { GUIDES } from '../../lib/guides';
import { guideOgPng } from '../../lib/guides/og';

/** Social cards for the guide pages, rendered at build time (see lib/guides/og.ts). */
export const getStaticPaths = (() =>
  GUIDES.map((g) => ({ params: { slug: g.slug } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) =>
  new Response(new Uint8Array(await guideOgPng(params.slug!)), {
    headers: { 'Content-Type': 'image/png' },
  });
