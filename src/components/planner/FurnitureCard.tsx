import { memo, useRef } from 'react';
import { AlertTriangle, Eye, EyeOff, Lock, Trash2, Unlock } from 'lucide-react';
import { migrateColor } from '../../lib/colors';
import { normalizeDegrees, warningText, type ItemWarning } from '../../lib/geometry';
import { clamp } from '../../lib/units';
import type { FurnitureItem, Id, RoomDims, UnitSystem } from '../../types';
import { ColorPicker } from './ColorPicker';
import { DimensionInput } from './DimensionInput';
import { Tooltip } from './Tooltip';

interface FurnitureCardProps {
  item: FurnitureItem;
  warning: ItemWarning | undefined;
  isSelected: boolean;
  isMobile: boolean;
  colorPickerOpen: boolean;
  roomDims: RoomDims;
  unitSystem: UnitSystem;
  onSelect: (id: Id) => void;
  /** `commit: false` for keystroke-level edits that are committed on blur. */
  onChange: (id: Id, patch: Partial<FurnitureItem>, commit?: boolean) => void;
  onCommit: () => void;
  onToggleLock: (id: Id) => void;
  onToggleVisibility: (id: Id) => void;
  onDelete: (id: Id) => void;
  onToggleColorPicker: (id: Id) => void;
  onCloseColorPicker: () => void;
}

