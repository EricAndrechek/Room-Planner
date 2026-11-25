/**
 * Storage (docs/design/plan-format.md, section 4, "Storage, backup and rollback"): the first boot
 * of this build moves every storage fixture into the new keys and draws the same plans the v3
 * build showed; the v3 keys are never written, so a rollback finds them as they were, and what a
 * v3 build saves afterwards comes back as "(recovered)"; plans this build cannot open are never
 * opened and written back byte for byte; every save merges with what another tab stored; a full
 * storage leaves the app working in memory.
 */
import { describe, expect, it, vi } from 'vitest';
import originalLinks from '../core/__fixtures__/original-share-links.json';
import originalStorage from '../core/__fixtures__/original-storage.json';
import { STORAGE_FIXTURES } from '../core/testing/cases';
import { drawingDifferences } from '../core/testing/equivalence';
import { normalizeLayout } from '../core/testing/v3/layout';
import {
  createMemoryStorage as v3Memory,
  loadPersistedState as v3Load,
  migrateStorage as v3Migrate,
  saveProjects as v3SaveProjects,
  type Project as V3Project,
} from '../core/testing/v3/storage';
import { buildPlanUrl } from '../core/share/plan';
import type { Plan, Project } from '../types';
import { applySharedLink, boot, bootFromStorage } from './boot';
import { changePiece, resizeRoom, takeOutPiece } from './edits';
import { DEFAULT_PLAN_NAME, samePlan, starterPlan, withDoc } from './plans';
import { createProject } from './projects';
import {
  KEYS,
  LEGACY_KEYS,
  SNAP_PREF_KEY,
  createMemoryStorage,
  createPlanStore,
  fingerprint,
  loadSnapPreference,
  saveSnapPreference,
  splitJsonArray,
  type StorageLike,
} from './storage';

const NOW = new Date('2026-12-01T10:00:00Z');
const LATER = new Date('2026-12-02T10:00:00Z');

type Dump = Record<string, string>;
const fixture = (f: { localStorage: Record<string, string> }) =>
  createMemoryStorage(f.localStorage as Dump);

/** Every key that is not one of this build's own. */
const legacyPart = (d: Dump) =>
  Object.fromEntries(
    Object.entries(d).filter(([k]) => !(Object.values(KEYS) as string[]).includes(k)),
  );

/** What the v3 build read from `ls` (its own migration applied in a copy). */
const v3Reading = (ls: Dump) => {
  const s = v3Memory(ls);
  v3Migrate(s);
  return v3Load(s);
};

const json = <T = unknown>(s: StorageLike, key: string): T => JSON.parse(s.getItem(key)!) as T;

/** A storage whose writes to `failing` keys throw, as a full localStorage does. */
const quotaStorage = (initial: Dump, failing: (key: string) => boolean) => {
  const s = createMemoryStorage(initial);
  return {
    ...s,
    setItem: (k: string, v: string) => {
      if (failing(k)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      s.setItem(k, v);
    },
  };
};

const NEWER_RECORD =
  '{ "id":"project-v5",  "createdAt":"2027-01-01T00:00:00.000Z","updatedAt":"2027-01-02T00:00:00.000Z",' +
  '"plan":{"version":5,"name":"From the future","floors":[{"x":1.50}]} }';

/** Two rooms: in the format, not yet in the editor (PR 9). */
const TWO_ROOMS: Plan = {
  version: 4,
  name: 'Two rooms',
  unit: 'ft',
  rooms: [
    {
      id: 'room-1',
      outline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 6 },
        { x: 0, y: 6 },
      ],
      openings: [],
    },
    {
      id: 'room-2',
      outline: [
        { x: 10, y: 0 },
        { x: 16, y: 0 },
        { x: 16, y: 6 },
        { x: 10, y: 6 },
      ],
      openings: [],
    },
  ],
  items: [],
};

