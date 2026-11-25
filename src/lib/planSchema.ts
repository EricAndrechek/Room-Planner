/**
 * The plan's JSON Schema as published at /plan.schema.json (src/pages/plan.schema.json.ts), for
 * assistants that write a plan with code and compress it into a `#s=` link themselves. Generated
 * from the Zod schema (src/core/schema.ts), the same as the MCP tools' input schema: fields with
 * defaults are optional. Build time only; never in the app bundle.
 */
import * as z from 'zod/mini';
import { Plan } from '../core/schema';

export const PLAN_SCHEMA_PATH = 'plan.schema.json';

export function publishedPlanSchema(site: string): Record<string, unknown> {
  const schema = z.toJSONSchema(Plan, { io: 'input' }) as Record<string, unknown>;
  return {
    $schema: schema.$schema,
    $id: new URL(PLAN_SCHEMA_PATH, site).toString(),
    title: 'Room Planner plan (version 4)',
    description:
      'A Room Planner floor plan. Every length is in `unit`; x grows right and y grows down. ' +
      'Compress it into a link with raw deflate and base64url: https://room-planner.andrechek.com/#s=<data>. ' +
      'See https://room-planner.andrechek.com/llms.txt.',
    ...Object.fromEntries(Object.entries(schema).filter(([k]) => k !== '$schema')),
  };
}
