import { useState } from 'react';
import {
  Check,
  CircleHelp,
  Edit3,
  FileDown,
  Keyboard,
  FolderOpen,
  Maximize2,
  Redo2,
  Share2,
  Undo2,
} from 'lucide-react';
import { formatTimeAgo } from '../../lib/browser';
import { detectPlatform, toolbarHint } from '../../lib/shortcuts';
import { feetToDisplay, formatArea } from '../../core/units';
import { useNow } from '../../hooks/useNow';
import type { RoomDims, SaveStatus, UnitSystem } from '../../types';
import type { NewPlanStart } from '../../hooks/useProjectActions';
import { NewPlanMenu } from './NewPlanMenu';
import { Tooltip } from './Tooltip';
import { InstallButton } from './PwaNotices';
import { HeaderZoomControls } from './ZoomControls';

interface HeaderProps {
  projectName: string;
  roomDims: RoomDims;
  /** Several rooms: how many, and their total floor area (square feet). */
  floor?: { rooms: number; area: number };
  unitSystem: UnitSystem;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  /** Snapping preference (Snap toggle in the zoom group). */
  snapOn: boolean;
  onToggleSnap: () => void;
  helpHref: string;
  onOpenFiles: () => void;
  /** Start a new plan (the current one is kept in My Floor Plans). */
  onNewPlan: (start: NewPlanStart) => void;
  /** Rename the current plan (creating it first if it was never saved). */
  onRename: (name: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onShare: () => void;
  onExport: () => void;
  /** Open the keyboard shortcuts panel (also `?`). */
  onShowShortcuts: () => void;
}

/** Top bar: plan name (click to rename), save status, undo/redo, zoom, export, share. */
export function Header(props: HeaderProps) {
  const [editingName, setEditingName] = useState<string | null>(null);
  const now = useNow();
  const [platform] = useState(detectPlatform);

  const finishRename = (save: boolean) => {
    if (save && editingName?.trim()) props.onRename(editingName.trim());
    setEditingName(null);
  };

  return (
    <div
      className="bg-white border-b border-slate-200 px-3 sm:px-4 py-2 flex justify-between items-center shadow-xs relative z-50 h-12 sm:h-16"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
        <Tooltip text="My Floor Plans">
          <button
            type="button"
            onClick={props.onOpenFiles}
            className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors shrink-0 flex items-center justify-center"
            aria-label="Open file browser"
          >
            <FolderOpen className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </Tooltip>
        <NewPlanMenu unitSystem={props.unitSystem} onNewPlan={props.onNewPlan} />

        <div className="min-w-0 flex-1 max-w-[200px] sm:max-w-none">
          {editingName !== null ? (
            <input
              type="text"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => finishRename(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finishRename(true);
                else if (e.key === 'Escape') finishRename(false);
              }}
              className="text-sm font-bold text-slate-800 leading-tight bg-transparent border-b-2 border-indigo-500 outline-hidden w-full max-w-[200px]"
              aria-label="Floor plan name"
              autoFocus
            />
          ) : (
            // The heading is not inside the button: a separate rename button whose hit area
            // (::after) stretches over the whole name, so clicking the name still renames.
            <div className="group relative flex items-center min-w-0 rounded-sm px-1 -mx-1 min-h-6 hover:bg-slate-50 transition-colors">
              <h1 className="text-sm font-bold text-slate-800 leading-tight truncate group-hover:text-indigo-600 transition-colors">
                {props.projectName}
              </h1>
              <button
                type="button"
                onClick={() => setEditingName(props.projectName)}
                className="shrink-0 ml-1 flex items-center justify-center rounded-sm text-slate-800 group-hover:text-indigo-600 opacity-0 group-hover:opacity-50 focus-visible:opacity-100 [@media(hover:none)]:opacity-50 transition-opacity after:absolute after:inset-0 after:content-['']"
                title="Click to rename"
                aria-label="Rename floor plan"
              >
                <Edit3 className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          )}
          {/* Dimensions - hidden on mobile */}
          <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-500 -mt-0.5">
            <Maximize2 className="w-3 h-3 shrink-0" />
            {props.floor ? (
              <span className="truncate" data-testid="floor-summary">
                {`${props.floor.rooms} rooms `}
                <span translate="no">{`(${formatArea(props.floor.area, 1)})`}</span>
              </span>
            ) : (
              // One text node, kept out of page translation: sizes and units, not words.
              <span className="truncate" translate="no">
                {`${feetToDisplay(props.roomDims.width, props.unitSystem)} × ${feetToDisplay(props.roomDims.height, props.unitSystem)} (${formatArea(props.roomDims.width, props.roomDims.height)})`}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <div
          className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-500"
          data-testid="save-status"
        >
          {props.saveStatus === 'saved' && props.lastSavedAt ? (
            <span className="flex items-center gap-1">
              <Check className="w-3 h-3 text-green-500" />
              Saved {formatTimeAgo(props.lastSavedAt, now)}
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-slate-300 rounded-full" />
              Unsaved
            </span>
          )}
        </div>

        <div className="flex items-center">
          <Tooltip text={`Undo (${toolbarHint('undo', platform)})`}>
            <button
              type="button"
              onClick={props.onUndo}
              disabled={!props.canUndo}
              className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-lg text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              aria-label="Undo"
              aria-keyshortcuts="Control+Z Meta+Z"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip text={`Redo (${toolbarHint('redo', platform)})`}>
            <button
              type="button"
              onClick={props.onRedo}
              disabled={!props.canRedo}
              className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-lg text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              aria-label="Redo"
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>

        <HeaderZoomControls
          zoom={props.zoom}
          onZoomIn={props.onZoomIn}
          onZoomOut={props.onZoomOut}
          onFit={props.onFit}
          snapOn={props.snapOn}
          onToggleSnap={props.onToggleSnap}
        />

        <InstallButton variant="header" />

        <Tooltip text="Keyboard shortcuts (?)">
          <button
            type="button"
            onClick={props.onShowShortcuts}
            className="hidden md:flex p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-600 transition-colors items-center justify-center"
            aria-label="Keyboard shortcuts"
            aria-keyshortcuts="?"
          >
            <Keyboard className="w-4 h-4" />
          </button>
        </Tooltip>

        <Tooltip text="Help & FAQ">
          <a
            href={props.helpHref}
            className="hidden sm:flex p-1.5 sm:p-2 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-600 transition-colors items-center justify-center"
            aria-label="Help and FAQ"
          >
            <CircleHelp className="w-4 h-4" />
          </a>
        </Tooltip>

        <Tooltip text="Export PNG / PDF / Print">
          <button
            type="button"
            onClick={props.onExport}
            className="flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs sm:text-sm font-medium transition-colors"
            aria-label="Export as image or PDF"
          >
            <FileDown className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </Tooltip>

        <button
          type="button"
          onClick={props.onShare}
          className="flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors shadow-xs"
        >
          <Share2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Share / Save</span>
        </button>
      </div>
    </div>
  );
}
