import { describe, expect, it } from 'vitest';
import { checkLayout } from '../src/core/check';
import { loadPlan } from '../src/core/load';
import { SHOWCASE_PLANS } from './showcase';

describe('the showcase plans for the directory listings', () => {
  for (const [name, input] of SHOWCASE_PLANS) {
    it(`${name} loads, with no errors and no warnings`, () => {
      const r = loadPlan(input, 'strict');
      if (!r.ok) throw new Error(JSON.stringify(r));
      const issues = checkLayout(r.plan);
      expect(issues.filter((i) => i.severity !== 'info').map((i) => i.message)).toEqual([]);
    });
  }
});
