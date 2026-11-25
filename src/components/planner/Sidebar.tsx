import { useId, type ReactNode } from 'react';
import { CircleHelp, Home, Info, Lock, Sofa } from 'lucide-react';
import type { BottomSheet } from '../../hooks/useBottomSheet';
import { DESIGN_MODES, UNIT_SYSTEMS } from '../../lib/constants';
import { InstallButton } from './PwaNotices';
import { SheetHeader, type SheetAction } from './SheetHeader';
import type { DesignMode, UnitSystem } from '../../types';

/** Phones: the sidebar is a bottom sheet over the plan. */
export interface SidebarSheet {
  sheet: BottomSheet;
  /** One line: the selected piece, door or window, or the active step. */
  summary: string;
  /** The key action while collapsed. */
  action?: SheetAction;
  /** The selected piece's actions, in the sheet's top row. */
  actions?: ReactNode;
  /** Controls riding on top of the sheet, over the plan (zoom, Snap); hidden at full height. */
  floating: ReactNode;
}

interface SidebarProps {
  designMode: DesignMode;
  unitSystem: UnitSystem;
  helpHref: string;
  onUnitSystemChange: (units: UnitSystem) => void;
  onDesignModeChange: (mode: DesignMode) => void;
  /** Set on phones (below `md`): render as the bottom sheet. */
  sheet?: SidebarSheet;
  children: ReactNode;
}

/**
 * Settings column: a fixed-width side panel on wide screens, a resizable bottom sheet on phones.
 * The same element and children either way, so nothing is lost when the layout switches.
 */
export function Sidebar({
  designMode,
  unitSystem,
  helpHref,
  onUnitSystemChange,
  onDesignModeChange,
  sheet,
  children,
}: SidebarProps) {
  const isRoomSetup = designMode === DESIGN_MODES.ROOM_SETUP;
  const contentId = useId();
  const s = sheet?.sheet;
  // Units and the typing tip go to the end on phones, so a half-open sheet starts with the steps.
  const unitsBlock = (
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
  );
  const infoBlock = (
    <div className="bg-slate-50 p-3 text-xs text-slate-600 border-b border-slate-100 flex gap-2 items-center">
      <Info className="w-4 h-4 shrink-0 text-slate-500" />
      <p>
        You can type values with units (e.g., <strong>12&apos;6&quot;</strong>,{' '}
        <strong>150cm</strong>, <strong>1.5m</strong>)
      </p>
    </div>
  );
  return (
    <div
      ref={s?.sheetRef}
      className={
        s
          ? 'fixed inset-x-0 bottom-0 z-[45] flex flex-col bg-white rounded-t-2xl border-t border-slate-200 shadow-[0_-6px_24px_rgba(15,23,42,0.16)] pb-[env(safe-area-inset-bottom)] transition-[height] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]'
          : 'relative z-[45] w-80 bg-white border-r border-slate-200 overflow-y-auto overflow-x-hidden transition-all duration-300 flex flex-col'
      }
      role={s ? 'region' : undefined}
      aria-label={s ? 'Editor' : undefined}
      data-testid="sidebar"
      data-detent={s?.detent}
    >
      {s && s.detent !== 'full' && (
        <div
          className="absolute bottom-full inset-x-0 mb-2 px-3 flex items-center justify-between gap-2 pointer-events-none"
          data-testid="sheet-floating"
        >
          {sheet.floating}
        </div>
      )}
      {s && (
        <SheetHeader
          detent={s.detent}
          headerRef={s.headerRef}
          handleRef={s.handleRef}
          onHeaderPointerDown={s.onHeaderPointerDown}
          onHeaderClickCapture={s.onHeaderClickCapture}
          onHandleClick={s.onHandleClick}
          onHandleKeyDown={s.onHandleKeyDown}
          isRoomSetup={isRoomSetup}
          summary={sheet.summary}
          action={sheet.action}
          actions={sheet.actions}
          contentId={contentId}
        />
      )}
      <div
        ref={s?.contentRef}
        id={contentId}
        className={
          s
            ? 'min-h-0 flex-1 flex flex-col overflow-y-auto overflow-x-hidden overscroll-contain'
            : 'contents'
        }
        inert={s?.detent === 'peek'}
        data-testid="sheet-content"
        data-sheet-content={s ? '' : undefined}
      >
        {!s && unitsBlock}
        {/* Design Mode Switcher. Compact on phones (no heading or lock hint: the badge on the plan
            says what is locked), so a half-open sheet reaches the step's own controls. */}
        <div className={`bg-white border-b border-slate-200 ${s ? 'px-4 py-3' : 'p-4'}`}>
          {!s && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Design Steps
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onDesignModeChange(DESIGN_MODES.ROOM_SETUP)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all ${
                isRoomSetup
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                !isRoomSetup
                  ? 'bg-emerald-700 text-white shadow-md'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              aria-pressed={!isRoomSetup}
            >
              <Sofa className="w-4 h-4" />
              <span className="hidden sm:inline">2. Furniture</span>
              <span className="sm:hidden">2. Items</span>
            </button>
          </div>
          {!s && (
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
          )}
        </div>

        {!s && infoBlock}

        <div className="p-4 space-y-4 min-w-0 md:min-w-[20rem]">{children}</div>

        {s && unitsBlock}
        {s && infoBlock}

        <div className="mt-auto px-4 pb-4 pt-2 md:min-w-[20rem]">
          <InstallButton variant="sidebar" />
          <a
            href={helpHref}
            className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 hover:text-indigo-600 transition-colors"
          >
            <CircleHelp className="w-3.5 h-3.5" />
            Help &amp; FAQ
          </a>
        </div>
      </div>
    </div>
  );
}
