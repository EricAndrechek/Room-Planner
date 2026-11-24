/**
 * Edit links made by the MCP server (docs/design/plan-format.md, section 7, "Edit links").
 *
 * A link is the compact v4 form (`#s=`), the same the app writes. The server accepts every plan
 * the format allows, but the editor does not open all of them yet: `editablePlan` (src/lib/
 * plans.ts) is the app's own answer to "can I open this?", so the server asks it and never hands
 * out a link the app would refuse. It also turns a rectangle that starts at another corner, or
 * sits away from the origin, into the editor's form, which changes no drawing. PRs 7a, 7b, 8 and
 * 9 loosen `editablePlan`, and links appear for those plans with no change here.
 */
import type { Plan } from '../src/core/schema';
import { buildPlanUrl } from '../src/core/share/plan';
import { editablePlan } from '../src/lib/plans';

export type PlanLink = { url: string } | { url: null; blockers: string[] };

/** The edit link for a plan (in feet) on `origin`, or what keeps the editor from opening it. */
export async function planLink(plan: Plan, origin: string): Promise<PlanLink> {
  const editable = editablePlan(plan);
  if (!editable.ok) return { url: null, blockers: editable.why };
  return {
    url: await buildPlanUrl(new URL('/', origin).toString(), editable.plan, { compress: true }),
  };
}
