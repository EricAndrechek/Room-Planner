import { useState } from 'react';
import { Plus, Sofa, Trash2, Unlock } from 'lucide-react';
import { glowClass, useCardHighlight, type CardRef } from '../../hooks/useCardHighlight';
import type { ItemWarning } from '../../core/geometry';
import type { FurnitureItem, Id, RoomDims, Selection, UnitSystem } from '../../types';
import { FurnitureCard } from './FurnitureCard';
import { StepHeader } from './StepHeader';

interface FurniturePanelProps {
  isActiveMode: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onActivate: () => void;
  items: FurnitureItem[];
  warnings: Map<Id, ItemWarning>;
  selection: Selection | null;
  isMobile: boolean;
  colorPickerItemId: Id | null;
  roomDims: RoomDims;
  unitSystem: UnitSystem;
  onAddItem: () => void;
  /** Remove every piece of furniture (undoable). */
  onClearRoom: () => void;
  onSelectItem: (id: Id) => void;
  onChangeItem: (id: Id, patch: Partial<FurnitureItem>, commit?: boolean) => void;
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
                <button
                  type="button"
                  onClick={props.onAddItem}
                  className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-800 hover:bg-emerald-100 px-2 py-1 rounded-sm font-medium transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add Item
                </button>
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
