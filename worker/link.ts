/**
 * Edit links made by the MCP server (docs/design/plan-format.md, section 7, "Edit links").
 *
 * A link is the compact v4 form (`#s=`), the same the app writes. `editablePlan` (src/lib/plans.ts)
 * is the app's own answer to "how do I open this?": it accepts every valid plan and turns each
 * room to start at its top-left corner and the floor to start at the origin, which changes no
 * drawing. The server asks it, so a link always opens as the editor would store it.
 */
import type { Plan } from '../src/core/schema';
import { buildPlanUrl } from '../src/core/share/plan';
import { editablePlan } from '../src/lib/plans';

/** The edit link for a plan (in feet) on `origin`. */
export async function planLink(plan: Plan, origin: string): Promise<string> {
  const editable = editablePlan(plan);
  // Unreachable for a plan that passed the schema (at least one room, three corners each).
  if (!editable.ok)
    throw new Error(`editablePlan refused a valid plan: ${editable.why.join(', ')}`);
  return buildPlanUrl(new URL('/', origin).toString(), editable.plan, { compress: true });
}
