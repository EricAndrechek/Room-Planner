import { track } from '../lib/analytics';
import { downloadFile } from '../lib/browser';
import { DESIGN_MODES, isUnitSystem } from '../lib/constants';
import { blankPlan, starterPlan } from '../lib/plans';
import { buildExportFile, exportFileName } from '../lib/projects';
import type { DesignMode, Plan, Project, Selection, UnitSystem } from '../types';
import type { History } from './useHistory';
import type { useProjects } from './useProjects';

/** What a new plan starts from: the sample bedroom, or an empty room. */
export type NewPlanStart = 'sample' | 'blank';

/** A plan read from the JSON box: `named` when the document carried a name of its own. */
export interface ImportedPlan {
  plan: Plan;
  name: string;
  named: boolean;
}

interface Options {
  history: History<Plan>;
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
    const next = project.plan;
    const mode = project.ui?.designMode ?? designMode;
    const stored = next.settings?.unitSystem;
    const units = isUnitSystem(stored) ? stored : unitSystem;
    history.reset(next);
    setDesignMode(mode);
    setUnitSystem(units);
    projects.select(project, { plan: next, designMode: mode, unitSystem: units });
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
    history.reset(start === 'blank' ? blankPlan() : starterPlan());
    setDesignMode(DESIGN_MODES.ROOM_SETUP);
    projects.startNew(start === 'blank' ? 'new_blank' : 'new');
    setSelection(null);
    closeFiles();
  };

  const renameCurrent = (name: string) => {
    if (projects.currentProjectId) projects.rename(projects.currentProjectId, name);
    else projects.createNamed(name, 'rename');
  };

  /** A plan pasted in the Share dialog replaces the working one (one undo step). */
  const importConfig = ({ plan, name, named }: ImportedPlan) => {
    history.apply(() => plan);
    setSelection(null);
    if (named) projects.createNamed(name, 'import', { plan, designMode, unitSystem });
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
