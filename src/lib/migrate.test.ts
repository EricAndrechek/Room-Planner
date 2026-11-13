import { describe, expect, it, vi } from 'vitest';
import earlyV3 from './__fixtures__/early-v3-storage.json';
import originalStorage from './__fixtures__/original-storage.json';
import v2Storage from './__fixtures__/v2-storage.json';
import { bootFromStorage } from './boot';
import {
  decodeMigrationHash,
  hasMigrationHash,
  importMigration,
  mergeIntoStorage,
  mergeProjects,
  parseMigrationPayload,
  type MigrationPayload,
} from './migrate';
import { bytesToBase64Url, deflate } from './share';
import { KEYS, createMemoryStorage } from './storage';

const analytics = vi.hoisted(() => ({
  track: vi.fn(),
  captureError: vi.fn(),
  resumeAnalyticsAfterMigration: vi.fn(),
}));
vi.mock('./analytics', () => analytics);

const keysOf = (f: { localStorage: Record<string, string> }) => ({ ...f.localStorage });

const payloadOf = (keys: Record<string, string>, over: Partial<MigrationPayload> = {}) => ({
  v: 1 as const,
  keys,
  path: '/',
  search: '',
  hash: '',
  ...over,
});

const encode = async (p: unknown, compress = true) => {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  return compress
    ? `#rp-migrate=${bytesToBase64Url(await deflate(bytes))}`
    : `#rp-migrate-j=${bytesToBase64Url(bytes)}`;
};

const loc = (hash: string, pathname = '/', search = '') => ({ hash, pathname, search });

const project = (id: string, name: string, updatedAt: string, extra: object = {}) => ({
  id,
  name,
  data: { roomDims: { width: 10, height: 10 }, doors: [], windows: [], items: [] },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt,
  ...extra,
});

describe('hasMigrationHash / decodeMigrationHash', () => {
  it('recognises both variants and nothing else', () => {
    expect(hasMigrationHash('#rp-migrate=abc')).toBe(true);
    expect(hasMigrationHash('#rp-migrate-j=abc')).toBe(true);
    expect(hasMigrationHash('#s=abc')).toBe(false);
    expect(hasMigrationHash('')).toBe(false);
  });

  it('round-trips the compressed and the plain variant', async () => {
    const p = payloadOf({ 'room-sim-v3-units': 'm' }, { path: '/help/' });
    expect(await decodeMigrationHash(await encode(p))).toEqual(p);
    expect(await decodeMigrationHash(await encode(p, false))).toEqual(p);
  });

  it('rejects garbage', async () => {
    await expect(decodeMigrationHash('#rp-migrate=!!!not-base64!!!')).rejects.toThrow();
    await expect(decodeMigrationHash('#rp-migrate=AAAA')).rejects.toThrow();
    await expect(
      decodeMigrationHash('#rp-migrate-j=' + bytesToBase64Url(new Uint8Array([1]))),
    ).rejects.toThrow();
    await expect(decodeMigrationHash('#nope')).rejects.toThrow();
  });
});

describe('parseMigrationPayload', () => {
  it('rejects wrong versions and shapes', () => {
    expect(parseMigrationPayload('nope')).toBeNull();
    expect(parseMigrationPayload('[]')).toBeNull();
    expect(parseMigrationPayload('{"v":2,"keys":{}}')).toBeNull();
    expect(parseMigrationPayload('{"v":1}')).toBeNull();
  });

  it('drops keys the app does not own and non-string values', () => {
    const p = parseMigrationPayload(
      JSON.stringify({
        v: 1,
        keys: { 'room-sim-v3-units': 'm', ph_phc_x: '1', evil: 'x', 'rp:analytics-optout': 1 },
      }),
    )!;
    expect(p.keys).toEqual({ 'room-sim-v3-units': 'm' });
  });

  it('only restores same-origin relative URLs', () => {
    const p = (path: unknown, search: unknown, hash: unknown) =>
      parseMigrationPayload(JSON.stringify({ v: 1, keys: {}, path, search, hash }))!;
    expect(p('//evil.com/x', '', '')).toMatchObject({ path: '/' });
    expect(p('https://evil.com', '', '')).toMatchObject({ path: '/' });
    expect(p('/\\evil.com', '', '')).toMatchObject({ path: '/' });
    expect(p('/help/', '?a=1', '#s=x')).toEqual({
      v: 1,
      keys: {},
      path: '/help/',
      search: '?a=1',
      hash: '#s=x',
    });
    expect(p(1, 'x', 'y')).toMatchObject({ path: '/', search: '', hash: '' });
  });
});

