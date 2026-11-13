/**
 * Import of data carried over from the legacy origin (roomplanner.andrechek.com).
 *
 * localStorage is per-origin, so a plain redirect would strand every visitor's
 * projects. The legacy Worker (legacy/lib.ts) serves a bridge page that reads
 * the old origin's storage and redirects here with the data in the URL
 * fragment (never sent to a server):
 *
 *   #rp-migrate=<base64url(deflate-raw(utf8(JSON)))>
 *   #rp-migrate-j=<base64url(utf8(JSON))>            (no CompressionStream)
 *
 * JSON payload: { v: 1, keys: { [localStorageKey]: string }, path, search, hash }
 * where path/search/hash are the URL the visitor originally asked for, so
 * share links (`#s=`) and legacy `?config=` links keep working.
 *
 * Runs before any storage is read at boot. Never throws.
 */
import { captureError, resumeAnalyticsAfterMigration, track } from './analytics';
import { base64UrlToBytes, inflate } from './share';
import { KEYS, PROJECTS_STORAGE_KEY, type StorageLike } from './storage';

export const MIGRATE_HASH_KEY = 'rp-migrate';
export const MIGRATE_HASH_KEY_PLAIN = 'rp-migrate-j';
export const MIGRATE_VERSION = 1;
/** Hard cap on the decoded JSON, so a hostile link cannot inflate to gigabytes. */
const MAX_DECODED_BYTES = 32 * 1024 * 1024;

/** Only keys this app owns are ever imported. */
const ALLOWED_KEY = /^(room-planner-|room-sim-v[0-9]+-|rp:)/;

/** Keys that mean "this origin already has real planner data". */
const DATA_KEYS: string[] = [KEYS.projects, KEYS.dims, KEYS.doors, KEYS.windows, KEYS.items];

export interface MigrationPayload {
  v: 1;
  keys: Record<string, string>;
  /** The URL the visitor originally requested on the legacy origin. */
  path: string;
  search: string;
  hash: string;
}

export interface MigrationResult {
  /** Number of projects that came with the payload. */
  projects: number;
  /** The target origin already had data, so the payload was merged rather than copied. */
  merged: boolean;
}

export const hasMigrationHash = (hash: string): boolean =>
  hash.startsWith(`#${MIGRATE_HASH_KEY}=`) || hash.startsWith(`#${MIGRATE_HASH_KEY_PLAIN}=`);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate untrusted JSON into a payload; null if it is not one. */
export const parseMigrationPayload = (json: string): MigrationPayload | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.v !== MIGRATE_VERSION || !isRecord(raw.keys)) return null;
  const keys: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.keys)) {
    if (typeof v === 'string' && ALLOWED_KEY.test(k)) keys[k] = v;
  }
  // The restored URL is relative to this origin: refuse protocol-relative paths ("//evil").
  const path = typeof raw.path === 'string' && /^\/(?!\/|\\)/.test(raw.path) ? raw.path : '/';
  const search = typeof raw.search === 'string' && /^\?/.test(raw.search) ? raw.search : '';
  const hash = typeof raw.hash === 'string' && /^#/.test(raw.hash) ? raw.hash : '';
  return { v: 1, keys, path, search, hash };
};

/** Decode the fragment. Throws on corrupt input (callers catch). */
export const decodeMigrationHash = async (hash: string): Promise<MigrationPayload> => {
  let bytes: Uint8Array;
  if (hash.startsWith(`#${MIGRATE_HASH_KEY}=`)) {
    bytes = await inflate(base64UrlToBytes(hash.slice(MIGRATE_HASH_KEY.length + 2)));
  } else if (hash.startsWith(`#${MIGRATE_HASH_KEY_PLAIN}=`)) {
    bytes = base64UrlToBytes(hash.slice(MIGRATE_HASH_KEY_PLAIN.length + 2));
  } else {
    throw new Error('not a migration fragment');
  }
  if (bytes.length > MAX_DECODED_BYTES) throw new Error('migration payload too large');
  const payload = parseMigrationPayload(new TextDecoder().decode(bytes));
  if (!payload) throw new Error('invalid migration payload');
  return payload;
};

const get = (s: StorageLike, key: string): string | null => {
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
};

const parseProjects = (raw: string | null | undefined): Record<string, unknown>[] => {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
};

const idOf = (p: Record<string, unknown>): string | null =>
  typeof p.id === 'string' ? p.id : null;

const stamp = (p: Record<string, unknown>): number => {
  const t = Date.parse(String(p.updatedAt ?? p.modifiedAt ?? ''));
  return Number.isFinite(t) ? t : NaN;
};

/**
 * Merge two project lists by id. Existing projects keep their order; for a shared id the copy with
 * the newer `updatedAt` wins (the existing one when equal or when either has no usable timestamp).
 * Incoming projects with new ids are appended.
 */
export const mergeProjects = (
  existing: Record<string, unknown>[],
  incoming: Record<string, unknown>[],
): Record<string, unknown>[] => {
  const out = [...existing];
  const index = new Map<string, number>();
  out.forEach((p, i) => {
    const id = idOf(p);
    if (id !== null && !index.has(id)) index.set(id, i);
  });
  for (const p of incoming) {
    const id = idOf(p);
    if (id === null) continue;
    const at = index.get(id);
    if (at === undefined) {
      index.set(id, out.length);
      out.push(p);
    } else if (stamp(p) > stamp(out[at])) {
      out[at] = p;
    }
  }
  return out;
};

/** Write the payload's keys into `storage` following the merge rules. */
export const mergeIntoStorage = (
  storage: StorageLike,
  keys: Record<string, string>,
): MigrationResult => {
  const incomingProjects = parseProjects(keys[PROJECTS_STORAGE_KEY]);
  const hasData = DATA_KEYS.some((k) => get(storage, k) !== null);

  if (!hasData) {
    for (const [k, v] of Object.entries(keys)) storage.setItem(k, v);
    return { projects: incomingProjects.length, merged: false };
  }

  for (const [k, v] of Object.entries(keys)) {
    if (k === PROJECTS_STORAGE_KEY) {
      const merged = mergeProjects(parseProjects(get(storage, k)), incomingProjects);
      if (incomingProjects.length) storage.setItem(k, JSON.stringify(merged));
    } else if (get(storage, k) === null) {
      storage.setItem(k, v);
    }
  }
  return { projects: incomingProjects.length, merged: true };
};

export interface LocationLike {
  hash: string;
}

/**
 * If the URL carries a migration fragment, import it and restore the original URL via
 * `replaceUrl(path + search + hash)`. Resolves to the result, or null when there was nothing to do
 * or the payload was unusable (the fragment is then dropped). Never rejects.
 */
export const importMigration = async (
  location: LocationLike & { pathname: string; search: string },
  storage: StorageLike,
  replaceUrl: (url: string) => void,
): Promise<MigrationResult | null> => {
  if (!hasMigrationHash(location.hash)) return null;
  let restored = false;
  try {
    const payload = await decodeMigrationHash(location.hash);
    // URL first: even if storage is full, the visitor still lands on what they asked for.
    replaceUrl(payload.path + payload.search + payload.hash);
    restored = true;
    const result = mergeIntoStorage(storage, payload.keys);
    track('domain_migration_imported', { projects: result.projects, merged: result.merged });
    resumeAnalyticsAfterMigration();
    return result;
  } catch (err) {
    captureError(err, { source: 'domain_migration' });
    if (!restored) replaceUrl(location.pathname + location.search);
    resumeAnalyticsAfterMigration();
    return null;
  }
};
