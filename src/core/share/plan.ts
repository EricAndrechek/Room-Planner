/**
 * Plans in share links: a plan is written in the compact form and read back through `loadPlan`,
 * like every other input. Kept apart from link.ts, which the app imports today, so the schema
 * stays out of the app until the app holds plans.
 */
import { loadPlan, type LoadResult } from '../load';
import type { Plan } from '../schema';
import { compact } from './compact';
import { buildShareUrl, encodeShareFragment, readSharePayload } from './link';

/** The fragment for a plan, e.g. `s=...` (no leading `#`). */
export const encodePlanFragment = (plan: Plan, options?: { compress?: boolean }): Promise<string> =>
  encodeShareFragment(compact(plan), options);

/** A share URL for `plan` on top of `baseHref`. */
export const buildPlanUrl = (
  baseHref: string,
  plan: Plan,
  options?: { compress?: boolean },
): Promise<string> => buildShareUrl(baseHref, compact(plan), options);

/**
 * The plan in a link of any format and version (`#s=`, `#j=`, `?config=`), loaded leniently.
 * `none` when the URL carries no link, `damaged` when it cannot be decoded.
 */
export async function readPlanLink(
  href: string,
): Promise<LoadResult | { ok: false; reason: 'none' | 'damaged' }> {
  const payload = await readSharePayload(href);
  if (payload.status === 'ok') return loadPlan(payload.data, 'lenient');
  return { ok: false, reason: payload.status === 'damaged' ? 'damaged' : 'none' };
}
