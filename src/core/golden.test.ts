/**
 * Golden tests (docs/design/plan-format.md, section 10, PR 3): the export and the warnings are
 * exactly what `main` produced before core took plans, for every fixture and guide example.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import golden from './__fixtures__/golden-main.json';
import { computeLayoutWarnings } from './adapter';
import { planSvg } from './adapter/scene';
import { checkLayout } from './check';
import type { ItemWarning } from './geometry';
import { planSvg as planSceneSvg } from './render/svg';
import type { Plan } from './schema';
import type { Layout } from './types';
import { goldenCases } from './testing/cases';

const DATE = new Date('2026-01-01T12:00:00Z');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const cases = await goldenCases();
const want = golden.cases as Record<string, { svg: string; bytes: number; warnings: unknown }>;

/**
 * The canvas's warnings from a plan's issues, keyed by the v3 ids (pieces and doors are in the
 * same order in the plan as in the layout).
 */
const planWarnings = (plan: Plan, layout: Layout) => {
  const index = new Map(plan.items.map((it, i) => [it.id, i]));
  const doors = plan.rooms[0]!.openings.filter((o) => o.kind === 'door');
  const warnings = new Map<string, ItemWarning>();
  const visible = layout.items.flatMap((it, i) => (it.visible === false ? [] : [[it, i] as const]));
  const issues = checkLayout(plan);
  for (const [it, i] of visible) {
    const mine = issues.filter((x) => index.get(x.ids[0]!) === i);
    const w: ItemWarning = {
      outOfBounds: mine.some((x) => x.code === 'item_outside_room'),
      collision: issues.some(
        (x) => x.code === 'item_overlap' && x.ids.some((id) => index.get(id) === i),
      ),
    };
    const blocks = mine.filter((x) => x.code === 'door_blocked' || x.code === 'doorway_blocked');
    if (blocks.length) {
      w.blocksDoor = blocks.some((x) => x.code === 'door_blocked');
      w.blocksDoorway = blocks.some((x) => x.code === 'doorway_blocked');
      w.doorIds = blocks.map((x) => layout.doors[doors.findIndex((d) => d.id === x.ids[1])]!.id);
    }
    warnings.set(String(it.id), w);
  }
  return [...warnings];
};

describe('golden output of main', () => {
  it('covers every case', () => {
    expect(cases.map((c) => c.name).sort()).toEqual(Object.keys(want).sort());
  });

  for (const c of cases) {
    it(`${c.name}: v3 layout`, () => {
      const svg = planSvg({
        layout: c.layout,
        unitSystem: c.unitSystem,
        title: c.title,
        date: DATE,
        locale: 'en-US',
      });
      expect({ bytes: svg.length, svg: sha(svg) }).toEqual({
        bytes: want[c.name]!.bytes,
        svg: want[c.name]!.svg,
      });
      const warnings = [...computeLayoutWarnings(c.layout)].map(([id, w]) => [String(id), w]);
      expect(warnings).toEqual(want[c.name]!.warnings);
    });

    it(`${c.name}: the plan loadPlan reads from it`, () => {
      const svg = planSceneSvg({
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
      expect(planWarnings(c.plan, c.layout)).toEqual(want[c.name]!.warnings);
    });
  }
});
