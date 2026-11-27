import {
  memo,
  useId,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { AlertTriangle, DoorOpen, Lock, RotateCw } from 'lucide-react';
import { blendOnWhite, getBorderColor, migrateColor, readableTextOn } from '../../core/colors';
import { PIXELS_PER_UNIT } from '../../lib/constants';
import { warningText, type ItemWarning } from '../../core/geometry';
import { isL, labelArea, lOutline } from '../../core/geometry/shapes';
import { feetToDisplay } from '../../core/units';
import { boxOf, doorBlockText } from '../../lib/plans';
import type { Item, UnitSystem } from '../../types';

interface FurniturePieceProps {
  item: Item;
  warning: ItemWarning | undefined;
  isActive: boolean;
  /**
   * Room setup: the room is what is being edited, so furniture is drawn faded (still selectable and
   * movable) and stays under the door, window, corner and room handles where they overlap.
   */
  dimmed: boolean;
  unitSystem: UnitSystem;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, item: Item) => void;
  onRotatePointerDown: (e: ReactPointerEvent<HTMLDivElement>, item: Item) => void;
  onSelect: (item: Item) => void;
  /** Canvas zoom: the rotate handle keeps a constant on-screen size. */
  zoom: number;
  /** A warning badge was pressed: explain it (WarningPopover). Without it the badges are static. */
  onExplain?: (item: Item) => void;
  /** This piece's warning is being explained (the badge's `aria-expanded`). */
  explaining?: boolean;
}

/** Furniture is drawn at this opacity while the room is being edited (the selected piece is not). */
const DIMMED_ALPHA = 0.5;
/**
 * Room setup: pieces stay under the opening handles (z 20) and the corner handles (z 30+). Warning
 * badges go above every piece (one more than the selected one; in Items, above the measurements at
 * z 60 too), so a neighbour or a guide never hides them.
 */
const DIMMED_Z = { idle: 10, active: 18 };

const SHADOW_ACTIVE = '0 8px 20px -4px rgba(0, 0, 0, 0.15)';
const SHADOW = '0 1px 3px rgba(0, 0, 0, 0.08)';

/** The shape in the piece's accessible name ("Sofa, L-shaped, 9' by 7', …"); nothing for a rectangle. */
const shapeWords = (item: Item) =>
  item.shape === 'l' ? 'L-shaped, ' : item.shape === 'ellipse' ? 'round, ' : '';

/**
 * An L drawn in its box: the outline filled, its border drawn inside it (as a CSS border is), and
 * a focus ring outside it shown on keyboard focus (global.css). Only the painted shape takes the
 * pointer, so a press in the notch goes to whatever is under it.
 */
function LShape({
  item,
  width,
  height,
  fill,
  border,
  active,
}: {
  item: Item & { cut: NonNullable<Item['cut']> };
  width: number;
  height: number;
  fill: string;
  border: { color: string; width: number; dashed: boolean };
  active: boolean;
}) {
  const clip = `piece-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const s = width / item.width;
  const d =
    lOutline(item.width, item.depth, item.cut)
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x * s} ${p.y * s}`)
      .join('') + 'Z';
  const bw = border.width;
  return (
    <svg
      className="absolute inset-0 overflow-visible"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        pointerEvents: 'none',
        filter: `drop-shadow(${active ? '0 8px 10px rgba(0, 0, 0, 0.15)' : '0 1px 2px rgba(0, 0, 0, 0.1)'})`,
      }}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clip}>
          <path d={d} />
        </clipPath>
      </defs>
      <g className="piece-focus-ring" fill="none" strokeLinejoin="round">
        <path d={d} stroke="#4f46e5" strokeWidth={10} />
        <path d={d} stroke="#fff" strokeWidth={4} />
      </g>
      <path
        d={d}
        fill={fill}
        stroke={border.color}
        strokeWidth={bw * 2}
        strokeDasharray={border.dashed ? `${bw * 3} ${bw * 2}` : undefined}
        clipPath={`url(#${clip})`}
        style={{ pointerEvents: 'visiblePainted' }}
        data-testid="piece-shape"
      />
    </svg>
  );
}

