/**
 * Test helper: every fixture and guide example as the pair the golden tests compare, the v3 layout
 * today's reader makes of it and the v4 plan `loadPlan` makes of it, with the title and units the
 * drawing uses.
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
import { fromShareConfig, normalizeLayout, type ShareConfig } from '../layout';
import { loadPlan, type LoadResult } from '../load';
import type { Plan } from '../schema';
import { readShareLink } from '../share/link';
import { readPlanLink } from '../share/plan';
import type { Layout, UnitSystem } from '../types';
import { EXAMPLES } from '../../lib/guides/examples';
import { createMemoryStorage, loadPersistedState, migrateStorage } from '../../lib/storage';
import { parseProjectsImport } from '../../lib/projects';
import type { Project } from '../../types';

export interface GoldenCase {
  name: string;
  /** Today's (v3) reading. */
  layout: Layout;
  unitSystem: UnitSystem;
  title: string;
  /** The same input through loadPlan. */
  plan: Plan;
}

const ok = (r: LoadResult | { ok: false }): Plan => {
  if (!r.ok) throw new Error(`not loaded: ${JSON.stringify(r)}`);
  return r.plan;
};
const json = (s: string | undefined) => (s === undefined ? undefined : (JSON.parse(s) as unknown));
const units = (p: Plan): UnitSystem => p.settings?.unitSystem ?? 'ft-in';

export async function goldenCases(): Promise<GoldenCase[]> {
  const cases: GoldenCase[] = [];
  const add = (name: string, layout: Layout, plan: Plan) =>
    cases.push({ name, layout, plan, unitSystem: units(plan), title: plan.name });

  // Storage: the working plan and every saved plan.
  for (const [name, fixture] of [
    ['v2-storage', v2Storage],
    ['early-v3-storage', earlyStorage],
    ['original-storage', originalStorage],
    ['doors-storage', doorsStorage],
  ] as const) {
    const ls = fixture.localStorage as Record<string, string>;
    const s = createMemoryStorage(ls);
    migrateStorage(s);
    const state = loadPersistedState(s);
    const doc =
      name === 'v2-storage'
        ? {
            roomDims: json(ls['room-sim-v2-dims']),
            door: json(ls['room-sim-v2-door']),
            items: json(ls['room-sim-v2-items']),
            windows: [],
            unitSystem: state.unitSystem,
          }
        : {
            roomDims: json(ls['room-sim-v3-dims']),
            doors: json(ls['room-sim-v3-doors']),
            windows: json(ls['room-sim-v3-windows']),
            items: json(ls['room-sim-v3-items']),
            unitSystem: state.unitSystem,
          };
    add(`${name} working`, state.layout, ok(loadPlan(doc, 'lenient', { lengthsInFeet: true })));
    state.projects.forEach((p, i) => {
      const plan = ok(
        loadPlan({ ...(p.data as object), name: p.name }, 'lenient', { lengthsInFeet: true }),
      );
      add(`${name} project ${i}`, normalizeLayout(p.data), plan);
    });
  }

  // Links and the JSON box.
  for (const [name, url] of [
    ['v2 ?config=', v2Link.url],
    ['early v3 ?config=', earlyLink.url],
    ['original ?config= ft-in', originalLinks.ftIn.url],
    ['original ?config= m', originalLinks.meters.url],
    ['#s= cm', fragmentLinks.deflate],
    ['#j= cm', fragmentLinks.plain],
  ] as const) {
    const today = await readShareLink(url);
    add(`link ${name}`, fromShareConfig(today!.config), ok(await readPlanLink(url)));
  }
  for (const [name, config] of [
    ['v2', v2Link.json],
    ['early v3', earlyLink.json],
    ['cm', fragmentLinks.json],
  ] as const) {
    add(`json ${name}`, fromShareConfig(config as ShareConfig), ok(loadPlan(config, 'lenient')));
  }

  // Plans files.
  const imported = parseProjectsImport(plansFile.text, 0);
  (JSON.parse(plansFile.text) as { projects: Project[] }).projects.forEach((p, i) => {
    const plan = ok(loadPlan({ ...p.data, name: p.name }, 'lenient', { lengthsInFeet: true }));
    add(`plans file ${i}`, normalizeLayout(imported[i]!.data), plan);
  });
  const [bare] = parseProjectsImport(bareFile.text, 0);
  add(
    'bare layout file',
    normalizeLayout(bare!.data),
    ok(loadPlan(JSON.parse(bareFile.text), 'lenient', { lengthsInFeet: true })),
  );

  // Guide examples: v3 layouts in the source; as plans, what a v3 link of them loads as.
  for (const e of EXAMPLES) {
    const plan = ok(
      loadPlan({ ...e.layout, name: e.name, unitSystem: e.unitSystem }, 'strict', {
        lengthsInFeet: true,
      }),
    );
    cases.push({
      name: `example ${e.id}`,
      layout: e.layout,
      unitSystem: e.unitSystem,
      title: e.name,
      plan,
    });
  }
  return cases;
}
