/**
 * Every historical input (docs/design/plan-format.md, section 4, the fixture table) loads through
 * `loadPlan` into a plan that draws exactly what today's v3 reader shows for it. The SVG-level
 * comparison follows in PR 3, once the scene draws plans.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import v2Storage from './__fixtures__/v2-storage.json';
import earlyStorage from './__fixtures__/early-v3-storage.json';
import originalStorage from './__fixtures__/original-storage.json';
import doorsStorage from './__fixtures__/doors-storage.json';
import v2Link from './__fixtures__/v2-config-link.json';
import earlyLink from './__fixtures__/early-v3-config-link.json';
import originalLinks from './__fixtures__/original-share-links.json';
import fragmentLinks from './__fixtures__/fragment-links.json';
import plansFile from './__fixtures__/plans-file.json';
import bareFile from './__fixtures__/bare-layout-file.json';
import { fromShareConfig, normalizeLayout, type ShareConfig } from './layout';
import { loadPlan, type LoadResult } from './load';
import type { Plan } from './schema';
import { readShareLink } from './share/link';
import { readPlanLink } from './share/plan';
import { drawingDifferences } from './testing/equivalence';
import { createMemoryStorage, loadPersistedState, migrateStorage } from '../lib/storage';
import { parseProjectsImport } from '../lib/projects';
import type { Layout, Project } from '../types';

/** sha256 (first 16 hex digits) of every fixture file. A new fixture adds a line; none changes. */
const FROZEN: Record<string, string> = {
  'bare-layout-file.json': 'ef15c708902f58f1',
  'doors-storage.json': 'a93c70dfb6e546dc',
  'early-v3-config-link.json': 'cd7893dea428b025',
  'early-v3-storage.json': 'e7d473bdc60ec59c',
  'fragment-links.json': 'fb0b4ac0a799ad27',
  'original-share-links.json': '76ab27d91eb9e0a6',
  'original-storage.json': '9aa279090cb48dd8',
  'plans-file.json': 'a4f3be58cf7df9e3',
  'v2-config-link.json': 'a50be580fd671b4c',
  'v2-storage.json': 'f3dffa4856de507c',
};

const plan = (r: LoadResult | { ok: false }): Plan => {
  if (!r.ok) throw new Error(`not loaded: ${JSON.stringify(r)}`);
  return r.plan;
};

const raw = (f: { localStorage: Record<string, string> }) => f.localStorage;
const json = (s: string | undefined) => (s === undefined ? undefined : (JSON.parse(s) as unknown));

/** Today's reading of a storage fixture: the working layout and every saved plan. */
const todayFromStorage = (ls: Record<string, string>) => {
  const s = createMemoryStorage(ls);
  migrateStorage(s);
  const state = loadPersistedState(s);
  return {
    working: state.layout,
    unitSystem: state.unitSystem,
    projects: state.projects.map((p) => ({ p, layout: normalizeLayout(p.data) })),
  };
};

/** The same storage, read as documents (what the v4 app's first boot does, PR 5). */
const v3Working = (ls: Record<string, string>) => ({
  roomDims: json(ls['room-sim-v3-dims']),
  doors: json(ls['room-sim-v3-doors']),
  windows: json(ls['room-sim-v3-windows']),
  items: json(ls['room-sim-v3-items']),
  unitSystem: ls['room-sim-v3-units'],
});

const expectSame = (layout: Layout, p: Plan) => expect(drawingDifferences(layout, p)).toEqual([]);

