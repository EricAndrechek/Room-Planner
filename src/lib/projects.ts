/** Pure operations on the saved-projects list ("My Floor Plans"). */
import type { Layout, Project, ProjectData } from '../types';
import { layoutsEqual, normalizeLayout } from './layout';

export const generateProjectId = (now: number = Date.now(), random: () => number = Math.random): string =>
  `project-${now}-${random().toString(36).substring(2, 11)}`;

/** Name given to a plan that was auto-saved before the user named it. */
export const defaultProjectName = (date: Date = new Date()): string =>
  `Floor Plan - ${date.toLocaleDateString()}`;

export const SHARED_PROJECT_NAME = 'Shared Floor Plan';

export const createProject = (name: string, data: ProjectData, now: Date = new Date()): Project => {
  const iso = now.toISOString();
  return { id: generateProjectId(now.getTime()), name, data, createdAt: iso, updatedAt: iso };
};

export const findProject = (projects: Project[], id: string | null): Project | undefined =>
  id ? projects.find((p) => p.id === id) : undefined;

export const updateProjectData = (
  projects: Project[],
  id: string,
  data: ProjectData,
  now: Date = new Date(),
): Project[] =>
  projects.map((p) => (p.id === id ? { ...p, data, updatedAt: now.toISOString() } : p));

export const renameProject = (
  projects: Project[],
  id: string,
  name: string,
  now: Date = new Date(),
): Project[] =>
  projects.map((p) => (p.id === id ? { ...p, name, updatedAt: now.toISOString() } : p));

export const duplicateProject = (project: Project, now: Date = new Date()): Project =>
  createProject(`${project.name} (Copy)`, structuredClone(project.data), now);

export const deleteProjects = (projects: Project[], ids: string[]): Project[] =>
  projects.filter((p) => !ids.includes(p.id));

/**
 * An existing project whose layout is identical to `layout` - used so that
 * re-opening the same share link doesn't pile up duplicate plans.
 */
export const findDuplicateProject = (projects: Project[], layout: Layout): Project | undefined =>
  projects.find((p) => p.data && layoutsEqual(normalizeLayout(p.data), layout));

// --- Export / import files ----------------------------------------------------------

export interface ProjectsExportFile {
  version: 1;
  exportedAt: string;
  projects: Project[];
}

export const buildExportFile = (projects: Project[], now: Date = new Date()): ProjectsExportFile => ({
  version: 1,
  exportedAt: now.toISOString(),
  projects,
});

export const exportFileName = (projects: Project[], now: Date = new Date()): string =>
  projects.length === 1
    ? `${projects[0]!.name.replace(/[^a-z0-9]/gi, '_')}.json`
    : `floor_plans_export_${now.toISOString().split('T')[0]}.json`;

/**
 * Parse an exported projects file (or a bare single-layout config) into new
 * projects with fresh ids. Throws on anything unrecognizable.
 */
export const parseProjectsImport = (
  text: string,
  existingCount: number,
  now: Date = new Date(),
): Project[] => {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Invalid format');
  const obj = parsed as Record<string, unknown>;
  const iso = now.toISOString();

  let incoming: Partial<Project>[];
  if (Array.isArray(obj.projects)) {
    incoming = obj.projects.filter(
      (p): p is Partial<Project> => typeof p === 'object' && p !== null,
    );
  } else if (obj.roomDims && obj.items) {
    incoming = [
      {
        name: `Imported Plan ${existingCount + 1}`,
        data: parsed as ProjectData,
        createdAt: iso,
      },
    ];
  } else {
    throw new Error('Invalid format');
  }

  return incoming.map((p, i) => ({
    ...p,
    id: generateProjectId(now.getTime() + i),
    name: p.name || 'Imported Plan',
    data: { ...(p.data ?? {}), ...normalizeLayout(p.data) } as ProjectData,
    createdAt: p.createdAt || iso,
    updatedAt: iso,
  }));
};
