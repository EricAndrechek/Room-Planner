import { useState } from 'react';
import {
  Check,
  CircleHelp,
  Edit3,
  FolderOpen,
  Maximize2,
  Redo2,
  Share2,
  Undo2,
} from 'lucide-react';
import { formatTimeAgo } from '../../lib/browser';
import { feetToDisplay, formatArea } from '../../lib/units';
import { useNow } from '../../hooks/useNow';
import type { RoomDims, SaveStatus, UnitSystem } from '../../types';
import { Tooltip } from './Tooltip';
import { InstallButton } from './PwaNotices';
import { HeaderZoomControls } from './ZoomControls';

interface HeaderProps {
  projectName: string;
  roomDims: RoomDims;
  unitSystem: UnitSystem;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  helpHref: string;
  onOpenFiles: () => void;
  /** Rename the current plan (creating it first if it was never saved). */
  onRename: (name: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onShare: () => void;
}

/** Top bar: plan name (click to rename), save status, undo/redo, zoom, share. */
export function Header(props: HeaderProps) {
  const [editingName, setEditingName] = useState<string | null>(null);
  const now = useNow();

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
            <button
              type="button"
              onClick={() => setEditingName(props.projectName)}
              className="text-left group hover:bg-slate-50 rounded-sm px-1 -mx-1 transition-colors flex items-center justify-center"
              title="Click to rename"
            >
              <h1 className="text-sm font-bold text-slate-800 leading-tight truncate group-hover:text-indigo-600 transition-colors">
                {props.projectName}
                <Edit3 className="w-3 h-3 inline ml-1 opacity-0 group-hover:opacity-50 transition-opacity" />
              </h1>
            </button>
          )}
          {/* Dimensions - hidden on mobile */}
          <div className="hidden sm:flex items-center gap-1 text-[10px] text-slate-500 -mt-0.5">
            <Maximize2 className="w-3 h-3 shrink-0" />
            <span className="truncate">
              {feetToDisplay(props.roomDims.width, props.unitSystem)} ×{' '}
              {feetToDisplay(props.roomDims.height, props.unitSystem)} (
              {formatArea(props.roomDims.width, props.roomDims.height)})
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <div
          className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-400"
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
          <Tooltip text="Undo">
            <button
              type="button"
              onClick={props.onUndo}
              disabled={!props.canUndo}
              className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-lg text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              aria-label="Undo"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          </Tooltip>
          <Tooltip text="Redo">
            <button
              type="button"
              onClick={props.onRedo}
              disabled={!props.canRedo}
              className="p-1.5 sm:p-2 hover:bg-slate-100 rounded-lg text-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              aria-label="Redo"
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
        />

        <InstallButton variant="header" />

        <Tooltip text="Help & FAQ">
          <a
            href={props.helpHref}
            className="hidden sm:flex p-1.5 sm:p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors items-center justify-center"
            aria-label="Help and FAQ"
          >
            <CircleHelp className="w-4 h-4" />
          </a>
        </Tooltip>

        <button
          type="button"
          onClick={props.onShare}
          className="flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors shadow-xs"
          aria-label="Share and save layout"
        >
          <Share2 className="w-4 h-4 shrink-0" />
          <span className="hidden sm:inline">Share / Save</span>
        </button>
      </div>
    </div>
  );
}