describe('the first boot of this build, from every storage fixture', () => {
  for (const [name, f] of STORAGE_FIXTURES) {
    describe(name, () => {
      const ls = f.localStorage as Dump;

      it('writes the new keys and draws what the v3 build showed', () => {
        const s = createMemoryStorage(ls);
        const state = bootFromStorage(createPlanStore(s), NOW);
        const v3 = v3Reading(ls);
        expect(drawingDifferences(v3.layout, state.plan)).toEqual([]);
        expect(state.unitSystem).toBe(v3.unitSystem);
        expect(state.designMode).toBe(v3.designMode);
        expect(state.firstVisit).toBe(false);
        expect(state.projects.map((p) => p.id)).toEqual(v3.projects.map((p) => p.id));
        v3.projects.forEach((p, i) => {
          const mine = state.projects[i]!;
          expect(mine.plan.name).toBe(p.name);
          expect([mine.createdAt, mine.updatedAt]).toEqual([p.createdAt, p.updatedAt]);
          expect(mine.ui?.designMode).toBe(p.data.designMode);
          expect(drawingDifferences(normalizeLayout(p.data), mine.plan)).toEqual([]);
        });
        const current = v3.projects.find((p) => p.id === v3.currentProjectId);
        expect(state.currentProjectId).toBe(current?.id ?? null);

        const dump = s.dump();
        expect(json<Project[]>(s, KEYS.plans)).toEqual(state.projects);
        expect(json<Plan>(s, KEYS.working)).toEqual(state.plan);
        expect(json(s, KEYS.ui)).toEqual({
          currentPlanId: state.currentProjectId,
          designMode: state.designMode,
          legacy: {
            migratedAt: NOW.toISOString(),
            fingerprint: fingerprint(ls[LEGACY_KEYS.projects] ?? null),
          },
        });
        // The first release's keys are read by a v3 build only below schema 1: left alone then.
        expect(dump[KEYS.schema]).toBe(name === 'v2-storage' ? ls[KEYS.schema] : '2');
      });

      it('never writes the old keys: a rollback finds them as they were', () => {
        const s = createMemoryStorage(ls);
        const store = createPlanStore(s);
        const state = bootFromStorage(store, NOW);
        // A session of edits and saves.
        const edited = changePiece(
          resizeRoom(state.plan, { width: 20, height: 9 }),
          state.plan.items[0]!.id,
          { x: 1 },
        );
        store.saveWorking(edited);
        store.savePlans([...state.projects, createProject('New', edited, LATER)]);
        store.saveUi({ currentPlanId: null, designMode: 'furniture' });
        expect(legacyPart(s.dump())).toEqual(legacyPart(ls));
        // What the v3 build reads now is what it read before the upgrade.
        expect(v3Reading(s.dump())).toEqual(v3Reading(ls));
      });

      it('boots the second time from the new keys, to the same state', () => {
        const s = createMemoryStorage(ls);
        const first = bootFromStorage(createPlanStore(s), NOW);
        const second = bootFromStorage(createPlanStore(s), LATER);
        expect(second).toEqual({ ...first, firstVisit: false });
      });
    });
  }

  it('keeps the saved status of the v3 build', () => {
    const state = bootFromStorage(createPlanStore(fixture(originalStorage)), NOW);
    expect(state.saveStatus).toBe('saved');
    expect(state.lastSavedAt?.toISOString()).toBe(state.projects[0]!.updatedAt);
    expect(state.plan.name).toBe(state.projects[0]!.plan.name);

    const edited = fixture(originalStorage);
    edited.setItem(LEGACY_KEYS.dims, JSON.stringify({ width: 20, height: 11 }));
    expect(bootFromStorage(createPlanStore(edited), NOW).saveStatus).toBe('unsaved');
  });
});

