import { Scan, ZoomIn, ZoomOut } from 'lucide-react';
import { MAX_ZOOM, MIN_ZOOM } from '../../lib/constants';
import { Tooltip } from './Tooltip';

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

/** Zoom buttons in the desktop header. */
export function HeaderZoomControls({ zoom, onZoomIn, onZoomOut, onFit }: ZoomControlsProps) {
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
    </div>
  );
}

/** Floating zoom pill on small screens. */
export function FloatingZoomControls({ zoom, onZoomIn, onZoomOut, onFit }: ZoomControlsProps) {
  return (
    <div
      className="fixed bottom-6 left-4 z-40 flex md:hidden items-center gap-1 bg-white/95 backdrop-blur-xs rounded-full shadow-lg px-2 py-1.5 animate-fade-in"
      style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
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
      <span className="text-xs font-medium text-slate-600 min-w-[3rem] text-center">
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
      <div className="w-px h-5 bg-slate-300 mx-1" />
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
