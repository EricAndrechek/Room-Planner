/**
 * Start-up state resolution: storage (migrated on the first boot) -> persisted state -> shared
 * link (if the URL carries one). Kept free of React so it can be unit tested.
 */
import { loadPlan } from '../core/load';
import { readSharePayload, stripShareLink, type LinkSource } from '../core/share/link';
import { detectVersion } from '../core/version';
import type { Plan, Project, SaveStatus } from '../types';
import { newerPlanVersion } from './planVersion';
import { editablePlan, withDoc } from './plans';
import { SHARED_PROJECT_NAME, createProject, findDuplicateProject, findProject } from './projects';
import { inSync, type PersistedState, type PlanStore } from './storage';

export interface BootState extends PersistedState {
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
}

export interface SharedBootInfo {
  legacy: boolean;
  /** What kind of link it was: a share link, `?config=`, or a hand-written `#plan=`. */
  source: LinkSource;
  /** A new project was created for the link (false: an identical one already existed). */
  createdProject: boolean;
  /** The current URL with the share payload removed. */
  cleanUrl: string;
}

/**
 * A plan that was not opened: a share link made by a newer Room Planner (the URL is left as it
 * is, so it opens after an update) or holding what this build's editor cannot show yet, a damaged
 * link (cut off or mangled when it was copied), or the working plan in storage, saved by a newer
 * Room Planner. Either way nothing was written over.
 */
export type LinkProblem =
  | { kind: 'newer'; version: number; where?: 'link' | 'storage' }
  | { kind: 'unsupported'; where?: 'link' | 'storage' }
  | { kind: 'damaged' };

export interface BootResult {
  state: BootState;
  shared: SharedBootInfo | null;
  linkProblem?: LinkProblem;
}

/** Load (and on the first boot, migrate) everything from storage. */
export const bootFromStorage = (store: PlanStore, now: Date = new Date()): BootState => {
  const persisted = store.load(now);
  const current = findProject(persisted.projects, persisted.currentProjectId);
  if (!current) {
    // Unknown id (e.g. the project was deleted in another tab): start a new plan
    // instead of silently autosaving into nothing.
    return { ...persisted, currentProjectId: null, saveStatus: 'unsaved', lastSavedAt: null };
  }
  return {
    ...persisted,
    saveStatus: inSync(persisted) ? 'saved' : 'unsaved',
    lastSavedAt: current.updatedAt ? new Date(current.updatedAt) : null,
  };
};

/** The working-plan problem the planner starts with, if any. */
export const storageProblem = (state: BootState): LinkProblem | undefined =>
  state.workingLocked
    ? state.workingLocked.reason === 'newer'
      ? { kind: 'newer', version: state.workingLocked.version, where: 'storage' }
      : { kind: 'unsupported', where: 'storage' }
    : undefined;

/** Whether a shared document carries a name of its own (the sharer's plan name). */
const hasName = (data: unknown): boolean => {
  const raw = Array.isArray(data)
    ? (data as unknown[])[1]
    : (data as Record<string, unknown> | null)?.name;
  return typeof raw === 'string' && raw !== '';
};

/**
 * Open a shared plan: it becomes the working plan, saved as its own project (named after the
 * sharer's plan) unless an identical project already exists, in which case that one is reopened.
 * Writes through to storage. The display units stay this device's.
 */
export const applySharedLink = (
  state: BootState,
  link: { plan: Plan; name: string },
  store: PlanStore,
  now: Date = new Date(),
): { state: BootState; createdProject: boolean } => {
  const duplicate = findDuplicateProject(state.projects, link.plan);

  let projects: Project[] = state.projects;
  let locked = state.locked;
  let project: Project;
  if (duplicate) {
    project = duplicate;
  } else {
    project = createProject(link.name, withDoc(link.plan, link.name, state.unitSystem), now);
    ({ projects, locked } = store.savePlans([...projects, project]));
  }
  const plan = withDoc(project.plan, project.plan.name, state.unitSystem);
  store.saveUi({ currentPlanId: project.id, designMode: state.designMode });
  store.saveWorking(plan);

  return {
    state: {
      ...state,
      plan,
      projects,
      locked,
      currentProjectId: project.id,
      saveStatus: 'saved',
      lastSavedAt: duplicate ? new Date(duplicate.updatedAt) : now,
    },
    createdProject: !duplicate,
  };
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A document from a link or the JSON box, read for the editor: `ok` with the plan, or why not.
 * Before the plan format a document was only accepted with a room size and a list of pieces.
 */
export function readSharedPlan(
  data: unknown,
):
  | { ok: true; plan: Plan; name: string; named: boolean }
  | { ok: false; problem: 'newer'; version: number }
  | { ok: false; problem: 'unsupported' | 'invalid' } {
  const newer = newerPlanVersion(data);
  if (newer !== null) return { ok: false, problem: 'newer', version: newer };
  const v = detectVersion(data);
  if (v !== null && v < 4 && !(isObject(data) && Array.isArray(data.items))) {
    return { ok: false, problem: 'invalid' };
  }
  const r = loadPlan(data, 'lenient');
  if (!r.ok) {
    return r.reason === 'newer'
      ? { ok: false, problem: 'newer', version: r.version }
      : { ok: false, problem: 'invalid' };
  }
  const e = editablePlan(r.plan);
  if (!e.ok) return { ok: false, problem: 'unsupported' };
  const named = hasName(data);
  return { ok: true, plan: e.plan, name: named ? e.plan.name : SHARED_PROJECT_NAME, named };
}

/**
 * Full start-up: storage, then any share link in `href`. A link too new for this build (or holding
 * what it cannot show), or one that cannot be decoded, is reported in `linkProblem` and changes
 * nothing.
 */
export const boot = async (
  href: string,
  store: PlanStore,
  now: Date = new Date(),
): Promise<BootResult> => {
  const state = bootFromStorage(store, now);
  const fromStorage = storageProblem(state);
  const payload = await readSharePayload(href);
  if (payload.status === 'none' || payload.status === 'unsupported') {
    return { state, shared: null, linkProblem: fromStorage };
  }
  if (payload.status === 'damaged') {
    return { state, shared: null, linkProblem: { kind: 'damaged' } };
  }
  const read = readSharedPlan(payload.data);
  if (!read.ok) {
    const linkProblem: LinkProblem =
      read.problem === 'newer'
        ? { kind: 'newer', version: read.version, where: 'link' }
        : read.problem === 'unsupported'
          ? { kind: 'unsupported', where: 'link' }
          : { kind: 'damaged' };
    return { state, shared: null, linkProblem };
  }
  const applied = applySharedLink(state, read, store, now);
  return {
    state: applied.state,
    shared: {
      legacy: payload.legacy,
      source: payload.source ?? (payload.legacy ? 'legacy' : 'share'),
      createdProject: applied.createdProject,
      cleanUrl: stripShareLink(href),
    },
    linkProblem: fromStorage,
  };
};
