import { describe, expect, it } from 'vitest';
import earlyV3 from './__fixtures__/early-v3-storage.json';
import originalLinks from './__fixtures__/original-share-links.json';
import originalStorage from './__fixtures__/original-storage.json';
import v2Storage from './__fixtures__/v2-storage.json';
import { applySharedLink, boot, bootFromStorage } from './boot';
import { defaultLayout, toShareConfig } from './layout';
import { buildShareUrl } from './share';
import {
  KEYS,
  SCHEMA_KEY,
  SCHEMA_VERSION,
  createMemoryStorage,
  loadPersistedState,
  migrateStorage,
  saveLayout,
} from './storage';

const fixture = (f: { localStorage: Record<string, string> }) =>
  createMemoryStorage({ ...f.localStorage });

describe('storage written by the original app', () => {
  it('loads every key unchanged', () => {
    const s = fixture(originalStorage);
    const raw = originalStorage.localStorage;
    migrateStorage(s);
    const state = loadPersistedState(s);

    expect(state.unitSystem).toBe('ft-in');
    expect(state.designMode).toBe('furniture');
    expect(state.currentProjectId).toBe(raw['room-sim-v3-currentProject']);
    expect(state.layout).toEqual({
      roomDims: JSON.parse(raw['room-sim-v3-dims']),
      doors: JSON.parse(raw['room-sim-v3-doors']),
      windows: JSON.parse(raw['room-sim-v3-windows']),
      items: JSON.parse(raw['room-sim-v3-items']),
    });
    expect(state.projects).toEqual(JSON.parse(raw['room-planner-projects']));
    expect(state.projects[0]!.name).toBe('Café Plan');
  });

  it('migration only adds the schema marker; legacy keys are untouched', () => {
    const s = fixture(originalStorage);
    migrateStorage(s);
    const after = s.dump();
    expect(after[SCHEMA_KEY]).toBe(String(SCHEMA_VERSION));
    delete after[SCHEMA_KEY];
    expect(after).toEqual(originalStorage.localStorage);
  });

  it('migration is idempotent', () => {
    const s = fixture(v2Storage);
    migrateStorage(s);
    const once = s.dump();
    migrateStorage(s);
    expect(s.dump()).toEqual(once);
  });

  it('writes in the original format (round-trip through save)', () => {
    const s = fixture(originalStorage);
    const state = loadPersistedState(s);
    const out = createMemoryStorage();
    saveLayout(out, state.layout);
    for (const key of [KEYS.dims, KEYS.doors, KEYS.windows, KEYS.items]) {
      expect(out.getItem(key)).toBe(
        originalStorage.localStorage[key as keyof typeof originalStorage.localStorage],
      );
    }
  });

  it('boot restores the saved project as "saved"', () => {
    const s = fixture(originalStorage);
    const state = bootFromStorage(s);
    expect(state.saveStatus).toBe('saved');
    expect(state.lastSavedAt?.toISOString()).toBe(
      JSON.parse(originalStorage.localStorage['room-planner-projects'])[0].updatedAt,
    );
  });
});

describe('early v3 storage (Tailwind colors, project data without mode/units)', () => {
  it('normalizes colors to hex and keeps everything else', () => {
    const s = fixture(earlyV3);
    migrateStorage(s);
    const state = loadPersistedState(s);
    expect(state.unitSystem).toBe('ft');
    expect(state.designMode).toBe('room-setup');
    expect(state.layout.items.map((i) => i.color)).toEqual([
      '#93c5fd',
      '#6ee7b7',
      '#fcd34d',
      '#fecaca',
    ]);
    expect(state.layout.items[2]!.visible).toBe(false);
    expect(state.layout.items[1]!.rotation).toBe(45);
    // the raw project is kept as-is (normalized only when opened)
    expect(state.projects[0]!.data.items[0]!.color).toBe('bg-blue-200 border-blue-400');
    expect(bootFromStorage(fixture(earlyV3)).saveStatus).toBe('saved');
  });
});

describe('v2 storage (first release: room-sim-v2-*, single door)', () => {
  it('is migrated forward into the v3 keys without deleting the v2 keys', () => {
    const s = fixture(v2Storage);
    migrateStorage(s);
    const dump = s.dump();
    for (const [k, v] of Object.entries(v2Storage.localStorage)) expect(dump[k]).toBe(v);

    const state = loadPersistedState(s);
    expect(state.layout.roomDims).toEqual({ width: 10, height: 9 });
    expect(state.layout.doors).toEqual([
      {
        width: 2.5,
        position: 3,
        wall: 'bottom',
        hinge: 'left',
        open: 'out',
        id: 1,
        type: 'swing-out',
      },
    ]);
    expect(state.layout.windows).toEqual([]);
    expect(state.layout.items).toHaveLength(4);
    expect(state.layout.items[0]).toMatchObject({ label: 'Bed', color: '#93c5fd' });
  });

  it('does not override existing v3 data', () => {
    const s = createMemoryStorage({ ...v2Storage.localStorage, ...originalStorage.localStorage });
    migrateStorage(s);
    expect(loadPersistedState(s).layout.roomDims).toEqual({ width: 14.5, height: 11 });
  });
});

