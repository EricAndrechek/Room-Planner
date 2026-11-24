/**
 * Test helper: every fixture and guide example as the pair the golden tests compare, the v3 layout
 * the v3 app read from it (the frozen reader in testing/v3/) and the v4 plan the app reads from it
 * now, through its own paths (the storage migration, link and JSON reading, the plans-file
 * import), with the title and units the drawing uses.
 */
import v2Storage from '../__fixtures__/v2-storage.json';
import earlyStorage from '../__fixtures__/early-v3-storage.json';
import originalStorage from '../__fixtures__/original-storage.json';
import doorsStorage from '../__fixtures__/doors-storage.json';
import v2Link from '../__fixtures__/v2-config-link.json';
import earlyLink from '../__fixtures__/early-v3-config-link.json';
import originalLinks from '../__fixtures__/original-share-links.json';
import fragmentLinks from '../__fixtures__/fragment-links.json';
import plansFile from '../__fixtures__/plans-file.json';
import bareFile from '../__fixtures__/bare-layout-file.json';
import type { Plan } from '../schema';
import { readSharePayload } from '../share/link';
import { fromShareConfig, normalizeLayout, type ShareConfig } from './v3/layout';
import { readShareLink } from './v3/share';
import {
  createMemoryStorage as v3Memory,
  loadPersistedState,
  migrateStorage,
  type Project as V3Project,
} from './v3/storage';
import { parseProjectsImport as v3Import } from './v3/projects';
import type { Layout, UnitSystem } from './v3/types';
import { EXAMPLES } from '../../lib/guides/examples';
import { readSharedPlan } from '../../lib/boot';
import { createMemoryStorage, createPlanStore } from '../../lib/storage';
import { parseProjectsImport } from '../../lib/projects';

export interface GoldenCase {
  name: string;
  /** The v3 app's reading (absent for the guide examples, which are written as plans). */
  layout?: Layout;
  unitSystem: UnitSystem;
  title: string;
  /** The same input as the app reads it now. */
  plan: Plan;
}

/** The storage fixtures: `localStorage` as each version of the app left it. */
export const STORAGE_FIXTURES = [
  ['v2-storage', v2Storage],
  ['early-v3-storage', earlyStorage],
  ['original-storage', originalStorage],
  ['doors-storage', doorsStorage],
] as const;

const units = (p: Plan): UnitSystem => p.settings?.unitSystem ?? 'ft-in';

export async function goldenCases(): Promise<GoldenCase[]> {
  const cases: GoldenCase[] = [];
  const add = (name: string, layout: Layout | undefined, plan: Plan, title = plan.name) =>
    cases.push({ name, layout, plan, unitSystem: units(plan), title });

  // Storage: the working plan and every saved plan, after the first boot of this build.
  for (const [name, fixture] of STORAGE_FIXTURES) {
    const ls = fixture.localStorage as Record<string, string>;
    const old = v3Memory(ls);
    migrateStorage(old);
    const v3 = loadPersistedState(old);
    const state = createPlanStore(createMemoryStorage(ls)).load();
    // The drawing's title is the plan's name; the v3 working layout had none.
    add(`${name} working`, v3.layout, state.plan, 'Untitled');
    v3.projects.forEach((p, i) => {
      const plan = state.projects.find((q) => q.id === p.id)!.plan;
      add(`${name} project ${i}`, normalizeLayout(p.data), plan);
    });
  }

  // Links and the JSON box.
  const read = (data: unknown): Plan => {
    const r = readSharedPlan(data);
    if (!r.ok) throw new Error(`not read: ${JSON.stringify(r)}`);
    return r.plan;
  };
  for (const [name, url] of [
    ['v2 ?config=', v2Link.url],
    ['early v3 ?config=', earlyLink.url],
    ['original ?config= ft-in', originalLinks.ftIn.url],
    ['original ?config= m', originalLinks.meters.url],
    ['#s= cm', fragmentLinks.deflate],
    ['#j= cm', fragmentLinks.plain],
  ] as const) {
    const today = await readShareLink(url);
    const payload = await readSharePayload(url);
    if (payload.status !== 'ok') throw new Error(`${name}: ${payload.status}`);
    add(`link ${name}`, fromShareConfig(today!.config), read(payload.data));
  }
  for (const [name, config] of [
    ['v2', v2Link.json],
    ['early v3', earlyLink.json],
    ['cm', fragmentLinks.json],
  ] as const) {
    add(`json ${name}`, fromShareConfig(config as ShareConfig), read(config));
  }

  // Plans files.
  const before = v3Import(plansFile.text, 0);
  const imported = parseProjectsImport(plansFile.text, 0);
  (JSON.parse(plansFile.text) as { projects: V3Project[] }).projects.forEach((p, i) => {
    add(`plans file ${i}`, normalizeLayout(before[i]!.data), imported[i]!.plan, p.name);
  });
  const [bareBefore] = v3Import(bareFile.text, 0);
  const [bare] = parseProjectsImport(bareFile.text, 0);
  add(
    'bare layout file',
    normalizeLayout(bareBefore!.data),
    bare!.plan,
    (JSON.parse(bareFile.text) as { name: string }).name,
  );

  // Guide examples: written as plans.
  for (const e of EXAMPLES) {
    cases.push({
      name: `example ${e.id}`,
      unitSystem: e.unitSystem,
      title: e.name,
      plan: e.plan,
    });
  }
  return cases;
}