/** A furniture entry in the sidebar: label, color, lock/visibility, size, position and rotation. */
export const FurnitureCard = memo(function FurnitureCard({
  item,
  warning,
  isSelected,
  isMobile,
  colorPickerOpen,
  roomDims,
  unitSystem,
  onSelect,
  onChange,
  onCommit,
  onToggleLock,
  onToggleVisibility,
  onDelete,
  onToggleColorPicker,
  onCloseColorPicker,
}: FurnitureCardProps) {
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const isItemLocked = !!item.locked;
  const hidden = item.visible === false;
  const hasWarning = !hidden && !!warning && (warning.outOfBounds || warning.collision);
  const text = warning ? warningText(warning) : '';
  const color = migrateColor(item.color);

  return (
    <div
      className={`p-3 bg-white rounded-lg border transition-all duration-200 cursor-pointer hover:border-emerald-300 ${hidden ? 'opacity-60 border-dashed' : 'border-slate-200'} ${isSelected ? 'ring-2 ring-emerald-500' : ''} ${isItemLocked ? 'bg-slate-50' : ''} ${hasWarning ? 'border-red-300 bg-red-50/50' : ''} overflow-hidden`}
      onClick={() => onSelect(item.id)}
      data-testid="furniture-card"
    >
      <div className="flex justify-between items-center mb-3 gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0 relative">
          {hasWarning && (
            <div className="w-5 h-5 bg-red-100 rounded-sm flex items-center justify-center shrink-0" title={text}>
              <AlertTriangle className="w-3 h-3 text-red-500" />
            </div>
          )}
          {isItemLocked && !hasWarning && (
            <div className="w-5 h-5 bg-amber-100 rounded-sm flex items-center justify-center shrink-0" title="Locked">
              <Lock className="w-3 h-3 text-amber-600" />
            </div>
          )}
          <button
            type="button"
            ref={colorButtonRef}
            onClick={(e) => {
              e.stopPropagation();
              if (!isItemLocked) onToggleColorPicker(item.id);
            }}
            className={`w-6 h-6 rounded-full border-2 border-slate-300 transition-colors shrink-0 ${isItemLocked ? 'cursor-not-allowed opacity-60' : 'hover:border-emerald-500 cursor-pointer'}`}
            style={{ backgroundColor: color }}
            aria-label="Change item color"
            data-color-button
            disabled={isItemLocked}
          />
          {!isMobile && colorPickerOpen && !isItemLocked && (
            <ColorPicker
              currentColor={color}
              onChange={(c) => onChange(item.id, { color: c })}
              onClose={onCloseColorPicker}
              triggerRef={colorButtonRef}
            />
          )}
          <input
            value={item.label}
            onChange={(e) => onChange(item.id, { label: e.target.value }, false)}
            onBlur={onCommit}
            onClick={(e) => e.stopPropagation()}
            className={`bg-transparent font-medium text-slate-700 border-b border-transparent outline-hidden min-w-0 flex-1 text-sm truncate ${isItemLocked ? 'cursor-not-allowed' : 'hover:border-slate-300 focus:border-emerald-500'}`}
            aria-label="Item label"
            readOnly={isItemLocked}
          />
        </div>
        <div className="flex items-center shrink-0">
          <Tooltip text={isItemLocked ? 'Unlock' : 'Lock'}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock(item.id);
              }}
              className={`p-1.5 rounded-sm transition-colors flex items-center justify-center ${isItemLocked ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'}`}
              aria-label={isItemLocked ? `Unlock ${item.label}` : `Lock ${item.label}`}
            >
              {isItemLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            </button>
          </Tooltip>
          <Tooltip text={!hidden ? 'Hide' : 'Show'}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisibility(item.id);
              }}
              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-sm transition-colors flex items-center justify-center"
              aria-label={!hidden ? `Hide ${item.label}` : `Show ${item.label}`}
            >
              {!hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
          </Tooltip>
          <Tooltip text="Delete">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item.id);
              }}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-sm transition-colors flex items-center justify-center"
              aria-label={`Delete ${item.label}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {hasWarning && (
        <div className="mb-2 py-1.5 px-2 bg-red-50 border border-red-200 rounded-sm text-center">
          <p className="text-[10px] text-red-600 flex items-center justify-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {text}
          </p>
        </div>
      )}

      {isItemLocked ? (
        <div className="py-3 px-2 bg-amber-50 border border-amber-200 rounded-lg text-center">
          <p className="text-xs text-amber-700 flex items-center justify-center gap-1.5">
            <Lock className="w-3 h-3" />
            Position and size locked
          </p>
          <p className="text-[10px] text-amber-600 mt-1">Click the lock icon to unlock</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-500">Width</label>
              <DimensionInput
                value={item.width}
                onChange={(val) => onChange(item.id, { width: val })}
                className="w-full p-1.5 text-xs border border-slate-200 rounded-sm"
                min={0.1}
                max={roomDims.width}
                label={`Width of ${item.label}`}
                unitSystem={unitSystem}
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">Depth</label>
              <DimensionInput
                value={item.height}
                onChange={(val) => onChange(item.id, { height: val })}
                className="w-full p-1.5 text-xs border border-slate-200 rounded-sm"
                min={0.1}
                max={roomDims.height}
                label={`Depth of ${item.label}`}
                unitSystem={unitSystem}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mt-3">
            <div>
              <label className="text-[10px] text-slate-500">X Position</label>
              <DimensionInput
                value={item.x}
                onChange={(val) => onChange(item.id, { x: clamp(val, 0, roomDims.width - item.width) })}
                className="w-full p-1.5 text-xs border border-slate-200 rounded-sm"
                min={0}
                max={roomDims.width - item.width}
                label={`X position of ${item.label}`}
                unitSystem={unitSystem}
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">Y Position</label>
              <DimensionInput
                value={item.y}
                onChange={(val) => onChange(item.id, { y: clamp(val, 0, roomDims.height - item.height) })}
                className="w-full p-1.5 text-xs border border-slate-200 rounded-sm"
                min={0}
                max={roomDims.height - item.height}
                label={`Y position of ${item.label}`}
                unitSystem={unitSystem}
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500">Rotation °</label>
              <input
                type="number"
                value={Math.round(normalizeDegrees(item.rotation))}
                onChange={(e) => onChange(item.id, { rotation: parseFloat(e.target.value) || 0 }, false)}
                onBlur={onCommit}
                className="w-full p-1.5 text-xs border border-slate-200 rounded-sm focus:ring-2 focus:ring-emerald-500 outline-hidden"
                min={0}
                max={360}
                step={1}
                aria-label={`Rotation of ${item.label}`}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
});
