import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, Lock, RotateCw } from 'lucide-react';
import { getBorderColor, migrateColor } from '../../lib/colors';
import { PIXELS_PER_UNIT } from '../../lib/constants';
import { warningText, type ItemWarning } from '../../lib/geometry';
import { feetToDisplay } from '../../lib/units';
import type { FurnitureItem, UnitSystem } from '../../types';

interface FurniturePieceProps {
  item: FurnitureItem;
  warning: ItemWarning | undefined;
  isActive: boolean;
  /** All furniture is locked during room setup. */
  modeLocked: boolean;
  unitSystem: UnitSystem;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, item: FurnitureItem) => void;
  onRotatePointerDown: (e: ReactPointerEvent<HTMLDivElement>, item: FurnitureItem) => void;
  onSelect: (item: FurnitureItem) => void;
}

/** One piece of furniture on the canvas, with its rotation handle when selected. */
export const FurniturePiece = memo(function FurniturePiece({
  item,
  warning,
  isActive,
  modeLocked,
  unitSystem,
  onPointerDown,
  onRotatePointerDown,
  onSelect,
}: FurniturePieceProps) {
  const isItemLocked = !!item.locked;
  const isLocked = modeLocked || isItemLocked;
  const color = migrateColor(item.color);
  const hasWarning = !!warning && (warning.outOfBounds || warning.collision);

  let borderColor = getBorderColor(color);
  let borderWidth = '2px';
  if (hasWarning) {
    borderColor = '#ef4444'; // red-500
    borderWidth = '3px';
  } else if (isItemLocked && !modeLocked) {
    borderColor = '#d97706'; // amber-600
    borderWidth = '3px';
  }

  return (
    <div
      onPointerDown={(e) => onPointerDown(e, item)}
      onClick={() => onSelect(item)}
      className={`absolute flex items-center justify-center text-xs font-bold text-slate-700 select-none transition-shadow rounded-md ${
        modeLocked
          ? 'cursor-not-allowed opacity-50'
          : isItemLocked
            ? 'cursor-pointer'
            : 'cursor-grab active:cursor-grabbing'
      }`}
      style={{
        width: item.width * PIXELS_PER_UNIT,
        height: item.height * PIXELS_PER_UNIT,
        transform: `translate(${item.x * PIXELS_PER_UNIT}px, ${item.y * PIXELS_PER_UNIT}px) rotate(${item.rotation}deg)`,
        backgroundColor: color,
        borderColor,
        borderWidth,
        borderStyle: 'solid',
        zIndex: isActive ? 50 : 10,
        boxShadow:
          isActive && !isLocked
            ? '0 8px 20px -4px rgba(0, 0, 0, 0.15)'
            : '0 1px 3px rgba(0, 0, 0, 0.08)',
        touchAction: 'none',
      }}
      role="button"
      tabIndex={0}
      data-draggable
      data-item-id={item.id}
      aria-label={`${item.label}, ${feetToDisplay(item.width, unitSystem)} by ${feetToDisplay(item.height, unitSystem)}${isLocked ? ' (locked)' : ''}${hasWarning ? ' (warning)' : ''}`}
    >
      <span className="truncate px-1">{item.label}</span>

      {hasWarning && (
        <div
          className="absolute -top-2 -left-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow-md"
          title={warningText(warning, true)}
        >
          <AlertTriangle className="w-3 h-3 text-white" />
        </div>
      )}

      {/* Lock badge: grey while the mode locks all furniture, amber for an individually locked item */}
      {modeLocked && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-slate-600 rounded-full flex items-center justify-center shadow-md">
          <Lock className="w-3 h-3 text-white" />
        </div>
      )}
      {isItemLocked && !modeLocked && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center shadow-md">
          <Lock className="w-3 h-3 text-white" />
        </div>
      )}

      {isActive && !isLocked && (
        <>
          <div
            onPointerDown={(e) => onRotatePointerDown(e, item)}
            className="absolute -top-8 left-1/2 -translate-x-1/2 w-8 h-8 md:w-6 md:h-6 bg-white border-2 border-emerald-500 rounded-full flex items-center justify-center cursor-crosshair hover:scale-110 transition-all z-50 shadow-md"
            style={{ touchAction: 'none' }}
            aria-label="Rotate handle"
            data-draggable
          >
            <RotateCw className="w-4 h-4 md:w-3 md:h-3 text-emerald-500" />
          </div>
          <div className="absolute -top-8 left-1/2 h-8 w-0.5 -z-10 origin-bottom transition-colors bg-emerald-500" />
        </>
      )}
    </div>
  );
});
