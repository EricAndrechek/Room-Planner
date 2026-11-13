import { ChevronDown, ChevronUp, Lock, Plus, Sofa, Unlock } from 'lucide-react';
import type { ItemWarning } from '../../lib/geometry';
import type { FurnitureItem, Id, RoomDims, Selection, UnitSystem } from '../../types';
import { FurnitureCard } from './FurnitureCard';

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
  onSelectItem: (id: Id) => void;
  onChangeItem: (id: Id, patch: Partial<FurnitureItem>, commit?: boolean) => void;
  onCommit: () => void;
  onToggleLock: (id: Id) => void;
  onToggleVisibility: (id: Id) => void;
  onDeleteItem: (id: Id) => void;
  onToggleColorPicker: (id: Id) => void;
  onCloseColorPicker: () => void;
}

/** Step 2 group in the sidebar: the furniture list. */
export function FurniturePanel(props: FurniturePanelProps) {
  const { isActiveMode, expanded, items } = props;
  return (
    <div
      className={`rounded-xl border-2 transition-all duration-300 ${
        isActiveMode ? 'border-emerald-200 bg-white shadow-xs' : 'border-slate-200 bg-slate-50'
      }`}
    >
      <button
        type="button"
        onClick={() => !isActiveMode && props.onToggleExpanded()}
        className={`w-full flex items-center justify-between p-3 ${
          !isActiveMode ? 'cursor-pointer hover:bg-slate-100' : 'cursor-default'
        } rounded-t-xl transition-colors`}
        aria-expanded={isActiveMode || expanded}
      >
        <div className="flex items-center gap-2">
          <div
            className={`p-1.5 rounded-lg ${isActiveMode ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}
          >
            <Sofa className="w-4 h-4" />
          </div>
          <div className="text-left">
            <span className="text-sm font-semibold text-slate-700 block">Furniture</span>
            <span className="text-[10px] text-slate-500">
              {items.length} item{items.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isActiveMode && (
            <>
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Locked
              </span>
              {expanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </>
          )}
          {isActiveMode && (
            <span className="text-[10px] text-emerald-600 font-medium px-2 py-0.5 bg-emerald-100 rounded-full">
              Editing
            </span>
          )}
        </div>
      </button>

      {!isActiveMode && expanded && (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={props.onActivate}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded-lg text-xs font-medium transition-colors"
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
          <div className="flex justify-end">
            <button
              type="button"
              onClick={props.onAddItem}
              className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-2 py-1 rounded-sm font-medium transition-colors"
              aria-label="Add new furniture item"
            >
              <Plus className="w-3 h-3" /> Add Item
            </button>
          </div>

          <div className="space-y-3">
            {items.map((item) => (
              <FurnitureCard
                key={item.id}
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
            ))}
            {items.length === 0 && (
              <div className="text-center py-6 text-slate-400 text-xs italic border-2 border-dashed border-slate-200 rounded-lg">
                No furniture added. Click &quot;Add Item&quot; to start.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