describe('robustness', () => {
  it('empty storage yields the starter room and no project', () => {
    const s = createMemoryStorage();
    const state = bootFromStorage(s);
    expect(state.layout).toEqual(defaultLayout());
    expect(state.unitSystem).toBe('ft-in');
    expect(state.designMode).toBe('room-setup');
    expect(state.currentProjectId).toBeNull();
    expect(state.saveStatus).toBe('unsaved');
    expect(state.projects).toEqual([]);
  });

  it('corrupt values fall back to defaults instead of crashing', () => {
    const s = createMemoryStorage({
      [KEYS.dims]: '{not json',
      [KEYS.doors]: 'null',
      [KEYS.items]: '[null, 3, {"label":"Chair","width":2}]',
      [KEYS.units]: 'furlongs',
      [KEYS.mode]: 'party',
      [KEYS.projects]: '{"oops":true}',
    });
    const state = loadPersistedState(s);
    expect(state.layout.roomDims).toEqual({ width: 12, height: 12 });
    expect(state.layout.doors).toEqual(defaultLayout().doors);
    expect(state.layout.items).toEqual([
      {
        id: 'item-3',
        label: 'Chair',
        width: 2,
        height: 2,
        x: 0,
        y: 0,
        rotation: 0,
        color: '#93c5fd',
      },
    ]);
    expect(state.unitSystem).toBe('ft-in');
    expect(state.designMode).toBe('room-setup');
    expect(state.projects).toEqual([]);
  });

  it('a dangling currentProject id starts a fresh plan', () => {
    const s = createMemoryStorage({
      ...originalStorage.localStorage,
      [KEYS.currentProject]: 'project-gone',
    });
    const state = bootFromStorage(s);
    expect(state.currentProjectId).toBeNull();
    expect(state.saveStatus).toBe('unsaved');
  });

  it('an edited-but-not-yet-autosaved layout boots as unsaved', () => {
    const s = fixture(originalStorage);
    s.setItem(KEYS.dims, JSON.stringify({ width: 20, height: 11 }));
    expect(bootFromStorage(s).saveStatus).toBe('unsaved');
  });
});

describe('opening share links at boot', () => {
  it('a legacy link creates a project named after the shared plan and clears the URL', async () => {
    const s = createMemoryStorage();
    const result = await boot(originalLinks.ftIn.url, s, new Date('2026-01-01T00:00:00Z'));
    expect(result.shared).toEqual({
      legacy: true,
      createdProject: true,
      cleanUrl: 'http://localhost:5199/',
    });
    expect(result.state.projects).toHaveLength(1);
    expect(result.state.projects[0]!.name).toBe('Café Plan');
    expect(result.state.currentProjectId).toBe(result.state.projects[0]!.id);
    // written through to storage in the original format
    const persisted = loadPersistedState(s);
    expect(persisted.currentProjectId).toBe(result.state.currentProjectId);
    expect(persisted.layout).toEqual(result.state.layout);
    expect(persisted.projects).toEqual(result.state.projects);
  });

  it('re-opening the same link reuses the existing project (no duplicates)', async () => {
    const s = createMemoryStorage();
    const first = await boot(originalLinks.ftIn.url, s);
    const second = await boot(originalLinks.ftIn.url, s);
    expect(second.shared?.createdProject).toBe(false);
    expect(second.state.projects).toHaveLength(1);
    expect(second.state.currentProjectId).toBe(first.state.currentProjectId);
  });

  it('a link without a name gets its own project instead of overwriting the current one', async () => {
    const s = fixture(originalStorage);
    const before = bootFromStorage(s);
    const { name: _name, ...unnamed } = toShareConfig(defaultLayout(), 'x', 'ft');
    const { state, createdProject } = applySharedLink(before, { config: unnamed, legacy: true }, s);
    expect(createdProject).toBe(true);
    expect(state.projects).toHaveLength(2);
    expect(state.projects[0]).toEqual(before.projects[0]);
    expect(state.projects[1]!.name).toBe('Shared Floor Plan');
    expect(state.currentProjectId).toBe(state.projects[1]!.id);
  });

  it('a new #s= link opens with unicode intact', async () => {
    const s = createMemoryStorage();
    const layout = {
      ...defaultLayout(),
      items: defaultLayout().items.map((i) => ({ ...i, label: `${i.label} 🪑` })),
    };
    const url = await buildShareUrl(
      'https://example.com/',
      toShareConfig(layout, 'Wohnzimmer 🛋️', 'cm'),
    );
    const result = await boot(url, s);
    expect(result.shared).toMatchObject({
      legacy: false,
      createdProject: true,
      cleanUrl: 'https://example.com/',
    });
    expect(result.state.projects[0]!.name).toBe('Wohnzimmer 🛋️');
    expect(result.state.layout.items.map((i) => i.label)).toEqual(layout.items.map((i) => i.label));
    expect(result.state.layout.items.every((i) => i.label.endsWith(' 🪑'))).toBe(true);
    expect(result.state.layout.roomDims.width).toBeCloseTo(12, 4);
  });

  it('an invalid link is ignored', async () => {
    const result = await boot('https://example.com/?config=garbage', createMemoryStorage());
    expect(result.shared).toBeNull();
  });
});