describe('a v3 build that runs again after the migration (rollback, a stale tab)', () => {
  /** Storage after the first boot, then a v3 build that edits the saved plan and saves it. */
  const afterV3Edit = () => {
    const s = fixture(originalStorage);
    const first = bootFromStorage(createPlanStore(s), NOW);
    const v3 = v3Memory(s.dump());
    const projects = JSON.parse(v3.getItem(LEGACY_KEYS.projects)!) as V3Project[];
    const edited = projects.map((p) => ({
      ...p,
      name: 'Edited in v3',
      data: { ...p.data, roomDims: { width: 15, height: 9 } },
      updatedAt: LATER.toISOString(),
    }));
    v3SaveProjects(v3, edited);
    return { first, storage: createMemoryStorage(v3.dump()) };
  };

  it('comes back as a new plan named "<name> (recovered)", next to the migrated one', () => {
    const { first, storage } = afterV3Edit();
    const state = bootFromStorage(createPlanStore(storage), new Date('2026-12-03T00:00:00Z'));
    expect(state.recovered).toBe(1);
    expect(state.projects).toHaveLength(first.projects.length + 1);
    expect(state.projects[0]).toEqual(first.projects[0]);
    const recovered = state.projects.at(-1)!;
    expect(recovered.plan.name).toBe('Edited in v3 (recovered)');
    expect(recovered.plan.rooms[0]!.outline[2]).toEqual({ x: 15, y: 9 });
    expect(json<Project[]>(storage, KEYS.plans)).toEqual(state.projects);
    expect(json<{ legacy: { fingerprint: string } }>(storage, KEYS.ui).legacy.fingerprint).toBe(
      fingerprint(storage.getItem(LEGACY_KEYS.projects)),
    );
  });

  it('is recovered once', () => {
    const { storage } = afterV3Edit();
    bootFromStorage(createPlanStore(storage), new Date('2026-12-03T00:00:00Z'));
    const again = bootFromStorage(createPlanStore(storage), new Date('2026-12-04T00:00:00Z'));
    expect(again.recovered).toBe(0);
    expect(again.projects.filter((p) => p.plan.name.endsWith('(recovered)'))).toHaveLength(1);
  });

  it('two tabs of this build booting at once still recover it once', () => {
    const { storage } = afterV3Edit();
    const t = new Date('2026-12-03T00:00:00Z');
    // Tab b reads the list and the fingerprint before tab a has written its recovery...
    const stale: Record<string, string | null> = {
      [KEYS.ui]: storage.getItem(KEYS.ui),
      [KEYS.plans]: storage.getItem(KEYS.plans),
    };
    createPlanStore(storage).load(t);
    const b = createPlanStore({
      ...storage,
      getItem: (k) => (k in stale ? stale[k]! : storage.getItem(k)),
    });
    expect(b.load(t).recovered).toBe(1);
    // ...and recovers the same save under the same id, so the merge keeps one copy.
    const final = createPlanStore(storage).load(LATER);
    expect(final.projects.filter((p) => p.plan.name.endsWith('(recovered)'))).toHaveLength(1);
  });

  it('a plan the v3 build did not save again is not recovered', () => {
    const s = fixture(originalStorage);
    bootFromStorage(createPlanStore(s), NOW);
    const v3 = v3Memory(s.dump());
    // A new plan saved by the v3 build, the old one untouched.
    const projects = JSON.parse(v3.getItem(LEGACY_KEYS.projects)!) as V3Project[];
    const added: V3Project = {
      ...projects[0]!,
      id: 'project-from-v3',
      name: 'Made in v3',
      createdAt: LATER.toISOString(),
      updatedAt: LATER.toISOString(),
    };
    v3SaveProjects(v3, [...projects, added]);
    const state = bootFromStorage(createPlanStore(createMemoryStorage(v3.dump())), LATER);
    expect(state.projects.map((p) => p.plan.name)).toEqual([
      projects[0]!.name,
      'Made in v3 (recovered)',
    ]);
  });
});