/** One piece of furniture on the canvas, with its rotation handle when selected. */
export const FurniturePiece = memo(function FurniturePiece({
  item,
  warning,
  isActive,
  dimmed,
  unitSystem,
  onPointerDown,
  onRotatePointerDown,
  onSelect,
  zoom,
  onExplain,
  explaining = false,
}: FurniturePieceProps) {
  const descId = useId();
  const isItemLocked = !!item.locked;
  const isLocked = isItemLocked;
  const color = migrateColor(item.color);
  // Room setup fades the fill (not the label, which keeps full contrast on the faded color); the
  // piece being moved or edited shows in full.
  const faded = dimmed && !isActive;
  const fill = faded ? blendOnWhite(color, DIMMED_ALPHA) : color;
  const hasWarning = !!warning && (warning.outOfBounds || warning.collision);
  // Softer (amber) than the red overlap warning: in a door's way.
  const doorBlock =
    !!warning && (warning.blocksDoor || warning.blocksDoorway)
      ? doorBlockText({ door: !!warning.blocksDoor, doorway: !!warning.blocksDoorway })
      : '';

  let borderColor = faded
    ? blendOnWhite(getBorderColor(color), DIMMED_ALPHA)
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
  } else if (isItemLocked) {
    borderColor = '#d97706'; // amber-600
    borderWidth = '3px';
  }

  // Positioned like the piece; the warning badges sit outside the button (they are not part of its
  // name: the button's description says it), as buttons of their own that explain them.
  const z = dimmed ? DIMMED_Z[isActive ? 'active' : 'idle'] : isActive ? 50 : 10;
  // Warning badges keep their size on screen at any zoom (a 24px target): centred on their spot,
  // counter-scaled (`zoom` reaches every flagged piece, see RoomCanvas).
  const badgeAt = (fx: number, fy: number) => ({
    transform: `translate(${fx * 100}%, ${fy * 100}%) scale(${1 / zoom})`,
  });
  const box = boxOf(item);
  const frame = {
    width: box.width * PIXELS_PER_UNIT,
    height: box.height * PIXELS_PER_UNIT,
    transform: `translate(${box.x * PIXELS_PER_UNIT}px, ${box.y * PIXELS_PER_UNIT}px) rotate(${box.rotation}deg)`,
  };
  // An ellipse is the box with round corners (borders, shadow, focus ring and hit area follow
  // them); an L draws its outline in an SVG and the box itself paints nothing.
  const lShape = isL(item) ? item : null;
  const round = item.shape === 'ellipse';
  const area = labelArea(item);
  const shapeStyle = lShape
    ? { pointerEvents: 'none' as const, boxShadow: 'none' }
    : {
        backgroundColor: fill,
        borderColor,
        borderWidth,
        borderStyle,
        borderRadius: round ? '50%' : undefined,
        boxShadow: isActive && !isLocked ? SHADOW_ACTIVE : SHADOW,
      };
  return (
    <>
      <div
        onPointerDown={(e) => onPointerDown(e, item)}
        onClick={() => onSelect(item)}
        className={`absolute flex items-center justify-center text-xs font-bold select-none transition-shadow ${round || lShape ? '' : 'rounded-md'} ${
          isItemLocked ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
        }`}
        style={{
          ...frame,
          ...shapeStyle,
          color: readableTextOn(fill),
          zIndex: z,
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
          }
        }}
        role="button"
        tabIndex={0}
        aria-pressed={isActive}
        data-draggable
        data-item-id={item.id}
        data-shape={item.shape}
        aria-label={`${item.label}, ${shapeWords(item)}${feetToDisplay(box.width, unitSystem)} by ${feetToDisplay(box.height, unitSystem)}, at ${feetToDisplay(box.x, unitSystem)}, ${feetToDisplay(box.y, unitSystem)}, rotated ${Math.round(box.rotation)}°`}
        aria-describedby={descId}
      >
        <span id={descId} className="sr-only">
          {[
            isItemLocked
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
        {lShape && (
          <LShape
            item={lShape}
            width={frame.width}
            height={frame.height}
            fill={fill}
            border={{
              color: borderColor,
              width: parseFloat(borderWidth),
              dashed: borderStyle === 'dashed',
            }}
            active={isActive && !isLocked}
          />
        )}
        {lShape || round ? (
          // The name sits in the label area: an L's larger part, the rectangle inside an ellipse.
          <span
            className="absolute flex items-center justify-center pointer-events-none"
            style={{
              left: area.x * PIXELS_PER_UNIT,
              top: area.y * PIXELS_PER_UNIT,
              width: area.width * PIXELS_PER_UNIT,
              height: area.height * PIXELS_PER_UNIT,
            }}
            aria-hidden="true"
          >
            <span className="truncate px-1">{item.label}</span>
          </span>
        ) : (
          <span className="truncate px-1" aria-hidden="true">
            {item.label}
          </span>
        )}

        {/* Lock badge: a piece the user locked with its padlock */}
        {isItemLocked && (
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
      {(hasWarning || doorBlock) && (
        <div
          className="absolute pointer-events-none"
          style={{ ...frame, zIndex: dimmed ? DIMMED_Z.active + 1 : 61 }}
          data-testid="piece-badges"
        >
          {hasWarning && (
            <WarningBadge
              className="absolute left-0 top-0 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center shadow-md"
              style={badgeAt(-0.5, -0.5)}
              label={`${item.label}: ${warningText(warning, true)}. What does this mean?`}
              title={warningText(warning, true)}
              testId="warning-badge"
              onPress={onExplain && (() => onExplain(item))}
              expanded={explaining}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-white" aria-hidden="true" />
            </WarningBadge>
          )}
          {doorBlock && (
            <WarningBadge
              className="absolute left-1/2 top-full flex min-h-6 items-center gap-0.5 whitespace-nowrap rounded-full border border-amber-500 bg-amber-100 px-2 text-[10px] leading-4 font-semibold text-amber-900 shadow-sm"
              style={badgeAt(-0.5, -0.5)}
              label={`${item.label}: ${doorBlock}. What does this mean?`}
              testId="door-block-badge"
              onPress={onExplain && (() => onExplain(item))}
              expanded={explaining}
            >
              <DoorOpen className="w-3 h-3" aria-hidden="true" />
              {doorBlock}
            </WarningBadge>
          )}
        </div>
      )}
    </>
  );
});

/**
 * A warning badge on a piece: a button that explains the warning (and offers the fix) when the
 * planner can, else a plain marker. Its press never starts a drag or a pan.
 */
function WarningBadge({
  className,
  style,
  label,
  title,
  testId,
  onPress,
  expanded,
  children,
}: {
  className: string;
  style: CSSProperties;
  label: string;
  title?: string;
  testId: string;
  onPress?: () => void;
  expanded: boolean;
  children: ReactNode;
}) {
  if (!onPress) {
    return (
      <div
        className={className}
        style={style}
        title={title}
        aria-hidden="true"
        data-testid={testId}
      >
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      style={style}
      className={`${className} touch-hit pointer-events-auto cursor-pointer hover:brightness-95 focus-visible:ring-2 focus-visible:ring-indigo-500 outline-hidden`}
      title={title}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
      data-draggable
      data-testid={testId}
    >
      {children}
    </button>
  );
}
