/**
 * The migration chain: one pure step per version, each from that version's JSON to the next's.
 * A step runs only on its own version, so running the chain twice changes nothing.
 */
import { migrateV2 } from './v2';
import { migrateV3, type V3Options } from './v3';
import type { Json } from './types';

export type MigrateOptions = V3Options;

/** `MIGRATIONS[v]` turns a version-`v` document into a version-`v + 1` one. */
export const MIGRATIONS: Record<number, (doc: Json, options: MigrateOptions) => Json> = {
  2: (doc) => migrateV2(doc),
  3: (doc, options) => migrateV3(doc, options),
};

/** Run the steps from version `from` up to `to`. */
export function migrate(doc: Json, from: number, to: number, options: MigrateOptions = {}): Json {
  let out = doc;
  for (let v = from; v < to; v++) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`No migration from version ${v}`);
    out = step(out, options);
  }
  return out;
}
