/**
 * Version 2 -> 3. Version 2 is the first release (commit 650f35d): one `door`, opening `in` or
 * `out`, instead of the `doors` list. Exactly what the importer has always done: the door becomes
 * door 1, `open: 'in'` a swing-in door and anything else a swing-out door; every other field stays.
 *
 * Version 2 had no windows. A v2 link has no `windows` key, which version 3 reads as "the starter
 * window" (as links always have); the v2 storage keys are read with `windows: []` by the caller
 * (as storage always has).
 */
import type { Json } from './types';

export function migrateV2(doc: Json): Json {
  const { door, ...rest } = doc;
  if (typeof door !== 'object' || door === null || Array.isArray(door)) return rest;
  const d = door as Json;
  return { ...rest, doors: [{ ...d, id: 1, type: d.open === 'in' ? 'swing-in' : 'swing-out' }] };
}
