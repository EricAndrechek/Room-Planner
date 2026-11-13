/**
 * Start-up state resolution: storage migration -> persisted state -> shared
 * link (if the URL carries one). Kept free of React so it can be unit tested.
 */
import type { Project, SaveStatus } from '../types';
import { fromShareConfig, layoutsEqual, normalizeLayout } from './layout';
import {
  SHARED_PROJECT_NAME,
  createProject,
  findDuplicateProject,
  findProject,
} from './projects';
import { readShareLink, stripShareLink, type SharedLayoutLink } from './share';
import {
  loadPersistedState,
  migrateStorage,
  saveCurrentProjectId,
  saveLayout,
  saveProjects,
  type PersistedState,
  type StorageLike,
} from './storage';

export interface BootState extends PersistedState {
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
}

export interface SharedBootInfo {
  legacy: boolean;
  /** A new project was created for the link (false: an identical one already existed). */
  createdProject: boolean;
  /** The current URL with the share payload removed. */
  cleanUrl: string;
}

export interface BootResult {
  state: BootState;
  shared: SharedBootInfo | null;
}

/** Load (and migrate) everything from storage. */
export const bootFromStorage = (storage: StorageLike): BootState => {
  migrateStorage(storage);
  const persisted = loadPersistedState(storage);
  const current = findProject(persisted.projects, persisted.currentProjectId);
  if (!current) {
    // Unknown id (e.g. the project was deleted in another tab): start a new plan
    // instead of silently autosaving into nothing.
    return { ...persisted, currentProjectId: null, saveStatus: 'unsaved', lastSavedAt: null };
  }
  const inSync = layoutsEqual(normalizeLayout(current.data), persisted.layout);
  return {
    ...persisted,
    saveStatus: inSync ? 'saved' : 'unsaved',
    lastSavedAt: current.updatedAt ? new Date(current.updatedAt) : null,
  };
};

/**
 * Open a shared layout: it becomes the working layout, saved as its own
 * project (named after the sharer's plan) unless an identical project already
 * exists, in which case that one is reopened. Writes through to storage.
 */
export const applySharedLink = (
  state: BootState,
  link: SharedLayoutLink,
  storage: StorageLike,
  now: Date = new Date(),
): { state: BootState; createdProject: boolean } => {
  const layout = fromShareConfig(link.config);
  const duplicate = findDuplicateProject(state.projects, layout);

  let projects: Project[] = state.projects;
  let project: Project;
  if (duplicate) {
    project = duplicate;
  } else {
    const name =
      typeof link.config.name === 'string' && link.config.name ? link.config.name : SHARED_PROJECT_NAME;
    project = createProject(name, layout, now);
    projects = [...projects, project];
    saveProjects(storage, projects);
  }
  saveCurrentProjectId(storage, project.id);
  saveLayout(storage, layout);

  return {
    state: {
      ...state,
      layout,
      projects,
      currentProjectId: project.id,
      saveStatus: 'saved',
      lastSavedAt: duplicate ? new Date(duplicate.updatedAt) : now,
    },
    createdProject: !duplicate,
  };
};

/** Full start-up: storage, then any share link in `href`. */
export const boot = async (href: string, storage: StorageLike, now: Date = new Date()): Promise<BootResult> => {
  const state = bootFromStorage(storage);
  const link = await readShareLink(href);
  if (!link) return { state, shared: null };
  const applied = applySharedLink(state, link, storage, now);
  return {
    state: applied.state,
    shared: { legacy: link.legacy, createdProject: applied.createdProject, cleanUrl: stripShareLink(href) },
  };
};