describe('plans this build cannot open', () => {
  const withNewKeys = (plans: string, working?: string) => {
    const s = createMemoryStorage();
    const state = bootFromStorage(createPlanStore(s), NOW);
    s.setItem(KEYS.plans, plans);
    if (working !== undefined) s.setItem(KEYS.working, working);
    return { s, state };
  };

  it('a saved plan from a newer build is listed, never opened, and written back byte for byte', () => {
    const mine = createProject('Mine', starterPlan(), NOW);
    const { s } = withNewKeys(`[${JSON.stringify(mine)},\n  ${NEWER_RECORD}]`);
    const store = createPlanStore(s);
    const state = store.load(LATER);
    expect(state.projects.map((p) => p.id)).toEqual([mine.id]);
    expect(state.locked).toEqual([
      {
        id: 'project-v5',
        name: 'From the future',
        version: 5,
        updatedAt: '2027-01-02T00:00:00.000Z',
      },
    ]);
    // Saves of the list (an edit, a new plan, a delete) keep it exactly.
    const edited = {
      ...mine,
      plan: resizeRoom(mine.plan, { width: 9, height: 9 }),
      updatedAt: LATER.toISOString(),
    };
    let saved = store.savePlans([edited]);
    expect(s.getItem(KEYS.plans)).toContain(NEWER_RECORD);
    saved = store.savePlans([...saved.projects, createProject('Another', starterPlan(), LATER)]);
    expect(s.getItem(KEYS.plans)).toContain(NEWER_RECORD);
    store.savePlans([], new Set(saved.projects.map((p) => p.id)));
    expect(s.getItem(KEYS.plans)).toBe(`[${NEWER_RECORD}]`);
  });

  it('a saved floor of several rooms opens (PR 9), and is not locked', () => {
    const record = JSON.stringify(createProject('Two rooms', TWO_ROOMS, NOW));
    const { s } = withNewKeys(`[${record}]`);
    const store = createPlanStore(s);
    const state = store.load(LATER);
    expect(state.locked).toEqual([]);
    expect(state.projects.map((p) => p.plan.rooms.length)).toEqual([2]);
  });

  it('a working plan from a newer build is not loaded and never written', () => {
    const working = '{"version":5,"name":"Future","floors":[]}';
    const { s } = withNewKeys('[]', working);
    const store = createPlanStore(s);
    const state = bootFromStorage(store, LATER);
    expect(state.workingLocked).toEqual({ reason: 'newer', version: 5 });
    expect(samePlan(state.plan, starterPlan())).toBe(true);
    expect(store.saveWorking(withDoc(starterPlan(), 'x', 'ft'))).toBe(false);
    expect(s.getItem(KEYS.working)).toBe(working);
  });

  it('opening a link while the working plan is locked still saves the link as a plan', async () => {
    const working = '{"version":5,"name":"Future"}';
    const { s } = withNewKeys('[]', working);
    const result = await boot(originalLinks.ftIn.url, createPlanStore(s), LATER);
    expect(result.shared?.createdProject).toBe(true);
    expect(result.linkProblem).toEqual({ kind: 'newer', version: 5, where: 'storage' });
    expect(s.getItem(KEYS.working)).toBe(working);
    expect(json<Project[]>(s, KEYS.plans).map((p) => p.plan.name)).toEqual(['Café Plan']);
  });
});

describe('every save merges with what is stored (other tabs)', () => {
  const setup = () => {
    const s = createMemoryStorage();
    const a = createPlanStore(s);
    a.load(NOW);
    const x = createProject('X', starterPlan(), NOW);
    const y = createProject('Y', starterPlan(), NOW);
    const saved = a.savePlans([x, y]);
    return { s, a, x: saved.projects[0]!, y: saved.projects[1]! };
  };

  it('keeps a plan another tab added, and returns it', () => {
    const { s, a, x, y } = setup();
    const b = createPlanStore(s);
    const bState = b.load(NOW);
    const z = createProject('Z', starterPlan(), LATER);
    b.savePlans([...bState.projects, z]);
    // Tab a still holds [x, y] and saves an edit to x.
    const result = a.savePlans([{ ...x, updatedAt: LATER.toISOString() }, y]);
    expect(result.projects.map((p) => p.plan.name)).toEqual(['X', 'Y', 'Z']);
    expect(json<Project[]>(s, KEYS.plans).map((p) => p.plan.name)).toEqual(['X', 'Y', 'Z']);
  });

  it('keeps the later save of a plan another tab changed', () => {
    const { s, a, x, y } = setup();
    const b = createPlanStore(s);
    const bState = b.load(NOW);
    const renamed = {
      ...bState.projects[1]!,
      plan: { ...y.plan, name: 'Y, renamed in b' },
      updatedAt: LATER.toISOString(),
    };
    b.savePlans([bState.projects[0]!, renamed]);
    // Tab a saves without having seen it: its older copy of y does not win.
    const result = a.savePlans([x, y]);
    expect(result.projects.map((p) => p.plan.name)).toEqual(['X', 'Y, renamed in b']);
  });

  it('a plan deleted here stays deleted', () => {
    const { s, a, x, y } = setup();
    a.savePlans([y], new Set([x.id]));
    expect(json<Project[]>(s, KEYS.plans).map((p) => p.id)).toEqual([y.id]);
  });

  it('a plan of ours whose id a newer build took is saved under a new id', () => {
    const { s, a, x, y } = setup();
    const upgraded = NEWER_RECORD.replace('project-v5', x.id);
    s.setItem(KEYS.plans, `[${upgraded},${JSON.stringify(y)}]`);
    const result = a.savePlans([{ ...x, updatedAt: LATER.toISOString() }, y]);
    const newId = result.renamed.get(x.id)!;
    expect(newId).toBe(`${x.id}-copy`);
    expect(s.getItem(KEYS.plans)).toContain(upgraded);
    expect(result.projects.map((p) => p.id)).toEqual([y.id, newId]);
  });

  it('two tabs, one of the v3 build and one of this build, never write over each other', () => {
    const s = fixture(originalStorage);
    // Both open; this build boots (migrates) first.
    const v4 = createPlanStore(s);
    const v4State = v4.load(NOW);
    const v3Tab = v3Load(s);
    // The v3 tab saves its layout and plans, this tab saves its own.
    const v3Projects = v3Tab.projects.map((p) => ({
      ...p,
      name: 'v3 tab',
      updatedAt: LATER.toISOString(),
    }));
    v3SaveProjects(s, v3Projects);
    s.setItem(LEGACY_KEYS.dims, JSON.stringify({ width: 7, height: 7 }));
    const mine = {
      ...v4State.projects[0]!,
      plan: { ...v4State.projects[0]!.plan, name: 'v4 tab' },
      updatedAt: LATER.toISOString(),
    };
    v4.savePlans([mine]);
    v4.saveWorking(mine.plan);
    // Each build reads back exactly what it wrote.
    expect(json<V3Project[]>(s, LEGACY_KEYS.projects).map((p) => p.name)).toEqual(['v3 tab']);
    expect(json<Project[]>(s, KEYS.plans).map((p) => p.plan.name)).toEqual(['v4 tab']);
    expect(v3Load(s).layout.roomDims).toEqual({ width: 7, height: 7 });
    // And this build's next boot recovers the v3 tab's save as well.
    const next = createPlanStore(s).load(new Date('2026-12-03T00:00:00Z'));
    expect(next.projects.map((p) => p.plan.name)).toEqual(['v4 tab', 'v3 tab (recovered)']);
  });
});

