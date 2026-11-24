/**
 * "Needs a newer Room Planner" on every read path this build has (docs/design/plan-format.md,
 * section 4): share links (`#s=`, `#j=`, `?config=`), the Share dialog's JSON box (the same
 * check, see ShareModal and `readSharedPlan`) and the plans file import. A newer plan is never
 * loaded and nothing is written. Damaged links are reported too. Saved and working plans in
 * storage are in storage.test.ts.
 */
import { describe, expect, it } from 'vitest';
import originalStorage from '../core/__fixtures__/original-storage.json';
import { PLAN_VERSION } from '../core/schema';
import { bytesToBase64Url } from '../core/share/codec';
import { buildShareUrl } from '../core/share/link';
import { buildPlanUrl } from '../core/share/plan';
import { boot, readSharedPlan } from './boot';
import { parseProjectsImport } from './projects';
import { APP_PLAN_VERSION, NewerPlanError, newerPlanVersion } from './planVersion';
import { starterPlan, withDoc } from './plans';
import { createMemoryStorage, createPlanStore } from './storage';

const BASE = 'https://room-planner.andrechek.com/';
const v5 = { version: 5, unit: 'ft', rooms: [{ outline: [] }] };
const plainLink = (text: string) => `${BASE}#j=${bytesToBase64Url(new TextEncoder().encode(text))}`;

/** Saved data from the original app, already moved to the new keys by a first boot. */
const stored = () => {
  const s = createMemoryStorage(originalStorage.localStorage as Record<string, string>);
  createPlanStore(s).load();
  return s;
};

describe('newerPlanVersion', () => {
  it('is null for every format this build reads, the version otherwise', () => {
    expect(APP_PLAN_VERSION).toBe(PLAN_VERSION);
    expect(newerPlanVersion({ roomDims: {}, items: [] })).toBeNull();
    expect(newerPlanVersion({ roomDims: {}, door: {}, items: [] })).toBeNull();
    expect(newerPlanVersion(starterPlan())).toBeNull();
    expect(newerPlanVersion([4, 'x'])).toBeNull();
    expect(newerPlanVersion('nonsense')).toBeNull();
    expect(newerPlanVersion(v5)).toBe(5);
    expect(newerPlanVersion([5, 'x'])).toBe(5);
    expect(newerPlanVersion({ version: 9 })).toBe(9);
  });
});

describe('share links at boot', () => {
  for (const [name, url] of [
    ['#s= with a v5 plan', () => buildShareUrl(BASE, v5)],
    ['#j= with a compact v5 plan', () => buildShareUrl(BASE, [5, 'x'], { compress: false })],
    [
      '?config= with a v5 plan',
      async () => `${BASE}?config=${encodeURIComponent(btoa(JSON.stringify(v5)))}`,
    ],
  ] as const) {
    it(`${name}: not opened, nothing written, the URL left alone`, async () => {
      const s = stored();
      const before = s.dump();
      const href = await url();
      const result = await boot(href, createPlanStore(s));
      expect(result.linkProblem).toEqual({ kind: 'newer', version: 5, where: 'link' });
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
    ['a v3 object without pieces', plainLink('{"roomDims":{"width":9,"height":9}}')],
    ['a v4 plan without a usable room', plainLink(JSON.stringify({ ...v5, version: 4 }))],
    ['an empty #s=', `${BASE}#s=`],
    ['an empty ?config= (what the original wrote for emoji names)', `${BASE}?config=`],
    ['garbage in ?config=', `${BASE}?config=garbage`],
  ] as const) {
    it(`${name}: damaged, nothing written`, async () => {
      const s = stored();
      const before = s.dump();
      const result = await boot(href, createPlanStore(s));
      expect(result.linkProblem).toEqual({ kind: 'damaged' });
      expect(result.shared).toBeNull();
      expect(s.dump()).toEqual(before);
    });
  }

  it('an ordinary v3 link still opens, with no problem', async () => {
    const result = await boot(
      `${BASE}?config=${encodeURIComponent(btoa(JSON.stringify({ roomDims: { width: 9, height: 9 }, items: [] })))}`,
      createPlanStore(createMemoryStorage()),
    );
    expect(result.linkProblem).toBeUndefined();
    expect(result.shared?.createdProject).toBe(true);
    expect(result.state.plan.rooms[0]!.outline[2]).toEqual({ x: 9, y: 9 });
  });

  it('a link this build writes opens, with no problem', async () => {
    const url = await buildPlanUrl(BASE, withDoc(starterPlan(), 'Bedroom', 'ft-in'));
    const result = await boot(url, createPlanStore(createMemoryStorage()));
    expect(result.linkProblem).toBeUndefined();
    expect(result.shared).toMatchObject({ legacy: false, createdProject: true });
  });

  it('no link: no problem', async () => {
    expect((await boot(BASE, createPlanStore(createMemoryStorage()))).linkProblem).toBeUndefined();
  });
});

describe('the JSON box', () => {
  it('reads v3 configs and v4 plans, and says why it will not read others', () => {
    expect(readSharedPlan({ roomDims: { width: 9, height: 9 }, items: [] })).toMatchObject({
      ok: true,
      named: false,
      name: 'Shared Floor Plan',
    });
    expect(readSharedPlan(withDoc(starterPlan(), 'Den', 'cm'))).toMatchObject({
      ok: true,
      named: true,
      name: 'Den',
    });
    expect(readSharedPlan(v5)).toEqual({ ok: false, problem: 'newer', version: 5 });
    expect(readSharedPlan({ roomDims: {} })).toEqual({ ok: false, problem: 'invalid' });
    const twoRooms = {
      ...starterPlan(),
      rooms: [...starterPlan().rooms, { ...starterPlan().rooms[0]!, id: 'room-2' }],
    };
    expect(readSharedPlan(twoRooms)).toEqual({ ok: false, problem: 'unsupported' });
  });
});

describe('plans file import', () => {
  it('refuses a newer bare plan', () => {
    expect(() => parseProjectsImport(JSON.stringify(v5), 0)).toThrow(NewerPlanError);
  });

  it('refuses a whole plans file that holds one newer plan', () => {
    const file = {
      version: 1,
      exportedAt: '2026-11-24T00:00:00Z',
      projects: [
        { id: 'a', name: 'Old', data: { roomDims: { width: 9, height: 9 }, items: [] } },
        { id: 'b', name: 'New', data: v5 },
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
