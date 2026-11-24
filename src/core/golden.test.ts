/**
 * Golden tests (docs/design/plan-format.md, section 10, PRs 3 and 5): the export and the warnings
 * are exactly what `main` produced before core took plans, for every fixture and guide example,
 * now that the app reads each of them as a plan (testing/cases.ts) and draws and checks it.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import golden from './__fixtures__/golden-main.json';
import type { ItemWarning } from './geometry';
import { planSvg } from './render/svg';
import type { Plan } from './schema';
import { goldenCases } from './testing/cases';
import type { Layout } from './testing/v3/types';
import { itemWarnings } from '../lib/plans';

const DATE = new Date('2026-01-01T12:00:00Z');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const cases = await goldenCases();
const want = golden.cases as unknown as Record<
  string,
  { svg: string; bytes: number; warnings: [string, ItemWarning][] }
>;

/**
 * The canvas's warnings (`itemWarnings`, as the planner computes them) in piece order, with the
 * doors they block as v3 door ids when the v3 layout is known (pieces and doors are in the same
 * order in the plan as in the layout), as the v3 app listed them.
 */
const planWarnings = (plan: Plan, layout: Layout | undefined) => {
  const warnings = itemWarnings(plan);
  const doors = plan.rooms[0]!.openings.filter((o) => o.kind === 'door');
  return plan.items.flatMap((it) => {
    const w = warnings.get(it.id);
    if (!w) return [];
    const out = { ...w } as Omit<ItemWarning, 'doorIds'> & { doorIds?: (string | number)[] };
    if (out.doorIds) {
      out.doorIds = out.doorIds.map((id) => {
        const i = doors.findIndex((d) => d.id === id);
        return layout ? layout.doors[i]!.id : i;
      });
    }
    return [out];
  });
};

describe('golden output of main', () => {
  it('covers every case', () => {
    expect(cases.map((c) => c.name).sort()).toEqual(Object.keys(want).sort());
  });

  for (const c of cases) {
    it(`${c.name}: the plan the app reads from it`, () => {
      const svg = planSvg({
        plan: c.plan,
        unitSystem: c.unitSystem,
        title: c.title,
        date: DATE,
        locale: 'en-US',
      });
      expect({ bytes: svg.length, svg: sha(svg) }).toEqual({
        bytes: want[c.name]!.bytes,
        svg: want[c.name]!.svg,
      });
      expect(planWarnings(c.plan, c.layout)).toEqual(want[c.name]!.warnings.map(([, w]) => w));
    });
  }
});