describe('storage fixtures', () => {
  it('v2 keys (650f35d): one door, Tailwind colours, no windows', () => {
    const ls = raw(v2Storage);
    const today = todayFromStorage(ls);
    // v2 keys are read as a v2 document; v2 never had windows.
    const doc = {
      roomDims: json(ls['room-sim-v2-dims']),
      door: json(ls['room-sim-v2-door']),
      items: json(ls['room-sim-v2-items']),
      windows: [],
    };
    const r = loadPlan(doc, 'lenient', { lengthsInFeet: true });
    expect(r.ok && r.from).toBe(2);
    const p = plan(r);
    expectSame(today.working, p);
    expect(p.rooms[0]!.openings).toEqual([
      expect.objectContaining({ id: 'door-1', kind: 'door', type: 'swing-out', wall: 2 }),
    ]);
    expect(p.items.find((i) => i.label === 'Bed')!.color).toBe('#93c5fd');
    expect(p.items.find((i) => i.label === 'Wardrobe')!.hidden).toBe(true);
  });

  for (const [name, fixture] of [
    ['early v3 (3bd206d): Tailwind colours, no units in plans', earlyStorage],
    ['v3 (2c81c9d to 2cae5c5): hex colours, locked, units in plan', originalStorage],
    ['schema 1 with every door type and 180-degree swings (main)', doorsStorage],
  ] as const) {
    it(name, () => {
      const ls = raw(fixture);
      const today = todayFromStorage(ls);
      const working = plan(loadPlan(v3Working(ls), 'lenient', { lengthsInFeet: true }));
      expectSame(today.working, working);
      expect(working.settings?.unitSystem).toBe(today.unitSystem);
      expect(today.projects.length).toBeGreaterThan(0);
      for (const { p, layout } of today.projects) {
        const doc = { ...(p.data as object), name: p.name };
        const saved = plan(loadPlan(doc, 'lenient', { lengthsInFeet: true }));
        expectSame(layout, saved);
        expect(saved.name).toBe(p.name);
        expect(saved).not.toHaveProperty('designMode');
      }
    });
  }

  it('keeps every door type, hinge and angle from main', () => {
    const p = plan(loadPlan(v3Working(raw(doorsStorage)), 'strict', { lengthsInFeet: true }));
    const doors = p.rooms[0]!.openings.filter((o) => o.kind === 'door');
    expect(new Set(doors.map((d) => d.type)).size).toBe(8);
    expect(doors.filter((d) => d.swingAngle === 180)).toHaveLength(3);
    expect(new Set(doors.map((d) => d.wall))).toEqual(new Set([0, 1, 2, 3]));
  });
});

describe('link and JSON fixtures', () => {
  const links: [string, string][] = [
    ['?config= {roomDims, door, items} (650f35d)', v2Link.url],
    ['?config= {roomDims, doors, windows, items} in feet (3bd206d)', earlyLink.url],
    ['?config= with name and ft-in (2c81c9d to 2cae5c5)', originalLinks.ftIn.url],
    ['?config= with name and metres', originalLinks.meters.url],
    ['#s= with a non-Latin name, centimetres (2.0)', fragmentLinks.deflate],
    ['#j= with a non-Latin name, centimetres (2.0)', fragmentLinks.plain],
  ];
  for (const [name, url] of links) {
    it(name, async () => {
      const today = await readShareLink(url);
      expect(today).not.toBeNull();
      const p = plan(await readPlanLink(url));
      expectSame(fromShareConfig(today!.config), p);
      if (typeof today!.config.name === 'string') expect(p.name).toBe(today!.config.name);
    });
  }

  it('the units of a link become the display preference', async () => {
    expect(plan(await readPlanLink(originalLinks.meters.url)).settings?.unitSystem).toBe('m');
    expect(plan(await readPlanLink(fragmentLinks.deflate)).settings?.unitSystem).toBe('cm');
    expect(plan(await readPlanLink(originalLinks.ftIn.url)).settings?.unitSystem).toBe('ft-in');
    expect(plan(await readPlanLink(earlyLink.url)).settings).toBeUndefined();
    expect(plan(await readPlanLink(fragmentLinks.plain)).name).toBe('Gästezimmer · 客房 🛏️');
  });

  it('the Share dialog JSON box: the same JSON as the links', () => {
    for (const config of [
      v2Link.json,
      earlyLink.json,
      originalLinks.ftIn.json,
      originalLinks.meters.json,
      fragmentLinks.json,
    ] as ShareConfig[]) {
      expectSame(fromShareConfig(config), plan(loadPlan(config, 'lenient')));
    }
  });

  it('the empty link the original wrote for an emoji name is damaged, not a plan', async () => {
    expect(await readPlanLink(originalLinks.emojiName.url)).toEqual({
      ok: false,
      reason: 'damaged',
    });
  });
});

