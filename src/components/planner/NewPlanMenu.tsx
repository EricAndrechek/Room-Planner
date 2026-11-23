import { useEffect, useId, useRef, useState } from 'react';
import { FilePlus, Home, Square } from 'lucide-react';
import type { NewPlanStart } from '../../hooks/useProjectActions';
import { INITIAL_ROOM } from '../../lib/constants';
import { feetToDisplay } from '../../lib/units';
import type { UnitSystem } from '../../types';
import { Tooltip } from './Tooltip';

interface NewPlanMenuProps {
  unitSystem: UnitSystem;
  onNewPlan: (start: NewPlanStart) => void;
}

/** The two ways to start a new plan (also offered in My Floor Plans), with their descriptions. */
export function newPlanChoices(unitSystem: UnitSystem) {
  const size = `${feetToDisplay(INITIAL_ROOM.width, unitSystem)} × ${feetToDisplay(INITIAL_ROOM.height, unitSystem)}`;
  return [
    { start: 'sample', label: 'New plan', hint: 'Start from the sample bedroom', Icon: Home },
    { start: 'blank', label: 'Start blank', hint: `An empty ${size} room`, Icon: Square },
  ] as const;
}

/**
 * Header "New plan" button: a small disclosure with "New plan" (the sample room) and "Start
 * blank". The current plan is never touched; it stays in My Floor Plans.
 */
export function NewPlanMenu({ unitSystem, onNewPlan }: NewPlanMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative shrink-0 flex">
      <Tooltip text="New plan">
        <button
          ref={button}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`p-1.5 sm:p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors flex items-center justify-center ${open ? 'bg-slate-100' : ''}`}
          aria-label="New plan"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          data-testid="new-plan-button"
        >
          <FilePlus className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      </Tooltip>
      {open && (
        <div
          id={panelId}
          className="absolute left-0 top-full mt-2 w-64 max-w-[calc(100vw-1.5rem)] bg-white rounded-xl shadow-xl border border-slate-200 p-2 z-[60] animate-fade-in"
          data-testid="new-plan-menu"
        >
          {newPlanChoices(unitSystem).map(({ start, label, hint, Icon }) => (
            <button
              key={start}
              type="button"
              onClick={() => {
                setOpen(false);
                onNewPlan(start);
              }}
              className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 text-left transition-colors"
            >
              <Icon className="w-4 h-4 mt-0.5 shrink-0 text-indigo-600" aria-hidden="true" />
              <span>
                <span className="block text-sm font-medium text-slate-800">{label}</span>
                <span className="block text-[11px] text-slate-500">{hint}</span>
              </span>
            </button>
          ))}
          <p className="px-2 pt-1.5 pb-1 mt-1 border-t border-slate-100 text-[11px] text-slate-500">
            Your current plan stays in My Floor Plans.
          </p>
        </div>
      )}
    </div>
  );
}
