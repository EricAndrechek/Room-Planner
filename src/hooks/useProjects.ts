import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../lib/analytics';
import { requestPersistentStorageOnce } from '../lib/persist';
import {
  createProject,
  defaultProjectName,
  deleteProjects,
  duplicateProject,
  findProject,
  parseProjectsImport,
  renameProject,
  updateProjectData,
} from '../lib/projects';
import { saveCurrentProjectId, saveProjects, type StorageLike } from '../lib/storage';
import type { DesignMode, Layout, Project, ProjectData, SaveStatus, UnitSystem } from '../types';

export interface WorkingDoc {
  layout: Layout;
  designMode: DesignMode;
  unitSystem: UnitSystem;
}

interface Options {
  storage: StorageLike;
  initialProjects: Project[];
  initialProjectId: string | null;
  initialSaved: boolean;
  initialSavedAt: Date | null;
  /** The document currently being edited. */
  doc: WorkingDoc;
}

const AUTOSAVE_DELAY_MS = 500;

const toProjectData = (doc: WorkingDoc): ProjectData => ({
  ...doc.layout,
  designMode: doc.designMode,
  unitSystem: doc.unitSystem,
});

/**
 * Saved floor plans + autosave of the working document into the current one.
 *
 * "Saved" is derived: the working document is saved when it is (by
 * reference) the snapshot last written. Any edit makes it unsaved and the
 * project is written 500ms after the last change; with no current project a
 * new one is created ("Floor Plan - <date>"), as the original app did.
 */
export function useProjects({
  storage,
  initialProjects,
  initialProjectId,
  initialSaved,
  initialSavedAt,
  doc,
}: Options) {
  const [projects, setProjectsState] = useState(initialProjects);
  const projectsRef = useRef(initialProjects);
  const [currentProjectId, setCurrentProjectId] = useState(initialProjectId);
  const [saved, setSaved] = useState<WorkingDoc | null>(initialSaved ? doc : null);
  const [lastSavedAt, setLastSavedAt] = useState(initialSavedAt);
  const newProjectSource = useRef<string | null>(null);

  const docRef = useRef(doc);
  const currentIdRef = useRef(currentProjectId);
  useEffect(() => {
    docRef.current = doc;
    currentIdRef.current = currentProjectId;
  });

  const commitProjects = useCallback(
    (next: Project[]) => {
      projectsRef.current = next;
      saveProjects(storage, next);
      void requestPersistentStorageOnce();
      setProjectsState(next);
    },
    [storage],
  );

  useEffect(() => {
    saveCurrentProjectId(storage, currentProjectId);
  }, [storage, currentProjectId]);

  const dirty =
    !saved ||
    saved.layout !== doc.layout ||
    saved.designMode !== doc.designMode ||
    saved.unitSystem !== doc.unitSystem;
  const saveStatus: SaveStatus = dirty ? 'unsaved' : 'saved';

  /** Write the working document into the current project (creating one if needed). */
  const saveNow = useCallback(() => {
    const current = docRef.current;
    const data = toProjectData(current);
    const now = new Date();
    const id = currentIdRef.current;
    if (id && findProject(projectsRef.current, id)) {
      commitProjects(updateProjectData(projectsRef.current, id, data, now));
    } else {
      const project = createProject(defaultProjectName(now), data, now);
      commitProjects([...projectsRef.current, project]);
      currentIdRef.current = project.id;
      setCurrentProjectId(project.id);
      track('project_created', { source: newProjectSource.current ?? 'autosave' });
      newProjectSource.current = null;
    }
    setSaved(current);
    setLastSavedAt(now);
  }, [commitProjects]);

  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(saveNow, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dirty, doc.layout, doc.designMode, doc.unitSystem, saveNow]);

  /** Make `project` current; `snapshot` is the document the editor now shows for it. */
  const select = useCallback((project: Project, snapshot: WorkingDoc) => {
    currentIdRef.current = project.id;
    setCurrentProjectId(project.id);
    setSaved(snapshot);
    setLastSavedAt(project.updatedAt ? new Date(project.updatedAt) : new Date());
  }, []);

  /** Detach from the current project; the next autosave creates a new one. */
  const startNew = useCallback(() => {
    newProjectSource.current = 'new';
    currentIdRef.current = null;
    setCurrentProjectId(null);
    setSaved(null);
  }, []);

  /** Save the working document as a new named project and make it current. */
  const createNamed = useCallback(
    (
      name: string,
      source: string,
      snapshot: WorkingDoc = docRef.current,
      data?: ProjectData,
    ): Project => {
      const project = createProject(name, data ?? toProjectData(snapshot));
      commitProjects([...projectsRef.current, project]);
      select(project, snapshot);
      track('project_created', { source });
      return project;
    },
    [commitProjects, select],
  );

  const rename = useCallback(
    (id: string, name: string) => {
      commitProjects(renameProject(projectsRef.current, id, name));
      track('project_renamed');
    },
    [commitProjects],
  );

  const duplicate = useCallback(
    (ids: string[]) => {
      const copies = ids
        .map((id) => findProject(projectsRef.current, id))
        .filter((p): p is Project => !!p)
        .map((p) => duplicateProject(p));
      if (!copies.length) return;
      commitProjects([...projectsRef.current, ...copies]);
      for (let i = 0; i < copies.length; i++) track('project_created', { source: 'duplicate' });
    },
    [commitProjects],
  );

  const remove = useCallback(
    (ids: string[]) => {
      commitProjects(deleteProjects(projectsRef.current, ids));
      if (currentIdRef.current && ids.includes(currentIdRef.current)) {
        // Like the original: the working layout stays; the next edit autosaves it as a new plan.
        currentIdRef.current = null;
        setCurrentProjectId(null);
      }
      track('project_deleted', { count: ids.length });
    },
    [commitProjects],
  );

  /** Import an exported projects file; returns how many plans were added. Throws on bad input. */
  const importFile = useCallback(
    (text: string): number => {
      const imported = parseProjectsImport(text, projectsRef.current.length);
      commitProjects([...projectsRef.current, ...imported]);
      track('import_json', { kind: 'projects', count: imported.length });
      return imported.length;
    },
    [commitProjects],
  );

  return {
    projects,
    currentProjectId,
    currentProject: findProject(projects, currentProjectId),
    saveStatus,
    lastSavedAt,
    saveNow,
    select,
    startNew,
    createNamed,
    rename,
    duplicate,
    remove,
    importFile,
  };
}

export type ProjectsApi = ReturnType<typeof useProjects>;