describe('plans file fixtures', () => {
  it('{version: 1, exportedAt, projects} (3bd206d onwards)', () => {
    const today = parseProjectsImport(plansFile.text, 0);
    const file = JSON.parse(plansFile.text) as { projects: Project[] };
    expect(file.projects).toHaveLength(today.length);
    file.projects.forEach((p, i) => {
      const doc = { ...p.data, name: p.name };
      expectSame(
        normalizeLayout(today[i]!.data),
        plan(loadPlan(doc, 'lenient', { lengthsInFeet: true })),
      );
    });
  });

  it('a bare layout object, read in feet as the import always has', () => {
    const [today] = parseProjectsImport(bareFile.text, 0);
    const p = plan(loadPlan(JSON.parse(bareFile.text), 'lenient', { lengthsInFeet: true }));
    expectSame(normalizeLayout(today!.data), p);
  });
});

describe('guarantees on every fixture', () => {
  const inputs: [string, unknown, { lengthsInFeet?: boolean }][] = [
    ['early v3 working', v3Working(raw(earlyStorage)), { lengthsInFeet: true }],
    ['original working', v3Working(raw(originalStorage)), { lengthsInFeet: true }],
    ['doors working', v3Working(raw(doorsStorage)), { lengthsInFeet: true }],
    ['v2 link json', v2Link.json, {}],
    ['early link json', earlyLink.json, {}],
    ['metres json', originalLinks.meters.json, {}],
    ['cm json', fragmentLinks.json, {}],
  ];
  for (const [name, input, options] of inputs) {
    it(`${name}: idempotent and strict-valid`, () => {
      const once = plan(loadPlan(input, 'lenient', options));
      const twice = plan(loadPlan(once, 'lenient'));
      expect(twice).toEqual(once);
      expect(plan(loadPlan(once, 'strict'))).toEqual(once);
      expect(once.version).toBe(4);
    });
  }

  it('unknown fields survive on the same entity', () => {
    const config = structuredClone(originalLinks.ftIn.json) as unknown as Record<
      string,
      unknown
    > & {
      roomDims: Record<string, unknown>;
      doors: Record<string, unknown>[];
      windows: Record<string, unknown>[];
      items: Record<string, unknown>[];
    };
    config.theme = 'dark';
    config.roomDims.floor = 'oak';
    config.doors[0]!.lock = 'deadbolt';
    config.windows[0]!.glazing = 'double';
    config.items[0]!.notesFromV3 = 'keep me';
    const p = plan(loadPlan(config, 'lenient'));
    expect(p).toMatchObject({ theme: 'dark' });
    expect(p.rooms[0]).toMatchObject({ floor: 'oak' });
    expect(p.rooms[0]!.openings[0]).toMatchObject({ lock: 'deadbolt' });
    expect(p.rooms[0]!.openings.find((o) => o.kind === 'window')).toMatchObject({
      glazing: 'double',
    });
    expect(p.items[0]).toMatchObject({ notesFromV3: 'keep me' });
  });

  it('fixture files are never edited (section 4: new formats add files)', () => {
    const dir = new URL('./__fixtures__/', import.meta.url);
    const hashes = Object.fromEntries(
      readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => [
          f,
          createHash('sha256')
            .update(readFileSync(new URL(f, dir)))
            .digest('hex')
            .slice(0, 16),
        ]),
    );
    expect(hashes).toEqual(FROZEN);
  });
});
