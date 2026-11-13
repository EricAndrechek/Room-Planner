import type { ReactNode } from 'react';
import { CircleHelp, Eye, Home, Info, Lock, Sofa } from 'lucide-react';
import { DESIGN_MODES, UNIT_SYSTEMS } from '../../lib/constants';
import type { DesignMode, UnitSystem } from '../../types';

interface SidebarProps {
  open: boolean;
  designMode: DesignMode;
  unitSystem: UnitSystem;
  helpHref: string;
  onUnitSystemChange: (units: UnitSystem) => void;
  onDesignModeChange: (mode: DesignMode) => void;
  /** Mobile only: close the full-screen sidebar and show the plan. */
  onClose: () => void;
  children: ReactNode;
}

/** Settings column: full screen on mobile, a fixed-width side panel on desktop. */
export function Sidebar({
  open,
  designMode,
  unitSystem,
  helpHref,
  onUnitSystemChange,
  onDesignModeChange,
  onClose,
  children,
}: SidebarProps) {
  const isRoomSetup = designMode === DESIGN_MODES.ROOM_SETUP;
  return (
    <div
      className={`fixed md:relative top-12 sm:top-16 md:top-auto bottom-0 md:bottom-auto left-0 right-0 md:inset-auto z-[45] bg-white md:border-r border-slate-200 overflow-y-auto overflow-x-hidden transition-all duration-300 flex flex-col shadow-xl md:shadow-none
      ${open ? 'md:w-80 translate-x-0' : 'md:w-0 -translate-x-full md:opacity-0 md:overflow-hidden'}`}
      aria-hidden={!open}
      inert={!open}
      data-testid="sidebar"
    >
      {/* Mobile header */}
      <div className="md:hidden bg-white px-4 py-3 flex justify-between items-center sticky top-0 z-10 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${isRoomSetup ? 'bg-indigo-100' : 'bg-emerald-100'}`}>
            {isRoomSetup ? <Home className="w-4 h-4 text-indigo-600" /> : <Sofa className="w-4 h-4 text-emerald-600" />}
          </div>
          <div>
            <h2 className="font-bold text-slate-800 text-sm leading-tight">{isRoomSetup ? 'Room Setup' : 'Furniture'}</h2>
            <p className="text-[10px] text-slate-500">
              {isRoomSetup ? 'Configure room, doors & windows' : 'Add and arrange furniture'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          className={`flex items-center gap-1 px-4 py-2 text-white rounded-lg text-sm font-medium transition-colors active:scale-95 ${
            isRoomSetup ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
          aria-label="View floor plan"
        >
          <Eye className="w-4 h-4" />
          <span>View</span>
        </button>
      </div>

      {/* Unit System Selector */}
      <div className="bg-indigo-50 p-3 border-b border-indigo-100">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="unit-system" className="text-xs font-medium text-indigo-700">
            Display Units:
          </label>
          <select
            id="unit-system"
            value={unitSystem}
            onChange={(e) => onUnitSystemChange(e.target.value as UnitSystem)}
            className="text-xs border border-indigo-200 rounded-sm px-2 py-1.5 bg-white focus:ring-2 focus:ring-indigo-500 outline-hidden"
          >
            {UNIT_SYSTEMS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Design Mode Switcher */}
      <div className="bg-white p-4 border-b border-slate-200">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Design Steps</span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onDesignModeChange(DESIGN_MODES.ROOM_SETUP)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
              isRoomSetup ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
            aria-pressed={isRoomSetup}
          >
            <Home className="w-4 h-4" />
            <span className="hidden sm:inline">1. Room Setup</span>
            <span className="sm:hidden">1. Room</span>
          </button>
          <button
            type="button"
            onClick={() => onDesignModeChange(DESIGN_MODES.FURNITURE)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
              !isRoomSetup ? 'bg-emerald-600 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
            aria-pressed={!isRoomSetup}
          >
            <Sofa className="w-4 h-4" />
            <span className="hidden sm:inline">2. Furniture</span>
            <span className="sm:hidden">2. Items</span>
          </button>
        </div>
        <div
          className={`mt-3 p-2 rounded-lg text-[11px] ${isRoomSetup ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'}`}
        >
          <div className="flex items-center gap-2">
            <Lock className="w-3 h-3 shrink-0" />
            <span>
              {isRoomSetup
                ? 'Set up your room, doors & windows. Furniture is locked.'
                : 'Arrange furniture. Room layout is locked.'}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-slate-50 p-3 text-xs text-slate-600 border-b border-slate-100 flex gap-2 items-center">
        <Info className="w-4 h-4 shrink-0 text-slate-400" />
        <p>
          You can type values with units (e.g., <strong>12&apos;6&quot;</strong>, <strong>150cm</strong>,{' '}
          <strong>1.5m</strong>)
        </p>
      </div>

      <div className="p-4 space-y-4 min-w-0 md:min-w-[20rem]">{children}</div>

      <div className="mt-auto px-4 pb-4 pt-2 md:min-w-[20rem]">
        <a
          href={helpHref}
          className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 hover:text-indigo-600 transition-colors"
        >
          <CircleHelp className="w-3.5 h-3.5" />
          Help &amp; FAQ
        </a>
      </div>
    </div>
  );
}
