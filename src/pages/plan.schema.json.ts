import type { APIRoute } from 'astro';
import { publishedPlanSchema } from '../lib/planSchema';

/** /plan.schema.json: the plan format as JSON Schema (src/lib/planSchema.ts). */
export const GET: APIRoute = ({ site }) =>
  new Response(
    `${JSON.stringify(publishedPlanSchema((site ?? new URL('http://localhost')).toString()), null, 2)}\n`,
    {
      headers: { 'Content-Type': 'application/schema+json; charset=utf-8' },
    },
  );
