import { track } from '../lib/analytics';
import { downloadFile } from '../lib/browser';
import { DESIGN_MODES, isDesignMode, isUnitSystem } from '../lib/constants';
import {
  blankLayout,
  defaultLayout,
  fromShareConfig,
  normalizeLayout,
  type ShareConfig,
} from '../core/layout';
import { buildExportFile, exportFileName } from '../lib/projects';
import type { DesignMode, Layout, Project, Selection, UnitSystem } from '../types';
import type { History } from './useHistory';
import type { useProjects } from './useProjects';

/** What a new plan starts from: the sample bedroom, or an empty room. */
export type NewPlanStart = 'sample' | 'blank';

interface Options {
  history: History<Layout>;
  projects: ReturnType<typeof useProjects>;
  designMode: DesignMode;
  unitSystem: UnitSystem;
  setDesignMode: (mode: DesignMode) => void;
  setUnitSystem: (units: UnitSystem) => void;
  setSelection: (selection: Selection | null) => void;
  /** Close the file browser (after opening or starting a project). */
  closeFiles: () => void;
}

/**
 * Project-level actions that touch both the saved projects and the working
 * document: new, open, rename, import a shared layout, export projects as JSON.
 */
export function useProjectActions({
  history,
  projects,
  designMode,
  unitSystem,
  setDesignMode,
  setUnitSystem,
  setSelection,
  closeFiles,
}: Options) {
  const openProject = (project: Project) => {
    const next = normalizeLayout(project.data);
    const mode = isDesignMode(project.data.designMode) ? project.data.designMode : designMode;
    const units = isUnitSystem(project.data.unitSystem) ? project.data.unitSystem : unitSystem;
    history.reset(next);
    setDesignMode(mode);
    setUnitSystem(units);
    projects.select(project, { layout: next, designMode: mode, unitSystem: units });
    setSelection(null);
    closeFiles();
    track('project_opened');
  };

  /**
   * Start a new plan from the sample room or an empty one. The current plan is kept: its last
   * edits are saved first (autosave may not have run yet), and it stays in My Floor Plans.
   */
  const newProject = (start: NewPlanStart = 'sample') => {
    if (projects.saveStatus !== 'saved') projects.saveNow();
    history.reset(start === 'blank' ? blankLayout() : defaultLayout());
    setDesignMode(DESIGN_MODES.ROOM_SETUP);
    projects.startNew(start === 'blank' ? 'new_blank' : 'new');
    setSelection(null);
    closeFiles();
  };

  const renameCurrent = (name: string) => {
    if (projects.currentProjectId) projects.rename(projects.currentProjectId, name);
    else projects.createNamed(name, 'rename');
  };

  const importConfig = (config: ShareConfig) => {
    const next = fromShareConfig(config);
    history.apply(() => next);
    setSelection(null);
    if (typeof config.name === 'string' && config.name) {
      projects.createNamed(config.name, 'import', { layout: next, designMode, unitSystem }, next);
    }
    track('import_json', { kind: 'layout' });
  };

  const exportProjects = (ids: string[]) => {
    const list = projects.projects.filter((p) => ids.includes(p.id));
    if (!list.length) return;
    downloadFile(exportFileName(list), JSON.stringify(buildExportFile(list), null, 2));
    track('export_json', { kind: 'projects', count: list.length });
  };

  return { openProject, newProject, renameCurrent, importConfig, exportProjects };
}
