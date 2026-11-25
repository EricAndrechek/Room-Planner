import type { APIRoute } from 'astro';
import { openApiSpec } from '../lib/openapi';

/** /openapi.json: the REST API (worker/api.ts) as OpenAPI 3.1 (src/lib/openapi.ts). */
export const GET: APIRoute = ({ site }) =>
  new Response(
    `${JSON.stringify(openApiSpec((site ?? new URL('http://localhost')).toString()), null, 2)}\n`,
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
