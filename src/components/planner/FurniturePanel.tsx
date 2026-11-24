import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Plus, Sofa, Trash2, Unlock } from 'lucide-react';
import { glowClass, useCardHighlight, type CardRef } from '../../hooks/useCardHighlight';
import type { ItemWarning } from '../../core/geometry';
import { feetToDisplay } from '../../core/units';
import { PIECE_PRESETS, type PiecePreset } from '../../lib/edits';
import type { PiecePatch } from '../../lib/plans';
import type { Id, Item, RoomDims, Selection, UnitSystem } from '../../types';
import { FurnitureCard } from './FurnitureCard';
import { StepHeader } from './StepHeader';
import { Tooltip } from './Tooltip';

/** The outline each "Add" choice draws next to its name (14 x 14). */
const PRESET_ICONS: Record<PiecePreset, string> = {
  new: 'M1.5 3.5h11v7h-11z',
  'l-sofa': 'M1.5 1.5h4v7h7v4h-11z',
  'round-table': 'M7 1.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z',
};

/**
 * "Add Item" adds a plain piece in one tap; the arrow beside it opens the starters with a shape
 * (and the plain piece again), each with its size.
 */
function AddItemMenu({
  unitSystem,
  onAdd,
}: {
  unitSystem: UnitSystem;
  onAdd: (preset?: PiecePreset) => void;
}) {
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
  const len = (feet: number) => feetToDisplay(feet, unitSystem);
  const hint = (preset: PiecePreset) => {
    const p = PIECE_PRESETS[preset];
    return p.shape === 'ellipse' && p.width === p.depth
      ? `${len(p.width)} across`
      : `${len(p.width)} × ${len(p.depth)}`;
  };
  return (
    <div ref={wrap} className="relative flex">
      <button
        type="button"
        onClick={() => onAdd()}
        className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-800 hover:bg-emerald-100 pl-2 pr-1.5 py-1 rounded-l-sm font-medium transition-colors"
      >
        <Plus className="w-3 h-3" /> Add Item
      </button>
      <Tooltip text="Sofa, table…" disabled={open}>
        <button
          ref={button}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center justify-center text-emerald-800 px-1 py-1 rounded-r-sm border-l border-emerald-200 transition-colors ${open ? 'bg-emerald-100' : 'bg-emerald-50 hover:bg-emerald-100'}`}
          aria-label="More items to add"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          data-testid="add-item-more"
        >
          <ChevronDown className="w-3 h-3" aria-hidden="true" />
        </button>
      </Tooltip>
      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-full mt-1 w-56 bg-white rounded-xl shadow-xl border border-slate-200 p-1.5 z-[60] animate-fade-in"
          data-testid="add-item-menu"
        >
          {(Object.keys(PIECE_PRESETS) as PiecePreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setOpen(false);
                onAdd(preset);
              }}
              className="w-full flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 text-left transition-colors"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                className="mt-0.5 shrink-0 text-emerald-600"
                aria-hidden="true"
              >
                <path
                  d={PRESET_ICONS[preset]}
                  fill="currentColor"
                  fillOpacity={0.2}
                  stroke="currentColor"
                  strokeWidth={1.25}
                />
              </svg>
              <span>
                <span className="block text-sm font-medium text-slate-800">
                  {preset === 'new' ? 'New item' : PIECE_PRESETS[preset].label}
                </span>
                <span className="block text-[11px] text-slate-500">{hint(preset)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface FurniturePanelProps {
  isActiveMode: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onActivate: () => void;
  items: Item[];
  warnings: Map<Id, ItemWarning>;
  selection: Selection | null;
  isMobile: boolean;
  colorPickerItemId: Id | null;
  roomDims: RoomDims;
  unitSystem: UnitSystem;
  /** Add a piece: a plain one, or a starter with a shape. */
  onAddItem: (preset?: PiecePreset) => void;
  /** Remove every piece of furniture (undoable). */
  onClearRoom: () => void;
  onSelectItem: (id: Id) => void;
  onChangeItem: (id: Id, patch: PiecePatch, commit?: boolean) => void;
  onCommit: () => void;
  onToggleLock: (id: Id) => void;
  onToggleVisibility: (id: Id) => void;
  onDeleteItem: (id: Id) => void;
  onToggleColorPicker: (id: Id) => void;
  onCloseColorPicker: () => void;
  /** The piece just added: its card is scrolled into view and briefly highlighted. */
  highlight?: CardRef | null;
}

/** Step 2 group in the sidebar: the furniture list. */
export function FurniturePanel(props: FurniturePanelProps) {
  const { isActiveMode, expanded, items } = props;
  const [confirmingClear, setConfirmingClear] = useState(false);
  const { register, isHighlighted } = useCardHighlight(props.highlight);
  return (
    <div
      className={`rounded-xl border-2 transition-all duration-300 ${
        isActiveMode ? 'border-emerald-200 bg-white shadow-xs' : 'border-slate-200 bg-slate-50'
      }`}
    >
      <StepHeader
        isActive={isActiveMode}
        expanded={expanded}
        onToggleExpanded={props.onToggleExpanded}
        icon={<Sofa className="w-4 h-4" />}
        title="Furniture"
        summary={
          <>
            {items.length} item{items.length !== 1 ? 's' : ''}
          </>
        }
        activeIcon="bg-emerald-100 text-emerald-600"
        activeText="text-emerald-800"
        activeDot="bg-emerald-600"
      />

      {!isActiveMode && expanded && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={props.onActivate}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg text-xs font-medium transition-colors"
          >
            <Unlock className="w-3 h-3" />
            Switch to Furniture Mode
          </button>
        </div>
      )}

      {(isActiveMode || expanded) && (
        <div
          className={`p-4 pt-2 space-y-4 border-t border-slate-100 ${!isActiveMode ? 'opacity-60 pointer-events-none' : ''}`}
          inert={!isActiveMode}
        >
          <div className="flex justify-end items-center gap-2">
            {confirmingClear ? (
              <>
                <span role="alert" className="text-xs text-slate-600 mr-auto">
                  Remove all {items.length} item{items.length !== 1 ? 's' : ''}?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    props.onClearRoom();
                    setConfirmingClear(false);
                  }}
                  className="text-xs bg-red-50 text-red-700 hover:bg-red-100 px-2 py-1 rounded-sm font-medium transition-colors"
                >
                  Clear all
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingClear(false)}
                  className="text-xs text-slate-500 hover:bg-slate-100 px-2 py-1 rounded-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmingClear(true)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded-sm font-medium transition-colors"
                    title="Remove all furniture and start with an empty room (you can undo)"
                  >
                    <Trash2 className="w-3 h-3" /> Clear room
                  </button>
                )}
                <AddItemMenu unitSystem={props.unitSystem} onAdd={props.onAddItem} />
              </>
            )}
          </div>

          <div className="space-y-3">
            {items.map((item) => {
              const card = { type: 'item', id: item.id } as const;
              const lit = isHighlighted(card);
              return (
                <div
                  key={item.id}
                  ref={register(card)}
                  className={`rounded-lg ${glowClass(lit, 'ring-emerald-300 ring-offset-2')}`}
                  data-highlighted={lit || undefined}
                >
                  <FurnitureCard
                    item={item}
                    warning={props.warnings.get(item.id)}
                    isSelected={props.selection?.type === 'item' && props.selection.id === item.id}
                    isMobile={props.isMobile}
                    colorPickerOpen={props.colorPickerItemId === item.id}
                    roomDims={props.roomDims}
                    unitSystem={props.unitSystem}
                    onSelect={props.onSelectItem}
                    onChange={props.onChangeItem}
                    onCommit={props.onCommit}
                    onToggleLock={props.onToggleLock}
                    onToggleVisibility={props.onToggleVisibility}
                    onDelete={props.onDeleteItem}
                    onToggleColorPicker={props.onToggleColorPicker}
                    onCloseColorPicker={props.onCloseColorPicker}
                  />
                </div>
              );
            })}
            {items.length === 0 && (
              <div className="text-center py-6 text-slate-500 text-xs italic border-2 border-dashed border-slate-200 rounded-lg">
                No furniture added. Click &quot;Add Item&quot; to start.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