describe('mergeIntoStorage: empty target', () => {
  it('writes every carried key verbatim', () => {
    const s = createMemoryStorage();
    const keys = {
      ...keysOf(originalStorage),
      'room-planner-schema': '1',
      'rp:analytics-optout': '1',
    };
    const r = mergeIntoStorage(s, keys);
    expect(r).toEqual({ projects: 1, merged: false });
    expect(s.dump()).toEqual(keys);
  });

  it('treats settings-only storage (no layout or projects) as empty', () => {
    const s = createMemoryStorage({ 'rp:analytics-debug': '1', 'room-sim-v3-units': 'cm' });
    const r = mergeIntoStorage(s, keysOf(originalStorage));
    expect(r.merged).toBe(false);
    expect(s.dump()['room-sim-v3-units']).toBe('ft-in');
  });

  it('boots to the same state the old origin had', () => {
    const old = createMemoryStorage(keysOf(originalStorage));
    const fresh = createMemoryStorage();
    mergeIntoStorage(fresh, old.dump());
    expect(bootFromStorage(fresh)).toEqual(bootFromStorage(old));
  });

  it('carries v2 and early-v3 data, which the app migrates afterwards', () => {
    for (const f of [v2Storage, earlyV3]) {
      const s = createMemoryStorage();
      mergeIntoStorage(s, keysOf(f));
      expect(s.dump()).toEqual(f.localStorage);
    }
  });

  it('tolerates a corrupt projects value', () => {
    const s = createMemoryStorage();
    expect(mergeIntoStorage(s, { 'room-planner-projects': '{oops' })).toEqual({
      projects: 0,
      merged: false,
    });
    expect(s.dump()['room-planner-projects']).toBe('{oops');
  });
});

