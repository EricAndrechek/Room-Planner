import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, Lock } from 'lucide-react';

interface StepHeaderProps {
  /** This step is the current mode: its section is always open and the header is just a label. */
  isActive: boolean;
  /** Inactive only: whether the (locked) section is shown. */
  expanded: boolean;
  onToggleExpanded: () => void;
  icon: ReactNode;
  title: string;
  summary: ReactNode;
  /** Icon tile colors while active, e.g. `bg-indigo-100 text-indigo-600`. */
  activeIcon: string;
  /** "Editing" status color while active, e.g. `text-indigo-700` / `bg-indigo-500`. */
  activeText: string;
  activeDot: string;
}

/**
 * Header of a sidebar step (Room Setup, Furniture). While the step is inactive it is a button that
 * shows or hides the locked section. While active there is nothing to press, so it is not a
 * button and shows its "Editing" status as plain text, not as a pill.
 */
export function StepHeader(p: StepHeaderProps) {
  const body = (
    <div className="flex items-center gap-2">
      <div
        className={`p-1.5 rounded-lg ${p.isActive ? p.activeIcon : 'bg-slate-200 text-slate-500'}`}
      >
        {p.icon}
      </div>
      <div className="text-left">
        <span className="text-sm font-semibold text-slate-700 block">{p.title}</span>
        <span className="text-[10px] text-slate-600">{p.summary}</span>
      </div>
    </div>
  );
  if (p.isActive) {
    return (
      <div
        className="w-full flex items-center justify-between p-3 rounded-t-xl"
        data-testid="step-header"
      >
        {body}
        <span className={`flex items-center gap-1.5 text-[10px] font-medium ${p.activeText}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${p.activeDot}`} aria-hidden="true" />
          Editing
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={p.onToggleExpanded}
      className="w-full flex items-center justify-between p-3 cursor-pointer hover:bg-slate-100 rounded-t-xl transition-colors"
      aria-expanded={p.expanded}
      data-testid="step-header"
    >
      {body}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-600 flex items-center gap-1">
          <Lock className="w-3 h-3" /> Locked
        </span>
        {p.expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        )}
      </div>
    </button>
  );
}
