/**
 * "Needs a newer Room Planner" (docs/design/plan-format.md, section 4): a plan this build cannot
 * open is never loaded and never written over; the user is told to update instead. Decided from
 * the document's shape alone (core/version.ts), so the schema does not load with the app.
 */
import { detectVersion } from '../core/version';

/**
 * The newest plan format this build can open. The app still holds v3 layouts; PR 5 moves it to
 * v4 plans and raises this to `PLAN_VERSION`.
 */
export const APP_PLAN_VERSION = 3;

export const NEWER_PLAN_MESSAGE =
  'This plan was made with a newer version of Room Planner. Update the app to open it.';

/** The version of a document too new for this build, or null when it is not too new. */
export const newerPlanVersion = (data: unknown): number | null => {
  const v = detectVersion(data);
  return v !== null && v > APP_PLAN_VERSION ? v : null;
};

/** Thrown by imports that met a plan this build cannot open. */
export class NewerPlanError extends Error {
  constructor(readonly version: number) {
    super(NEWER_PLAN_MESSAGE);
    this.name = 'NewerPlanError';
  }
}
