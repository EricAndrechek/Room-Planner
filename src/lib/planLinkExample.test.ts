import { describe, expect, it } from 'vitest';
import { checkLayout } from '../core/check';
import { readSharePayload } from '../core/share/link';
import { readSharedPlan } from './boot';
import { PLAN_LINK_EXAMPLE, planLinkExample } from './site';

describe('the plan link example', () => {
  it('opens as the plan it shows, with nothing worse than a tight gap', async () => {
    const payload = await readSharePayload(planLinkExample('https://room-planner.andrechek.com'));
    expect(payload.status).toBe('ok');
    const read = payload.status === 'ok' ? readSharedPlan(payload.data) : null;
    if (!read?.ok) throw new Error('the example does not open');
    expect(read.name).toBe(PLAN_LINK_EXAMPLE.name);
    expect(read.plan.items.map((i) => i.label)).toEqual(
      PLAN_LINK_EXAMPLE.items.map((i) => i.label),
    );
    expect(checkLayout(read.plan).filter((i) => i.severity !== 'info')).toEqual([]);
  });
});
