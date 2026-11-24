/**
 * Golden tests (docs/design/plan-format.md, section 10, PR 3): the export and the warnings are
 * exactly what `main` produced before core took plans, for every fixture and guide example.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import golden from './__fixtures__/golden-main.json';
import { computeLayoutWarnings } from './openings';
import { planSvg } from './render/svg';
import { goldenCases } from './testing/cases';

const DATE = new Date('2026-01-01T12:00:00Z');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const cases = await goldenCases();
const want = golden.cases as Record<string, { svg: string; bytes: number; warnings: unknown }>;

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
  }
});
