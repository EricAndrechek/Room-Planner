import { useId, useRef, type KeyboardEvent } from 'react';
import { CORNERS } from '../../core/schema';
import { lOutline, MIN_CUT } from '../../core/geometry/shapes';
import type { PiecePatch } from '../../lib/plans';
import type { Id, Item, UnitSystem } from '../../types';
import { DimensionInput } from './DimensionInput';
import { Segmented } from './Segmented';

type Corner = (typeof CORNERS)[number];

const SHAPE_OPTIONS = [
  { value: 'rect', label: 'Rectangle' },
  { value: 'l', label: 'L-shape' },
  { value: 'ellipse', label: 'Round' },
] as const;

const CORNER_LABELS: Record<Corner, string> = {
  tl: 'Top left',
  tr: 'Top right',
  br: 'Bottom right',
  bl: 'Bottom left',
};

/** A small L with `corner` cut away, as drawn on the corner buttons. */
function CornerIcon({ corner }: { corner: Corner }) {
  const d =
    lOutline(14, 12, { corner, width: 8, depth: 6 })
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x + 1} ${p.y + 1}`)
      .join('') + 'Z';
  return (
    <svg width="18" height="16" viewBox="0 0 16 14" aria-hidden="true">
      <path d={d} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

/**
 * Which corner of an L is cut: four small radio buttons, each drawing the L it gives. Arrow keys
 * move between them and pick (as in `Segmented`); Tab enters at the selected one.
 */
function CornerPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Corner;
  onChange: (corner: Corner) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, CORNERS.indexOf(value));
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!delta) return;
    e.preventDefault();
    // Arrow keys in the sidebar must not reach the canvas shortcuts.
    e.stopPropagation();
    const next = (current + delta + CORNERS.length) % CORNERS.length;
    refs.current[next]?.focus();
    onChange(CORNERS[next]!);
  };
  return (
    <div role="radiogroup" aria-label={label} className="flex bg-slate-100 rounded-sm p-0.5">
      {CORNERS.map((corner, i) => {
        const on = i === current;
        return (
          <button
            key={corner}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={CORNER_LABELS[corner]}
            title={CORNER_LABELS[corner]}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(corner)}
            onKeyDown={onKeyDown}
            className={`flex-1 flex items-center justify-center py-1 rounded-sm transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-500 ${
              on ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
            }`}
            data-corner={corner}
          >
            <CornerIcon corner={corner} />
          </button>
        );
      })}
    </div>
  );
}

interface PieceShapeFieldsProps {
  item: Item;
  unitSystem: UnitSystem;
  onChange: (id: Id, patch: PiecePatch) => void;
}

/**
 * A furniture card's Shape control (Rectangle, L-shape, Round: the same box either way) and, for
 * an L, which corner is cut and the size of the cut.
 */
export function PieceShapeFields({ item, unitSystem, onChange }: PieceShapeFieldsProps) {
  const uid = useId();
  const cut = item.shape === 'l' ? item.cut : undefined;
  return (
    <div className="space-y-2 mb-3" data-testid="piece-shape-fields">
      <div>
        <span className="block text-[10px] text-slate-500 mb-0.5" aria-hidden="true">
          Shape
        </span>
        <Segmented
          label={`Shape of ${item.label}`}
          options={SHAPE_OPTIONS}
          value={item.shape}
          onChange={(shape) => {
            if (shape !== item.shape) onChange(item.id, { shape });
          }}
          ring="focus-visible:ring-emerald-500"
          activeText="text-emerald-700"
        />
      </div>
      {cut && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <span className="block text-[10px] text-slate-500 mb-0.5" aria-hidden="true">
              Cut corner
            </span>
            <CornerPicker
              label={`Cut corner of ${item.label}`}
              value={cut.corner}
              onChange={(corner) => {
                if (corner !== cut.corner) onChange(item.id, { cut: { corner } });
              }}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-cut-width`} className="text-[10px] text-slate-500">
              Cut width
            </label>
            <DimensionInput
              value={cut.width}
              onChange={(val) => onChange(item.id, { cut: { width: val } })}
              className="w-full p-1.5 text-xs border border-slate-200 rounded-sm"
              min={MIN_CUT}
              max={item.width - MIN_CUT}
              label={`Cut width of ${item.label}`}
              id={`${uid}-cut-width`}
              unitSystem={unitSystem}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-cut-depth`} className="text-[10px] text-slate-500">
              Cut depth
            </label>
            <DimensionInput
              value={cut.depth}
              onChange={(val) => onChange(item.id, { cut: { depth: val } })}
              className="w-full p-1.5 text-xs border border-slate-200 rounded-sm"
              min={MIN_CUT}
              max={item.depth - MIN_CUT}
              label={`Cut depth of ${item.label}`}
              id={`${uid}-cut-depth`}
              unitSystem={unitSystem}
            />
          </div>
        </div>
      )}
    </div>
  );
}
