/**
 * Which version of the plan format a document is, told from its shape alone (docs/design/
 * plan-format.md, section 4). Deliberately free of the schema, so a caller can ask "is this too
 * new for me?" without loading Zod.
 *
 * | Version | Recognised by                                   |
 * | ------- | ----------------------------------------------- |
 * | 2       | an object with `roomDims` and `door`, no `doors` |
 * | 3       | an object with `roomDims` and no `version`      |
 * | 4+      | an object with `version`, or an array (the compact share form) starting with it |
 */

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asVersion = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;

/** The document's format version, or null when it is not a plan in any known format. */
export function detectVersion(input: unknown): number | null {
  if (Array.isArray(input)) return asVersion(input[0]);
  if (!isObject(input)) return null;
  if ('version' in input) return asVersion(input.version);
  if (!isObject(input.roomDims)) return null;
  return isObject(input.door) && !('doors' in input) ? 2 : 3;
}