describe('a full or blocked storage', () => {
  it('first boot: works in memory, says so, and the old keys keep everything', () => {
    const ls = originalStorage.localStorage as Dump;
    const s = quotaStorage(ls, (k) => k.startsWith('room-planner-') && k !== LEGACY_KEYS.projects);
    const store = createPlanStore(s);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = bootFromStorage(store, NOW);
    expect(store.hasFailed()).toBe(true);
    expect(state.projects).toHaveLength(1);
    expect(drawingDifferences(v3Reading(ls).layout, state.plan)).toEqual([]);
    expect(s.dump()).toEqual(ls);
    // Later failures are reported to the planner (which shows its notice).
    const failures: string[] = [];
    store.onFailure((what) => failures.push(what));
    expect(store.saveWorking(state.plan)).toBe(false);
    store.savePlans(state.projects);
    expect(failures).toEqual(['write', 'write']);
    error.mockRestore();
  });

  it('before writing over a plan stored in an older format, both keys are backed up', () => {
    const v3Working = '{"roomDims":{"width":10,"height":10},"items":[]}';
    const s = createMemoryStorage({
      [KEYS.ui]: '{}',
      [KEYS.working]: v3Working,
      [KEYS.plans]: '[]',
    });
    const store = createPlanStore(s);
    const state = store.load(NOW);
    expect(state.plan.rooms[0]!.outline[2]).toEqual({ x: 10, y: 10 });
    expect(store.saveWorking(state.plan)).toBe(true);
    const backup = json<{ at: string; raw: { plans: string; working: string } }>(s, KEYS.backup);
    expect(backup.raw).toEqual({ plans: '[]', working: v3Working });
    // One generation, written once.
    store.saveWorking(state.plan);
    expect(json<{ raw: unknown }>(s, KEYS.backup).raw).toEqual(backup.raw);
  });

  it('when the backup cannot be written, nothing is written over', () => {
    const v3Working = '{"roomDims":{"width":10,"height":10},"items":[]}';
    const s = quotaStorage(
      { [KEYS.ui]: '{}', [KEYS.working]: v3Working, [KEYS.plans]: '[]' },
      (k) => k === KEYS.backup,
    );
    const store = createPlanStore(s);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failures: string[] = [];
    store.onFailure((what) => failures.push(what));
    const state = store.load(NOW);
    expect(store.saveWorking(state.plan)).toBe(false);
    store.savePlans([createProject('New', state.plan, NOW)]);
    expect(s.getItem(KEYS.working)).toBe(v3Working);
    expect(s.getItem(KEYS.plans)).toBe('[]');
    expect(failures).toEqual(['backup']);
    error.mockRestore();
  });
});

