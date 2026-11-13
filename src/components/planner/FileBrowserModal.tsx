import { useState } from 'react';
import {
  CheckSquare,
  Copy as CopyIcon,
  Edit3,
  FileDown,
  FileText,
  FileUp,
  FolderOpen,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';
import { feetToDisplay } from '../../lib/units';
import type { Project, UnitSystem } from '../../types';
import { Modal } from './Modal';
import { Tooltip } from './Tooltip';

interface FileBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  currentProjectId: string | null;
  unitSystem: UnitSystem;
  onNew: () => void;
  onOpen: (project: Project) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
  onExport: (ids: string[]) => void;
  /** Returns the number of imported plans; throws on invalid input. */
  onImport: (text: string) => number;
  onSaveCurrent: () => void;
}

/** "My Floor Plans": open, rename, duplicate, delete, export and import saved plans. */
export function FileBrowserModal(props: FileBrowserModalProps) {
  const { isOpen, projects, currentProjectId, unitSystem } = props;
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');

  // Drop selections of plans that no longer exist.
  const selectedIds = selected.filter((id) => projects.some((p) => p.id === id));

  const close = () => {
    setSelected([]);
    setEditing(null);
    props.onClose();
  };

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectAll = () =>
    setSelected(selectedIds.length === projects.length ? [] : projects.map((p) => p.id));

  const finishRename = (save: boolean) => {
    if (save && editing && editing.name.trim()) props.onRename(editing.id, editing.name);
    setEditing(null);
  };

  const handleImport = () => {
    try {
      const count = props.onImport(importText);
      if (count > 0) setImportText('');
      setImportError('');
    } catch {
      setImportError('Invalid file format. Please check your JSON.');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="My Floor Plans">
      <div className="space-y-4">
        {/* Action Bar */}
        <div className="flex flex-wrap gap-2 pb-3 border-b border-slate-200">
          <button
            type="button"
            onClick={props.onNew}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> New
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedIds.length > 0) props.onExport(selectedIds);
              else if (currentProjectId) props.onExport([currentProjectId]);
            }}
            disabled={selectedIds.length === 0 && !currentProjectId}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDown className="w-3.5 h-3.5" /> Export {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
          </button>
          {selectedIds.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => props.onDuplicate(selectedIds)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium transition-colors"
              >
                <CopyIcon className="w-3.5 h-3.5" /> Duplicate ({selectedIds.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete ${selectedIds.length} project(s)?`)) {
                    props.onDelete(selectedIds);
                    setSelected([]);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 hover:bg-red-100 text-red-600 rounded-lg text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete ({selectedIds.length})
              </button>
            </>
          )}
        </div>

        {projects.length > 0 && (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={selectAll}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
            >
              {selectedIds.length === projects.length ? (
                <>
                  <CheckSquare className="w-3.5 h-3.5" /> Deselect All
                </>
              ) : (
                <>
                  <Square className="w-3.5 h-3.5" /> Select All
                </>
              )}
            </button>
            <span className="text-xs text-slate-400">
              {projects.length} plan{projects.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Project List */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {projects.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No saved floor plans yet</p>
              <p className="text-xs mt-1">Save your current plan or create a new one</p>
            </div>
          ) : (
            projects.map((project) => {
              const isSelected = selectedIds.includes(project.id);
              const isEditing = editing?.id === project.id;
              return (
                <div
                  key={project.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all cursor-pointer ${
                    project.id === currentProjectId
                      ? 'border-indigo-300 bg-indigo-50'
                      : isSelected
                        ? 'border-slate-300 bg-slate-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                  onClick={() => !isEditing && toggle(project.id)}
                  data-testid="project-row"
                >
                  <div className="shrink-0">
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-indigo-600" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editing.name}
                        onChange={(e) => setEditing({ id: project.id, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') finishRename(true);
                          else if (e.key === 'Escape') finishRename(false);
                        }}
                        onBlur={() => finishRename(true)}
                        className="w-full px-2 py-1 text-sm border border-indigo-300 rounded-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                        aria-label="Floor plan name"
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800 truncate">{project.name}</span>
                          {project.id === currentProjectId && (
                            <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-sm font-medium">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {project.data?.roomDims && (
                            <span>
                              {feetToDisplay(project.data.roomDims.width, unitSystem)} ×{' '}
                              {feetToDisplay(project.data.roomDims.height, unitSystem)}
                            </span>
                          )}
                          <span className="mx-1">•</span>
                          <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Tooltip text="Open">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onOpen(project);
                          setSelected([]);
                        }}
                        className="p-1.5 hover:bg-slate-100 rounded-sm text-slate-500 hover:text-indigo-600 transition-colors"
                        aria-label={`Open ${project.name}`}
                      >
                        <FolderOpen className="w-4 h-4" />
                      </button>
                    </Tooltip>
                    <Tooltip text="Rename">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing({ id: project.id, name: project.name });
                        }}
                        className="p-1.5 hover:bg-slate-100 rounded-sm text-slate-500 hover:text-slate-700 transition-colors"
                        aria-label={`Rename ${project.name}`}
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </Tooltip>
                    <Tooltip text="Duplicate">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onDuplicate([project.id]);
                        }}
                        className="p-1.5 hover:bg-slate-100 rounded-sm text-slate-500 hover:text-slate-700 transition-colors"
                        aria-label={`Duplicate ${project.name}`}
                      >
                        <CopyIcon className="w-4 h-4" />
                      </button>
                    </Tooltip>
                    <Tooltip text="Delete">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${project.name}"?`)) props.onDelete([project.id]);
                        }}
                        className="p-1.5 hover:bg-red-50 rounded-sm text-slate-500 hover:text-red-600 transition-colors"
                        aria-label={`Delete ${project.name}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Import Section */}
        <div className="pt-3 border-t border-slate-200">
          <label className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2" htmlFor="import-plans">
            <FileUp className="w-4 h-4" /> Import Floor Plan(s)
          </label>
          <textarea
            id="import-plans"
            placeholder="Paste exported JSON here to import floor plan(s)..."
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportError('');
            }}
            className="w-full h-20 bg-white border border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 rounded-lg p-2 text-xs font-mono mb-2 outline-hidden resize-none"
          />
          {importError && <p className="text-xs text-red-500 mb-2">{importError}</p>}
          <button
            type="button"
            onClick={handleImport}
            disabled={!importText.trim()}
            className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Import
          </button>
        </div>

        {currentProjectId && (
          <div className="pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={props.onSaveCurrent}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Save Current Plan
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
