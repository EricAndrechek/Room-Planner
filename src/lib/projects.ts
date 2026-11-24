/** Pure operations on the saved plans ("My Floor Plans") and their export files. */
import { loadPlan } from '../core/load';
import type { DesignMode, Plan, Project } from '../types';
import { isDesignMode } from './constants';
import { NewerPlanError, UNSUPPORTED_PLAN_MESSAGE, newerPlanVersion } from './planVersion';
import { editablePlan, samePlan } from './plans';

export const generateProjectId = (
  now: number = Date.now(),
  random: () => number = Math.random,
): string => `project-${now}-${random().toString(36).substring(2, 11)}`;

/** Name given to a plan that was auto-saved before the user named it. */
export const defaultProjectName = (date: Date = new Date()): string =>
  `Floor Plan - ${date.toLocaleDateString()}`;

export const SHARED_PROJECT_NAME = 'Shared Floor Plan';

export const projectName = (project: Project): string => project.plan.name;

export const createProject = (
  name: string,
  plan: Plan,
  now: Date = new Date(),
  designMode?: DesignMode,
): Project => {
  const iso = now.toISOString();
  return {
    id: generateProjectId(now.getTime()),
    createdAt: iso,
    updatedAt: iso,
    ui: designMode ? { designMode } : {},
    plan: { ...plan, name },
  };
};

export const findProject = (projects: Project[], id: string | null): Project | undefined =>
  id ? projects.find((p) => p.id === id) : undefined;

/** The saved plan `id` with a new plan (its name is kept) and editor state. */
export const updateProjectPlan = (
  projects: Project[],
  id: string,
  plan: Plan,
  designMode: DesignMode,
  now: Date = new Date(),
): Project[] =>
  projects.map((p) =>
    p.id === id
      ? {
          ...p,
          plan: { ...plan, name: p.plan.name },
          ui: { ...p.ui, designMode },
          updatedAt: now.toISOString(),
        }
      : p,
  );

export const renameProject = (
  projects: Project[],
  id: string,
  name: string,
  now: Date = new Date(),
): Project[] =>
  projects.map((p) =>
    p.id === id ? { ...p, plan: { ...p.plan, name }, updatedAt: now.toISOString() } : p,
  );

export const duplicateProject = (project: Project, now: Date = new Date()): Project => ({
  ...createProject(`${project.plan.name} (Copy)`, structuredClone(project.plan), now),
  ui: { ...project.ui },
});

export const deleteProjects = (projects: Project[], ids: string[]): Project[] =>
  projects.filter((p) => !ids.includes(p.id));

/**
 * A saved plan that draws the same as `plan` - so that opening the same share link again does
 * not pile up copies.
 */
export const findDuplicateProject = (projects: Project[], plan: Plan): Project | undefined =>
  projects.find((p) => samePlan(p.plan, plan));

// --- Export / import files ----------------------------------------------------------

/**
 * The plans file. Since the plan format, `data` is a version 4 plan in feet (named, with its
 * display units) and `ui` the editor state; the container is the one every version has written,
 * so a build from before the plan format reports "needs a newer version" instead of misreading.
 */
export interface ProjectsExportFile {
  version: 1;
  exportedAt: string;
  projects: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    ui?: Project['ui'];
    data: Plan;
  }[];
}

export const buildExportFile = (
  projects: Project[],
  now: Date = new Date(),
): ProjectsExportFile => ({
  version: 1,
  exportedAt: now.toISOString(),
  projects: projects.map((p) => ({
    id: p.id,
    name: p.plan.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    ui: p.ui,
    data: p.plan,
  })),
});

export const exportFileName = (projects: Project[], now: Date = new Date()): string =>
  projects.length === 1
    ? `${projects[0]!.plan.name.replace(/[^a-z0-9]/gi, '_')}.json`
    : `floor_plans_export_${now.toISOString().split('T')[0]}.json`;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parse a plans file (or a bare plan) into new saved plans with fresh ids. Lengths of a plan from
 * before the plan format are feet (as that app always wrote them). Throws on anything
 * unrecognizable, and a `NewerPlanError` for a plan this build cannot open (the whole file is
 * refused).
 */
export const parseProjectsImport = (
  text: string,
  existingCount: number,
  now: Date = new Date(),
): Project[] => {
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed)) throw new Error('Invalid format');
  const iso = now.toISOString();

  let incoming: { name?: unknown; data: unknown; createdAt?: unknown; ui?: unknown }[];
  if (Array.isArray(parsed.projects)) {
    incoming = parsed.projects
      .filter(isObject)
      .map((p) => ({ name: p.name, data: p.data, createdAt: p.createdAt, ui: p.ui }));
  } else if ((isObject(parsed.roomDims) && Array.isArray(parsed.items)) || 'version' in parsed) {
    incoming = [{ name: `Imported Plan ${existingCount + 1}`, data: parsed, createdAt: iso }];
  } else {
    throw new Error('Invalid format');
  }

  // A plan, or a plans file holding one, that this build cannot open: refuse the whole file.
  for (const p of incoming) {
    const newer = newerPlanVersion(p.data);
    if (newer !== null) throw new NewerPlanError(newer);
  }

  const out: Project[] = [];
  incoming.forEach((p, i) => {
    if (!isObject(p.data)) return;
    // The v3 app read a plan without a usable room size as the starter room's size.
    const data =
      'version' in p.data || isObject(p.data.roomDims) ? p.data : { ...p.data, roomDims: {} };
    const r = loadPlan(data, 'lenient', { lengthsInFeet: true });
    if (!r.ok) return;
    const e = editablePlan(r.plan);
    if (!e.ok) throw new NewerPlanError(r.from, UNSUPPORTED_PLAN_MESSAGE);
    const name =
      typeof p.name === 'string' && p.name
        ? p.name
        : typeof data.name === 'string' && data.name
          ? data.name
          : 'Imported Plan';
    const ui = isObject(p.ui) ? p.ui : {};
    const mode = isDesignMode(ui.designMode)
      ? ui.designMode
      : isDesignMode(data.designMode)
        ? data.designMode
        : undefined;
    out.push({
      id: generateProjectId(now.getTime() + i),
      createdAt: typeof p.createdAt === 'string' && p.createdAt ? p.createdAt : iso,
      updatedAt: iso,
      ui: mode ? { designMode: mode } : {},
      plan: { ...e.plan, name },
    });
  });
  if (out.length === 0 && incoming.length > 0) throw new Error('Invalid format');
  return out;
};
