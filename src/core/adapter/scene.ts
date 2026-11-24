/**
 * The export for a v3 layout: the plan scene of `planFromLayout(layout)`. Apart from index.ts so
 * that the planner, which imports the checks, does not pull the scene into its own chunk. PR 5
 * removes it with the rest of the adapter.
 */
import { buildPlanScene, type Scene } from '../render/scene';
import { sceneToSvg } from '../render/svg';
import type { Layout, UnitSystem } from '../types';
import { planFromLayout } from './index';

export interface PlanInput {
  layout: Layout;
  unitSystem: UnitSystem;
  /** Project name, used as the plan title. */
  title: string;
  /** Date printed in the footer (defaults to now). */
  date?: Date;
  /** Locale for the footer date (defaults to the runtime's). */
  locale?: string;
  /** Footer attribution. */
  site?: string;
}

/** The printable floor plan scene for a v3 layout. */
export const buildLayoutScene = ({ layout, ...rest }: PlanInput): Scene =>
  buildPlanScene({ ...rest, plan: planFromLayout(layout) });

/** The standalone SVG of a v3 layout's floor plan. */
export const planSvg = (input: PlanInput): string => sceneToSvg(buildLayoutScene(input));