describe('robustness', () => {
  it('empty storage: the starter room, a first visit, no saved plan', () => {
    const state = bootFromStorage(createPlanStore(createMemoryStorage()), NOW);
    expect(samePlan(state.plan, starterPlan())).toBe(true);
    expect(state.plan.name).toBe(DEFAULT_PLAN_NAME);
    expect(state.unitSystem).toBe('ft-in');
    // First visit: furniture mode, so the sample pieces can be moved right away.
    expect(state.designMode).toBe('furniture');
    expect(state.firstVisit).toBe(true);
    expect(state.currentProjectId).toBeNull();
    expect(state.saveStatus).toBe('unsaved');
    expect(state.projects).toEqual([]);
  });

  it('a stored v3 layout without a stored mode keeps room setup (returning visitors)', () => {
    const s = createMemoryStorage({ [LEGACY_KEYS.dims]: '{"width":10,"height":10}' });
    const state = createPlanStore(s).load(NOW);
    expect(state.designMode).toBe('room-setup');
    expect(state.firstVisit).toBe(false);
    expect(state.plan.rooms[0]!.outline[2]).toEqual({ x: 10, y: 10 });
  });

  it('corrupt v3 values fall back to the v3 defaults instead of crashing', () => {
    const s = createMemoryStorage({
      [LEGACY_KEYS.dims]: '{not json',
      [LEGACY_KEYS.doors]: 'null',
      [LEGACY_KEYS.items]: '[null, 3, {"label":"Chair","width":2}]',
      [LEGACY_KEYS.units]: 'furlongs',
      [LEGACY_KEYS.mode]: 'party',
      [LEGACY_KEYS.projects]: '{"oops":true}',
    });
    const state = createPlanStore(s).load(NOW);
    const v3 = v3Reading(s.dump());
    expect(drawingDifferences(v3.layout, state.plan)).toEqual([]);
    expect(state.unitSystem).toBe('ft-in');
    expect(state.designMode).toBe('room-setup');
    expect(state.projects).toEqual([]);
  });

  it('corrupt new keys never crash the boot', () => {
    for (const bad of ['{not json', 'null', '42', '[1, "x", null, {"id": 3}]']) {
      const s = createMemoryStorage({ [KEYS.plans]: bad, [KEYS.working]: bad, [KEYS.ui]: bad });
      const state = bootFromStorage(createPlanStore(s), NOW);
      expect(state.projects).toEqual([]);
      expect(samePlan(state.plan, starterPlan())).toBe(true);
    }
  });

  it('a dangling current plan id starts a fresh plan', () => {
    const s = fixture(originalStorage);
    s.setItem(LEGACY_KEYS.currentProject, 'project-gone');
    const state = bootFromStorage(createPlanStore(s), NOW);
    expect(state.currentProjectId).toBeNull();
    expect(state.saveStatus).toBe('unsaved');
  });
});

