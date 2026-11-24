import { Magnet } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface SnapToggleProps {
  on: boolean;
  onToggle: () => void;
  /** `header`: in the desktop zoom group; `floating`: a chip riding on the phone sheet. */
  variant: 'header' | 'floating';
}

const HINT = 'Snap to walls & furniture (hold Alt/Option while dragging to move freely)';

/** Snapping on/off. A per-device preference, not part of the plan. */
export function SnapToggle({ on, onToggle, variant }: SnapToggleProps) {
  if (variant === 'header') {
    return (
      <Tooltip text={HINT}>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={on}
          className={`flex items-center gap-1 px-1.5 py-1 rounded-sm text-xs font-medium transition-colors ${
            on
              ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
              : 'text-slate-600 hover:bg-slate-200'
          }`}
          data-testid="snap-toggle"
        >
          <Magnet className="w-4 h-4" aria-hidden="true" />
          Snap
        </button>
      </Tooltip>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`pointer-events-auto shrink-0 flex items-center gap-1.5 pl-3 pr-3.5 py-2 rounded-full shadow-lg text-xs font-semibold backdrop-blur-xs transition-colors animate-fade-in ${
        on ? 'bg-indigo-600/95 text-white' : 'bg-white/95 text-slate-700 ring-1 ring-slate-300'
      }`}
      data-testid="snap-toggle"
    >
      <Magnet className="w-4 h-4" aria-hidden="true" />
      Snap
    </button>
  );
}
