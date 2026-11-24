/**
 * "Needs a newer Room Planner" (docs/design/plan-format.md, section 4): a plan this build cannot
 * open is never loaded and never written over; the user is told to update instead. The version is
 * decided from the document's shape alone (core/version.ts), so this file needs no schema.
 */
import { detectVersion } from '../core/version';

/**
 * The newest plan format this build can open: `PLAN_VERSION` of core/schema.ts (a test keeps the
 * two equal; the number is written out so that this file does not load the schema).
 */
export const APP_PLAN_VERSION = 4;

export const NEWER_PLAN_MESSAGE =
  'This plan was made with a newer version of Room Planner. Update the app to open it.';

export const UNSUPPORTED_PLAN_MESSAGE =
  'This plan uses something this version of Room Planner cannot show yet. Update the app to open it.';

/** The version of a document too new for this build, or null when it is not too new. */
export const newerPlanVersion = (data: unknown): number | null => {
  const v = detectVersion(data);
  return v !== null && v > APP_PLAN_VERSION ? v : null;
};

/** Thrown by imports that met a plan this build cannot open. */
export class NewerPlanError extends Error {
  constructor(
    readonly version: number,
    message = NEWER_PLAN_MESSAGE,
  ) {
    super(message);
    this.name = 'NewerPlanError';
  }
}
