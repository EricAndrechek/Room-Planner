import { Scan, ZoomIn, ZoomOut } from 'lucide-react';
import { MAX_ZOOM, MIN_ZOOM } from '../../lib/constants';
import { SnapToggle } from './SnapToggle';
import { Tooltip } from './Tooltip';

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

/** Zoom buttons and the Snap toggle in the desktop header. */
export function HeaderZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  snapOn,
  onToggleSnap,
}: ZoomControlsProps & { snapOn: boolean; onToggleSnap: () => void }) {
  return (
    <div className="hidden md:flex items-center gap-1 bg-slate-50 rounded-lg px-2 py-1">
      <Tooltip text="Zoom out">
        <button
          type="button"
          onClick={onZoomOut}
          disabled={zoom <= MIN_ZOOM}
          className="p-1.5 hover:bg-slate-200 rounded-sm text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          aria-label="Zoom out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
      </Tooltip>
      <span className="text-xs font-medium text-slate-600 min-w-[3rem] text-center">
        {Math.round(zoom * 100)}%
      </span>
      <Tooltip text="Zoom in">
        <button
          type="button"
          onClick={onZoomIn}
          disabled={zoom >= MAX_ZOOM}
          className="p-1.5 hover:bg-slate-200 rounded-sm text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
          aria-label="Zoom in"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
      </Tooltip>
      <div className="w-px h-4 bg-slate-300 mx-1" />
      <Tooltip text="Fit to view">
        <button
          type="button"
          onClick={onFit}
          className="p-1.5 hover:bg-slate-200 rounded-sm text-slate-600 transition-colors flex items-center justify-center"
          aria-label="Fit to view"
        >
          <Scan className="w-4 h-4" />
        </button>
      </Tooltip>
      <div className="w-px h-4 bg-slate-300 mx-1" />
      <SnapToggle variant="header" on={snapOn} onToggle={onToggleSnap} />
    </div>
  );
}

/** Zoom pill in the phone bottom bar (laid out next to the editor button by the planner). */
export function FloatingZoomControls({ zoom, onZoomIn, onZoomOut, onFit }: ZoomControlsProps) {
  return (
    <div
      className="pointer-events-auto flex md:hidden items-center gap-0.5 bg-white/95 backdrop-blur-xs rounded-full shadow-lg px-1.5 py-1.5 animate-fade-in"
      data-testid="zoom-pill"
    >
      <button
        type="button"
        onClick={onZoomOut}
        disabled={zoom <= MIN_ZOOM}
        className="p-2 hover:bg-slate-100 rounded-full text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
        aria-label="Zoom out"
      >
        <ZoomOut className="w-5 h-5" />
      </button>
      <span className="text-xs font-medium text-slate-600 min-w-[2.5rem] text-center tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        onClick={onZoomIn}
        disabled={zoom >= MAX_ZOOM}
        className="p-2 hover:bg-slate-100 rounded-full text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
        aria-label="Zoom in"
      >
        <ZoomIn className="w-5 h-5" />
      </button>
      <div className="w-px h-5 bg-slate-300 mx-0.5" />
      <button
        type="button"
        onClick={onFit}
        className="p-2 hover:bg-slate-100 rounded-full text-slate-600 transition-colors flex items-center justify-center"
        aria-label="Fit to view"
      >
        <Scan className="w-5 h-5" />
      </button>
    </div>
  );
}
