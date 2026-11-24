/** A JSON object, as the migration steps see their input. */
export type Json = Record<string, unknown>;

export const isJson = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