describe('opening share links at boot', () => {
  it('a v3 link creates a project named after the shared plan and clears the URL', async () => {
    const s = createMemoryStorage();
    const result = await boot(originalLinks.ftIn.url, createPlanStore(s), NOW);
    expect(result.shared).toEqual({
      legacy: true,
      createdProject: true,
      cleanUrl: 'http://localhost:5199/',
    });
    expect(result.state.projects).toHaveLength(1);
    expect(result.state.projects[0]!.plan.name).toBe('Café Plan');
    expect(result.state.currentProjectId).toBe(result.state.projects[0]!.id);
    // Written through to storage.
    const persisted = createPlanStore(s).load(LATER);
    expect(persisted.currentProjectId).toBe(result.state.currentProjectId);
    expect(persisted.plan).toEqual(result.state.plan);
    expect(persisted.projects).toEqual(result.state.projects);
  });

  it('re-opening the same link reuses the existing project (no duplicates)', async () => {
    const s = createMemoryStorage();
    const first = await boot(originalLinks.ftIn.url, createPlanStore(s));
    const second = await boot(originalLinks.ftIn.url, createPlanStore(s));
    expect(second.shared?.createdProject).toBe(false);
    expect(second.state.projects).toHaveLength(1);
    expect(second.state.currentProjectId).toBe(first.state.currentProjectId);
  });

  it('a link made by this build opens the same plan, also when opened twice', async () => {
    const s = createMemoryStorage();
    const plan = withDoc(
      changePiece(starterPlan(), 'item-1', { x: 1.2345678 }),
      'Wohnzimmer 🛋️',
      'cm',
    );
    const url = await buildPlanUrl('https://example.com/', plan);
    const result = await boot(url, createPlanStore(s));
    expect(result.shared).toMatchObject({
      legacy: false,
      createdProject: true,
      cleanUrl: 'https://example.com/',
    });
    expect(result.state.projects[0]!.plan.name).toBe('Wohnzimmer 🛋️');
    expect(samePlan(result.state.plan, plan)).toBe(true);
    expect((await boot(url, createPlanStore(s))).shared?.createdProject).toBe(false);
  });

  it('a link keeps the pieces in the inventory, and they stay out of the room', async () => {
    const s = createMemoryStorage();
    const plan = withDoc(takeOutPiece(starterPlan(), 'item-6'), 'Aside', 'ft-in');
    const url = await buildPlanUrl('https://example.com/', plan);
    const result = await boot(url, createPlanStore(s));
    expect(result.linkProblem ?? null).toBeNull();
    expect(samePlan(result.state.plan, plan)).toBe(true);
    const chair = result.state.plan.items.find((i) => i.label === 'Chair')!;
    expect(chair).not.toHaveProperty('placement');
    expect(chair).toMatchObject({ width: 1.5, depth: 1.5, color: '#fdba74' });
  });

  it('a link without a name gets its own project instead of overwriting the current one', () => {
    const s = fixture(originalStorage);
    const store = createPlanStore(s);
    const before = bootFromStorage(store);
    const { state, createdProject } = applySharedLink(
      before,
      { plan: starterPlan(), name: 'Shared Floor Plan' },
      store,
    );
    expect(createdProject).toBe(true);
    expect(state.projects).toHaveLength(2);
    expect(state.projects[0]).toEqual(before.projects[0]);
    expect(state.projects[1]!.plan.name).toBe('Shared Floor Plan');
    expect(state.currentProjectId).toBe(state.projects[1]!.id);
  });

  it('keeps this device’s units', async () => {
    const s = createMemoryStorage({ [LEGACY_KEYS.units]: 'cm' });
    const result = await boot(originalLinks.meters.url, createPlanStore(s));
    expect(result.state.unitSystem).toBe('cm');
    expect(result.state.plan.settings?.unitSystem).toBe('cm');
  });

  it('a link holding a floor of several rooms opens it (PR 9)', async () => {
    const s = createMemoryStorage();
    const store = createPlanStore(s);
    bootFromStorage(store, NOW);
    const result = await boot(await buildPlanUrl('https://example.com/', TWO_ROOMS), store, LATER);
    expect(result.linkProblem).toBeUndefined();
    expect(result.state.plan.rooms).toHaveLength(2);
  });

  it('an invalid link is ignored', async () => {
    const result = await boot(
      'https://example.com/?config=garbage',
      createPlanStore(createMemoryStorage()),
    );
    expect(result.shared).toBeNull();
    expect(result.linkProblem).toEqual({ kind: 'damaged' });
  });
});

describe('splitJsonArray', () => {
  it('gives each element as written', () => {
    const text = ' [ {"a":"],[}{\\"x"} ,\n 1.50, "s,t" ,[1,[2]] ,null]  ';
    expect(splitJsonArray(text)).toEqual(['{"a":"],[}{\\"x"}', '1.50', '"s,t"', '[1,[2]]', 'null']);
    expect(splitJsonArray('[]')).toEqual([]);
    expect(splitJsonArray('{"a":1}')).toBeNull();
    expect(splitJsonArray('[1,')).toBeNull();
  });
});

describe('snap preference', () => {
  it('defaults to on, round-trips, and stays out of the plan keys', () => {
    const s = createMemoryStorage();
    expect(loadSnapPreference(s)).toBe(true);
    saveSnapPreference(s, false);
    expect(loadSnapPreference(s)).toBe(false);
    expect(s.dump()).toEqual({ [SNAP_PREF_KEY]: '0' });
    expect(Object.values(KEYS)).not.toContain(SNAP_PREF_KEY);
    saveSnapPreference(s, true);
    expect(loadSnapPreference(s)).toBe(true);
  });
});
