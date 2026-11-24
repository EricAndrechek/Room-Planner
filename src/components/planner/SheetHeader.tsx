import { useId, type ReactNode } from 'react';
import { Home, Sofa } from 'lucide-react';
import type { BottomSheet } from '../../hooks/useBottomSheet';
import type { Detent } from '../../lib/sheet';

/** The one key action in the collapsed sheet (Add item, Next: Items, Edit). */
export interface SheetAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /** Color: the step it belongs to (indigo room setup, emerald furniture). */
  tone: 'room' | 'furniture';
}

type SheetParts = Pick<
  BottomSheet,
  | 'detent'
  | 'headerRef'
  | 'handleRef'
  | 'onHeaderPointerDown'
  | 'onHeaderClickCapture'
  | 'onHandleClick'
  | 'onHandleKeyDown'
>;

interface SheetHeaderProps extends SheetParts {
  isRoomSetup: boolean;
  summary: string;
  /** Shown only while collapsed (at peek); at half and full the controls are in view. */
  action?: SheetAction;
  /** Id of the scrolling content the handle resizes. */
  contentId: string;
}

const STATE_TEXT: Record<Detent, string> = {
  peek: 'Editor collapsed. Arrow Up expands it.',
  half: 'Editor at half height. Arrow Up or Down resizes it.',
  full: 'Editor at full height. Arrow Down shrinks it.',
};

/**
 * Top of the phone sheet: the grab handle (the whole strip is a button: tap or Enter cycles the
 * height, Arrow Up/Down step it, dragging resizes) with a one-line summary and, at peek, the key
 * action.
 */
export function SheetHeader({
  detent,
  headerRef,
  handleRef,
  onHeaderPointerDown,
  onHeaderClickCapture,
  onHandleClick,
  onHandleKeyDown,
  isRoomSetup,
  summary,
  action,
  contentId,
}: SheetHeaderProps) {
  const id = useId();
  const collapsed = detent === 'peek';
  return (
    <div
      ref={headerRef}
      className={`relative shrink-0 touch-none select-none border-b ${collapsed ? 'border-transparent' : 'border-slate-200'}`}
      onPointerDown={onHeaderPointerDown}
      onClickCapture={onHeaderClickCapture}
      data-testid="sheet-header"
    >
      <button
        ref={handleRef}
        type="button"
        className="sheet-handle absolute inset-0 w-full rounded-t-2xl cursor-grab active:cursor-grabbing"
        aria-label="Resize editor"
        aria-expanded={!collapsed}
        aria-controls={contentId}
        aria-describedby={`${id}-summary ${id}-state`}
        onClick={onHandleClick}
        onKeyDown={onHandleKeyDown}
        data-testid="sheet-handle"
      >
        <span
          className="absolute top-2 left-1/2 -translate-x-1/2 h-1.5 w-10 rounded-full bg-slate-300"
          aria-hidden="true"
        />
      </button>
      <span id={`${id}-state`} className="sr-only">
        {STATE_TEXT[detent]}
      </span>
      {/* Above the handle but click-through, except the action button. */}
      <div className="relative flex items-center gap-2.5 pl-4 pr-3 pt-4 pb-2 min-h-[4.25rem] pointer-events-none">
        <div
          className={`p-1.5 rounded-lg shrink-0 ${isRoomSetup ? 'bg-indigo-100 text-indigo-600' : 'bg-emerald-100 text-emerald-600'}`}
          aria-hidden="true"
        >
          {isRoomSetup ? <Home className="w-4 h-4" /> : <Sofa className="w-4 h-4" />}
        </div>
        <p
          id={`${id}-summary`}
          className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800"
          data-testid="sheet-summary"
        >
          {summary}
        </p>
        {collapsed && action && (
          <button
            type="button"
            onClick={action.onClick}
            className={`pointer-events-auto shrink-0 flex items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium text-white shadow-xs transition-colors active:scale-95 ${
              action.tone === 'room'
                ? 'bg-indigo-600 hover:bg-indigo-700'
                : 'bg-emerald-700 hover:bg-emerald-800'
            }`}
            data-testid="sheet-action"
          >
            {action.icon}
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
