import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Archive, GripVertical, Trash2 } from 'lucide-react';
import { migrateColor } from '../../core/colors';
import { feetToDisplay } from '../../core/units';
import { glowClass, useCardHighlight, type CardRef } from '../../hooks/useCardHighlight';
import type { Id, Item, UnitSystem } from '../../types';
import { pieceName } from './PieceActions';
import { Tooltip } from './Tooltip';

interface SetAsideListProps {
  /** The pieces set aside (no placement), in plan order. */
  items: Item[];
  unitSystem: UnitSystem;
  /** Place: with the keyboard (`keyboard`), straight into a free spot; else tap the plan. */
  onPlace: (id: Id, keyboard: boolean) => void;
  /** A press on a row (or its grip) that may become a drag onto the plan. */
  onDragStart: (e: ReactPointerEvent<HTMLElement>, item: Item) => void;
  onDelete: (id: Id) => void;
  /** The piece waiting to be placed (tap-to-place): its row is marked. */
  placingId?: Id | null;
  /** Where the focus goes when the last row leaves (the "Set aside" tab). */
  fallbackFocus?: RefObject<HTMLElement | null>;
  /** The piece just set aside: its row is scrolled into view and glows. */
  highlight?: CardRef | null;
}

/**
 * The pieces set aside (docs/design/plan-format.md, sections 3 and 9: the inventory), kept with
 * their name, size and colour until they go back on the plan: dragged there and dropped where they
 * should be, or "Place" and a tap on the plan.
 */
export function SetAsideList({
  items,
  unitSystem,
  onPlace,
  onDragStart,
  onDelete,
  placingId,
  fallbackFocus,
  highlight,
}: SetAsideListProps) {
  const { register, isHighlighted } = useCardHighlight(highlight);
  const listRef = useRef<HTMLUListElement>(null);
  // After a keyboard Place or a Delete the row goes: the focus moves to the next row (or the
  // previous one, or the tab), never to the page.
  const pendingFocus = useRef<Id | null | undefined>(undefined);

  useEffect(() => {
    const next = pendingFocus.current;
    if (next === undefined) return;
    pendingFocus.current = undefined;
    if (next === null) fallbackFocus?.current?.focus();
    else
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-set-aside-id="${CSS.escape(next)}"] [data-place]`)
        ?.focus();
  }, [items, fallbackFocus]);

  const leaving = (id: Id) => {
    const i = items.findIndex((x) => x.id === id);
    pendingFocus.current = (items[i + 1] ?? items[i - 1])?.id ?? null;
  };

  if (items.length === 0) {
    return (
      <div
        className="flex flex-col items-center text-center gap-2 px-4 py-6 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60"
        data-testid="set-aside-empty"
      >
        <span className="flex items-center justify-center w-10 h-10 rounded-full bg-white text-slate-400 ring-1 ring-slate-200">
          <Archive className="w-5 h-5" aria-hidden="true" />
        </span>
        <p className="text-sm font-medium text-slate-700">Nothing set aside</p>
        <p className="text-xs text-slate-600 max-w-60">
          Select a piece and choose Set aside to take it off the plan for now. It keeps its size and
          colour until you put it back.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="set-aside">
      <p className="text-xs text-slate-600 mb-2">
        Drag a piece onto the plan, or choose Place and then pick the spot.
      </p>
      <ul ref={listRef} className="space-y-2" aria-label="Pieces set aside">
        {items.map((item) => {
          const card = { type: 'item', id: item.id } as const;
          const lit = isHighlighted(card);
          const name = pieceName(item);
          const placing = placingId === item.id;
          const color = migrateColor(item.color);
          return (
            <li
              key={item.id}
              ref={register(card)}
              className={`group flex items-center gap-2 pl-1 pr-1.5 py-1.5 rounded-xl border bg-white select-none transition-colors ${
                placing
                  ? 'border-emerald-400 ring-2 ring-emerald-200'
                  : 'border-slate-200 hover:border-emerald-300'
              } ${glowClass(lit, 'ring-emerald-300')}`}
              data-set-aside-id={item.id}
              data-highlighted={lit || undefined}
              data-placing={placing || undefined}
              onPointerDown={(e) => {
                // With a mouse the whole row drags; on touch only the grip (the row scrolls).
                if (e.pointerType !== 'mouse') return;
                if ((e.target as Element).closest('button')) return;
                onDragStart(e, item);
              }}
            >
              <span
                className="touch-hit relative shrink-0 flex items-center justify-center w-7 h-10 rounded-lg text-slate-400 cursor-grab active:cursor-grabbing group-hover:text-slate-600"
                style={{ touchAction: 'none', ['--hit' as string]: '44px' }}
                onPointerDown={(e) => {
                  if (e.pointerType === 'mouse') return;
                  onDragStart(e, item);
                }}
                aria-hidden="true"
                data-testid="set-aside-grip"
              >
                <GripVertical className="w-4 h-4" />
              </span>
              {/* The piece's footprint, in its colour. */}
              <span
                className={`shrink-0 border ${item.shape === 'ellipse' ? 'rounded-full' : 'rounded-[3px]'}`}
                style={{
                  backgroundColor: color,
                  borderColor: 'rgb(0 0 0 / 0.15)',
                  width: 26 * Math.min(1, item.width / Math.max(item.width, item.depth)),
                  height: 26 * Math.min(1, item.depth / Math.max(item.width, item.depth)),
                  minWidth: 8,
                  minHeight: 8,
                }}
                aria-hidden="true"
              />
              <span className="flex-1 min-w-0 cursor-grab">
                <span className="block truncate text-sm font-medium text-slate-800">{name}</span>
                <span className="block text-[11px] text-slate-600">
                  {feetToDisplay(item.width, unitSystem)} × {feetToDisplay(item.depth, unitSystem)}
                </span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  const keyboard = e.detail === 0;
                  if (keyboard) leaving(item.id);
                  onPlace(item.id, keyboard);
                }}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  placing
                    ? 'bg-emerald-700 text-white'
                    : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                }`}
                aria-label={`Place ${name}`}
                aria-pressed={placing}
                data-place
              >
                Place
              </button>
              <Tooltip text="Delete">
                <button
                  type="button"
                  onClick={() => {
                    leaving(item.id);
                    onDelete(item.id);
                  }}
                  className="shrink-0 p-1.5 rounded-full text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center"
                  aria-label={`Delete ${name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
