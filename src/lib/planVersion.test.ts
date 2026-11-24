/**
 * "Needs a newer Room Planner" on every read path this build has (docs/design/plan-format.md,
 * section 4): share links (`#s=`, `#j=`, `?config=`), the Share dialog's JSON box (the same
 * check, see ShareModal) and the plans file import. A newer plan is never loaded and nothing is
 * written. Damaged links are reported too.
 */
import { describe, expect, it } from 'vitest';
import originalStorage from '../core/__fixtures__/original-storage.json';
import { bytesToBase64Url } from '../core/share/codec';
import { buildShareUrl } from '../core/share/link';
import { boot } from './boot';
import { parseProjectsImport } from './projects';
import { APP_PLAN_VERSION, NewerPlanError, newerPlanVersion } from './planVersion';
import { createMemoryStorage, migrateStorage } from './storage';

const BASE = 'https://room-planner.andrechek.com/';
const v4 = { version: 4, unit: 'ft', rooms: [{ outline: [] }] };
const plainLink = (text: string) => `${BASE}#j=${bytesToBase64Url(new TextEncoder().encode(text))}`;

/** Saved data from the original app, already migrated (boot writes the schema marker). */
const stored = () => {
  const s = createMemoryStorage(originalStorage.localStorage as Record<string, string>);
  migrateStorage(s);
  return s;
};

describe('newerPlanVersion', () => {
  it('is null for every format this build reads, the version otherwise', () => {
    expect(APP_PLAN_VERSION).toBe(3);
    expect(newerPlanVersion({ roomDims: {}, items: [] })).toBeNull();
    expect(newerPlanVersion({ roomDims: {}, door: {}, items: [] })).toBeNull();
    expect(newerPlanVersion('nonsense')).toBeNull();
    expect(newerPlanVersion(v4)).toBe(4);
    expect(newerPlanVersion([4, 'x'])).toBe(4);
    expect(newerPlanVersion({ version: 9 })).toBe(9);
  });
});

describe('share links at boot', () => {
  for (const [name, url] of [
    ['#s= with a v4 plan', () => buildShareUrl(BASE, v4 as never)],
    ['#j= with a compact plan', () => buildShareUrl(BASE, [5, 'x'], { compress: false })],
    [
      '?config= with a v4 plan',
      async () => `${BASE}?config=${encodeURIComponent(btoa(JSON.stringify(v4)))}`,
    ],
  ] as const) {
    it(`${name}: not opened, nothing written, the URL left alone`, async () => {
      const s = stored();
      const before = s.dump();
      const href = await url();
      const result = await boot(href, s);
      expect(result.linkProblem).toEqual({ kind: 'newer', version: expect.any(Number) });
      expect(result.shared).toBeNull();
      expect(s.dump()).toEqual(before);
    });
  }

  for (const [name, href] of [
    ['bad base64 in #s=', `${BASE}#s=@@@@`],
    ['bad deflate data in #s=', `${BASE}#s=AAAA`],
    [
      'a link cut short',
      `${BASE}#j=${bytesToBase64Url(new TextEncoder().encode('{"roomDims":{"wid'))}`,
    ],
    ['JSON that is not a plan', plainLink('{"hello":"world"}')],
    ['an empty #s=', `${BASE}#s=`],
    ['an empty ?config= (what the original wrote for emoji names)', `${BASE}?config=`],
    ['garbage in ?config=', `${BASE}?config=garbage`],
  ] as const) {
    it(`${name}: damaged, nothing written`, async () => {
      const s = stored();
      const before = s.dump();
      const result = await boot(href, s);
      expect(result.linkProblem).toEqual({ kind: 'damaged' });
      expect(result.shared).toBeNull();
      expect(s.dump()).toEqual(before);
    });
  }

  it('an ordinary link still opens, with no problem', async () => {
    const result = await boot(
      `${BASE}?config=${encodeURIComponent(btoa(JSON.stringify({ roomDims: { width: 9, height: 9 }, items: [] })))}`,
      createMemoryStorage(),
    );
    expect(result.linkProblem).toBeUndefined();
    expect(result.shared?.createdProject).toBe(true);
    expect(result.state.layout.roomDims).toEqual({ width: 9, height: 9 });
  });

  it('no link: no problem', async () => {
    expect((await boot(BASE, createMemoryStorage())).linkProblem).toBeUndefined();
  });
});

describe('plans file import', () => {
  it('refuses a newer bare plan', () => {
    expect(() => parseProjectsImport(JSON.stringify(v4), 0)).toThrow(NewerPlanError);
  });

  it('refuses a whole plans file that holds one newer plan', () => {
    const file = {
      version: 1,
      exportedAt: '2026-11-24T00:00:00Z',
      projects: [
        { id: 'a', name: 'Old', data: { roomDims: { width: 9, height: 9 }, items: [] } },
        { id: 'b', name: 'New', data: v4 },
      ],
    };
    expect(() => parseProjectsImport(JSON.stringify(file), 0)).toThrow(
      'This plan was made with a newer version of Room Planner. Update the app to open it.',
    );
  });

  it('still imports a file of plans it can read', () => {
    const file = {
      version: 1,
      projects: [{ name: 'Old', data: { roomDims: { width: 9, height: 9 }, items: [] } }],
    };
    expect(parseProjectsImport(JSON.stringify(file), 0)).toHaveLength(1);
  });
});
