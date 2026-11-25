import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as z from 'zod/mini';
import { TOOL_ARGS } from './args';

/**
 * The tools' input schemas, generated from args.ts (and so from the plan's schema) into
 * schemas.json, which the lazy chunk imports: Zod's JSON Schema generator never reaches the
 * browser. Regenerate with `UPDATE_WEBMCP_SCHEMAS=1 pnpm test src/webmcp`.
 */
const FILE = fileURLToPath(new URL('./schemas.json', import.meta.url));

const build = () =>
  Object.fromEntries(
    Object.entries(TOOL_ARGS).map(([name, schema]) => {
      const { $schema: _, ...json } = z.toJSONSchema(schema, { io: 'input' }) as Record<
        string,
        unknown
      >;
      return [name, json];
    }),
  );

test('schemas.json matches the argument schemas (UPDATE_WEBMCP_SCHEMAS=1 regenerates it)', () => {
  const schemas = build();
  if (process.env.UPDATE_WEBMCP_SCHEMAS) {
    writeFileSync(FILE, `${JSON.stringify(schemas, null, 2)}\n`);
  }
  expect(JSON.parse(readFileSync(FILE, 'utf8'))).toEqual(schemas);
});

test('every input schema is an object schema that names its required fields', () => {
  for (const [name, schema] of Object.entries(build())) {
    expect(schema.type, name).toBe('object');
    expect(schema.additionalProperties, name).toBe(false);
  }
  const add = build().add_item as { required: string[]; properties: Record<string, unknown> };
  expect(add.required).toEqual(['label', 'width', 'depth']);
  const update = build().update_item as { required: string[]; properties: Record<string, object> };
  expect(update.required).toEqual(['id']);
  // No defaults in an update: a default would overwrite the piece's current value.
  expect(JSON.stringify(update)).not.toContain('"default"');
});
