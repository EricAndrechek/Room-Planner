import { memo, useId, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, DoorOpen, Lock, RotateCw } from 'lucide-react';
import { blendOnWhite, getBorderColor, migrateColor, readableTextOn } from '../../lib/colors';
import { PIXELS_PER_UNIT } from '../../lib/constants';
import { warningText, type ItemWarning } from '../../lib/geometry';
import { doorBlockText } from '../../lib/openings';
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
  /** Enter/Space on a piece that room setup locks (to explain why it does not move). */
  onLockedPress?: (item: FurnitureItem) => void;
  /** Canvas zoom: the rotate handle keeps a constant on-screen size. */
  zoom: number;
}

/** Furniture is drawn at this opacity while the room is being edited (and furniture is locked). */
const MODE_LOCKED_ALPHA = 0.5;

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
  onLockedPress,
  zoom,
}: FurniturePieceProps) {
  const descId = useId();
  const isItemLocked = !!item.locked;
  const isLocked = modeLocked || isItemLocked;
  const color = migrateColor(item.color);
  // Room setup fades the fill (not the label, which keeps full contrast on the faded color).
  const fill = modeLocked ? blendOnWhite(color, MODE_LOCKED_ALPHA) : color;
  const hasWarning = !!warning && (warning.outOfBounds || warning.collision);
  // Softer (amber) than the red overlap warning: in a door's way.
  const doorBlock =
    !!warning && (warning.blocksDoor || warning.blocksDoorway)
      ? doorBlockText({ door: !!warning.blocksDoor, doorway: !!warning.blocksDoorway })
      : '';

  let borderColor = modeLocked
    ? blendOnWhite(getBorderColor(color), MODE_LOCKED_ALPHA)
    : getBorderColor(color);
  let borderWidth = '2px';
  let borderStyle = 'solid';
  if (hasWarning) {
    borderColor = '#ef4444'; // red-500
    borderWidth = '3px';
  } else if (doorBlock) {
    borderColor = '#d97706'; // amber-600, dashed: distinct from a locked piece's solid amber
    borderWidth = '2px';
    borderStyle = 'dashed';
  } else if (isItemLocked && !modeLocked) {
    borderColor = '#d97706'; // amber-600
    borderWidth = '3px';
  }

  // Positioned like the piece; the amber note sits outside the button (it is not part of its
  // name: the button's description says it).
  const frame = {
    width: item.width * PIXELS_PER_UNIT,
    height: item.height * PIXELS_PER_UNIT,
    transform: `translate(${item.x * PIXELS_PER_UNIT}px, ${item.y * PIXELS_PER_UNIT}px) rotate(${item.rotation}deg)`,
  };
  return (
    <>
      <div
        onPointerDown={(e) => onPointerDown(e, item)}
        onClick={() => onSelect(item)}
        className={`absolute flex items-center justify-center text-xs font-bold select-none transition-shadow rounded-md ${
          modeLocked
            ? 'cursor-not-allowed'
            : isItemLocked
              ? 'cursor-pointer'
              : 'cursor-grab active:cursor-grabbing'
        }`}
        style={{
          width: item.width * PIXELS_PER_UNIT,
          height: item.height * PIXELS_PER_UNIT,
          transform: `translate(${item.x * PIXELS_PER_UNIT}px, ${item.y * PIXELS_PER_UNIT}px) rotate(${item.rotation}deg)`,
          backgroundColor: fill,
          color: readableTextOn(fill),
          borderColor,
          borderWidth,
          borderStyle,
          zIndex: isActive ? 50 : 10,
          boxShadow:
            isActive && !isLocked
              ? '0 8px 20px -4px rgba(0, 0, 0, 0.15)'
              : '0 1px 3px rgba(0, 0, 0, 0.08)',
          touchAction: 'none',
        }}
        onFocus={() => {
          if (!isActive) onSelect(item);
        }}
        onKeyDown={(e) => {
          // Enter/Space "press" the piece (selecting it); arrows, R and Delete are global shortcuts.
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault();
            onSelect(item);
            if (modeLocked) onLockedPress?.(item);
          }
        }}
        role="button"
        tabIndex={0}
        aria-pressed={isActive}
        data-draggable
        data-item-id={item.id}
        aria-label={`${item.label}, ${feetToDisplay(item.width, unitSystem)} by ${feetToDisplay(item.height, unitSystem)}, at ${feetToDisplay(item.x, unitSystem)}, ${feetToDisplay(item.y, unitSystem)}, rotated ${Math.round(item.rotation)}°`}
        aria-describedby={descId}
      >
        <span id={descId} className="sr-only">
          {[
            modeLocked
              ? 'Locked while editing the room.'
              : isItemLocked
                ? 'Locked; unlock it in the furniture list to move it.'
                : 'Arrow keys move, R rotates, Alt or Option with R turns by 1 degree, Delete removes.',
            warning?.outOfBounds ? 'Outside the room.' : '',
            warning?.collision ? 'Overlapping other furniture.' : '',
            warning?.blocksDoor
              ? "In a door's way."
              : warning?.blocksDoorway
                ? 'In a doorway.'
                : '',
          ]
            .filter(Boolean)
            .join(' ')}
        </span>
        <span className="truncate px-1" aria-hidden="true">
          {item.label}
        </span>

        {hasWarning && (
          <div
            className="absolute -top-2 -left-2 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow-md"
            title={warningText(warning, true)}
            aria-hidden="true"
          >
            <AlertTriangle className="w-3 h-3 text-white" />
          </div>
        )}

        {/* Lock badge: grey while the mode locks all furniture, amber for an individually locked item */}
        {modeLocked && (
          <div
            className="absolute -top-2 -right-2 w-5 h-5 bg-slate-600 rounded-full flex items-center justify-center shadow-md"
            aria-hidden="true"
          >
            <Lock className="w-3 h-3 text-white" />
          </div>
        )}
        {isItemLocked && !modeLocked && (
          <div
            className="absolute -top-2 -right-2 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center shadow-md"
            aria-hidden="true"
          >
            <Lock className="w-3 h-3 text-white" />
          </div>
        )}

        {isActive && !isLocked && (
          // Counter-scaled by the zoom so the handle is the same size on screen at every zoom; on
          // touch screens its hit area grows to 44px (.touch-hit) without a bigger knob.
          <div
            className="absolute bottom-full left-1/2 w-8 h-8 z-50 pointer-events-none"
            style={{
              transform: `translateX(-50%) scale(${1 / zoom})`,
              transformOrigin: '50% 100%',
            }}
          >
            <div className="absolute bottom-0 left-1/2 h-full w-0.5 -translate-x-1/2 bg-emerald-500" />
            <div
              onPointerDown={(e) => onRotatePointerDown(e, item)}
              className="touch-hit pointer-events-auto absolute top-0 left-1/2 -translate-x-1/2 w-8 h-8 md:w-6 md:h-6 bg-white border-2 border-emerald-500 rounded-full flex items-center justify-center cursor-crosshair hover:scale-110 transition-all shadow-md"
              style={{ touchAction: 'none' }}
              aria-hidden="true"
              data-testid="rotate-handle"
              data-draggable
            >
              <RotateCw className="w-4 h-4 md:w-3 md:h-3 text-emerald-600" />
            </div>
          </div>
        )}
      </div>
      {doorBlock && (
        <div
          className="absolute pointer-events-none"
          style={{ ...frame, zIndex: isActive ? 51 : 11 }}
          aria-hidden="true"
        >
          <div
            className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 whitespace-nowrap rounded-full border border-amber-500 bg-amber-100 px-1.5 text-[10px] leading-4 font-semibold text-amber-900 shadow-sm"
            data-testid="door-block-badge"
          >
            <DoorOpen className="w-2.5 h-2.5" />
            {doorBlock}
          </div>
        </div>
      )}
    </>
  );
});