describe('mergeIntoStorage: existing data', () => {
  it('keeps the newer copy of a conflicting project, appends new ones', () => {
    const s = createMemoryStorage({
      [KEYS.projects]: JSON.stringify([
        project('a', 'A here (newer)', '2026-03-01T00:00:00.000Z'),
        project('b', 'B here (older)', '2026-01-01T00:00:00.000Z'),
        project('c', 'C only here', '2026-02-01T00:00:00.000Z'),
      ]),
      [KEYS.dims]: '{"width":1,"height":1}',
    });
    const incoming = [
      project('a', 'A there (older)', '2026-02-01T00:00:00.000Z'),
      project('b', 'B there (newer)', '2026-02-01T00:00:00.000Z'),
      project('d', 'D only there 🛏️ Café', '2026-02-01T00:00:00.000Z'),
    ];
    const r = mergeIntoStorage(s, {
      [KEYS.projects]: JSON.stringify(incoming),
      [KEYS.dims]: '{"width":99,"height":99}',
      [KEYS.units]: 'm',
    });
    expect(r).toEqual({ projects: 3, merged: true });
    const merged = JSON.parse(s.getItem(KEYS.projects)!);
    expect(merged.map((p: { id: string; name: string }) => [p.id, p.name])).toEqual([
      ['a', 'A here (newer)'],
      ['b', 'B there (newer)'],
      ['c', 'C only here'],
      ['d', 'D only there 🛏️ Café'],
    ]);
    // Layout keys: existing wins, absent ones are filled.
    expect(s.getItem(KEYS.dims)).toBe('{"width":1,"height":1}');
    expect(s.getItem(KEYS.units)).toBe('m');
  });

  it('keeps the existing project when timestamps tie or are unusable', () => {
    const a = project('a', 'here', '2026-01-01T00:00:00.000Z');
    expect(mergeProjects([a], [project('a', 'there', '2026-01-01T00:00:00.000Z')])).toEqual([a]);
    expect(mergeProjects([a], [project('a', 'there', 'garbage')])).toEqual([a]);
    const noStamp = { id: 'a', name: 'here' };
    expect(mergeProjects([noStamp], [project('a', 'there', '2030-01-01T00:00:00.000Z')])).toEqual([
      noStamp,
    ]);
  });

  it('skips incoming entries without an id and preserves unknown existing entries', () => {
    const weird = { name: 'no id' };
    const out = mergeProjects([weird], [{ name: 'no id either' }, project('x', 'X', '2026-01-01')]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(weird);
  });

  it('leaves a corrupt existing projects value replaced by the incoming list', () => {
    const s = createMemoryStorage({ [KEYS.projects]: '{oops', [KEYS.dims]: '{}' });
    mergeIntoStorage(s, { [KEYS.projects]: JSON.stringify([project('a', 'A', '2026-01-01')]) });
    expect(JSON.parse(s.getItem(KEYS.projects)!)).toHaveLength(1);
  });

  it('does not touch existing data when the payload carries no projects', () => {
    const existing = JSON.stringify([project('a', 'A', '2026-01-01')]);
    const s = createMemoryStorage({ [KEYS.projects]: existing });
    mergeIntoStorage(s, { [KEYS.units]: 'cm' });
    expect(s.getItem(KEYS.projects)).toBe(existing);
  });

  it('is idempotent', () => {
    const s = createMemoryStorage({
      [KEYS.projects]: JSON.stringify([project('z', 'Z', '2026-05-01')]),
    });
    const keys = keysOf(originalStorage);
    mergeIntoStorage(s, keys);
    const once = s.dump();
    mergeIntoStorage(s, keys);
    expect(s.dump()).toEqual(once);
  });
});

describe('importMigration', () => {
  const run = async (
    hash: string,
    storage = createMemoryStorage(),
    pathname = '/',
    search = '',
  ) => {
    const urls: string[] = [];
    const result = await importMigration(loc(hash, pathname, search), storage, (u) => urls.push(u));
    return { result, urls, storage };
  };

  it('does nothing without a migration fragment', async () => {
    const { result, urls } = await run('#s=abc');
    expect(result).toBeNull();
    expect(urls).toEqual([]);
  });

  it('imports, restores the original URL (share hash and ?config) and tracks', async () => {
    analytics.track.mockClear();
    const hash = await encode(
      payloadOf(keysOf(originalStorage), { path: '/', search: '?config=eyJh', hash: '#s=XYZ_-9' }),
    );
    const { result, urls, storage } = await run(hash);
    expect(result).toEqual({ projects: 1, merged: false });
    expect(urls).toEqual(['/?config=eyJh#s=XYZ_-9']);
    expect(storage.dump()).toEqual(originalStorage.localStorage);
    expect(analytics.track).toHaveBeenCalledWith('domain_migration_imported', {
      projects: 1,
      merged: false,
    });
    expect(analytics.resumeAnalyticsAfterMigration).toHaveBeenCalled();
  });

  it('restores a plain URL without a hash', async () => {
    const { urls } = await run(await encode(payloadOf({}, { path: '/help/' }), false));
    expect(urls).toEqual(['/help/']);
  });

  it('survives unicode project names through the whole encode/import path', async () => {
    const name = 'Zimmer ä ö 寝室 🛏️ — Café';
    const s = createMemoryStorage();
    const keys = { [KEYS.projects]: JSON.stringify([project('u', name, '2026-01-01')]) };
    await run(await encode(payloadOf(keys)), s);
    expect(JSON.parse(s.getItem(KEYS.projects)!)[0].name).toBe(name);
    const t = createMemoryStorage();
    await run(await encode(payloadOf(keys), false), t);
    expect(JSON.parse(t.getItem(KEYS.projects)!)[0].name).toBe(name);
  });

  it('reports merged: true against existing data', async () => {
    const s = createMemoryStorage({ [KEYS.projects]: '[]', [KEYS.dims]: '{}' });
    const { result } = await run(await encode(payloadOf(keysOf(originalStorage))), s);
    expect(result).toEqual({ projects: 1, merged: true });
  });

  it('ignores a corrupt payload: no throw, no writes, fragment dropped, error captured', async () => {
    analytics.captureError.mockClear();
    analytics.track.mockClear();
    const s = createMemoryStorage({ a: 'b' });
    const { result, urls } = await run('#rp-migrate=@@@@', s, '/help/', '?x=1');
    expect(result).toBeNull();
    expect(urls).toEqual(['/help/?x=1']);
    expect(s.dump()).toEqual({ a: 'b' });
    expect(analytics.captureError).toHaveBeenCalledTimes(1);
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it('ignores a valid-looking payload of the wrong version', async () => {
    const { result, urls } = await run(await encode({ v: 9, keys: {} }));
    expect(result).toBeNull();
    expect(urls).toEqual(['/']);
  });

  it('never throws when storage writes fail, and still restores the URL', async () => {
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    const urls: string[] = [];
    const r = await importMigration(
      loc(await encode(payloadOf(keysOf(originalStorage), { path: '/help/' }))),
      broken,
      (u) => urls.push(u),
    );
    expect(r).toBeNull();
    expect(urls).toEqual(['/help/']);
  });
});
