import { useEffect, useId, useRef } from 'react';
import { ChevronDown, Package, Trash2 } from 'lucide-react';
import { migrateColor } from '../../core/colors';
import { feetToDisplay } from '../../core/units';
import { glowClass, useCardHighlight, type CardRef } from '../../hooks/useCardHighlight';
import type { Id, Item, UnitSystem } from '../../types';
import { Tooltip } from './Tooltip';

interface InventoryTrayProps {
  /** The pieces in the inventory (no placement), in plan order. */
  items: Item[];
  unitSystem: UnitSystem;
  open: boolean;
  onToggle: () => void;
  /** Put the piece back in the room at a free spot. */
  onPlace: (id: Id) => void;
  onDelete: (id: Id) => void;
  /**
   * The piece just moved here: its row is scrolled into view and glows; with `focus`, its Place
   * button takes the focus (the card that had it is gone).
   */
  highlight?: (CardRef & { focus?: boolean }) | null;
}

const nameOf = (item: Item) => item.label.trim() || 'Item';

/**
 * The inventory (docs/design/plan-format.md, sections 3 and 9): the pieces taken out of the room,
 * kept with their name, size and colour until they are placed again. A collapsible section at the
 * bottom of the furniture list, and (on desktop) where a piece dragged off the plan can be dropped.
 */
export function InventoryTray({
  items,
  unitSystem,
  open,
  onToggle,
  onPlace,
  onDelete,
  highlight,
}: InventoryTrayProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const { register, isHighlighted } = useCardHighlight(highlight);
  const listRef = useRef<HTMLUListElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // After Place or Delete the row goes: the focus moves to the next row (or the previous one, or
  // the section's button), never to the page.
  const pendingFocus = useRef<Id | null | undefined>(undefined);

  const focusRow = (id: Id) =>
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-inventory-id="${CSS.escape(id)}"] [data-place]`)
      ?.focus();

  useEffect(() => {
    const next = pendingFocus.current;
    if (next === undefined) return;
    pendingFocus.current = undefined;
    if (next === null) toggleRef.current?.focus();
    else focusRow(next);
  }, [items]);

  useEffect(() => {
    if (highlight?.focus) focusRow(highlight.id);
  }, [highlight]);

  const leave = (id: Id, act: (id: Id) => void) => {
    const i = items.findIndex((x) => x.id === id);
    pendingFocus.current = (items[i + 1] ?? items[i - 1])?.id ?? null;
    act(id);
  };

  const count = items.length;
  return (
    <section
      className="group rounded-lg border border-dashed border-slate-300 bg-slate-50 transition-colors data-[drop-active]:border-solid data-[drop-active]:border-emerald-500 data-[drop-active]:bg-emerald-50 data-[drop-active]:ring-2 data-[drop-active]:ring-emerald-300"
      aria-labelledby={`${uid}-heading`}
      data-inventory-drop
      data-testid="inventory"
    >
      <h3 id={`${uid}-heading`} className="m-0">
        <button
          type="button"
          ref={toggleRef}
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Package className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            Inventory
            <span
              className={`min-w-5 px-1.5 rounded-full text-[10px] leading-4 text-center ${count ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}
              aria-hidden="true"
              data-testid="inventory-count"
            >
              {count}
            </span>
            <span className="sr-only">
              ({count} piece{count === 1 ? '' : 's'})
            </span>
          </span>
          <ChevronDown
            className={`w-4 h-4 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </h3>
      <p className="hidden group-data-[drop-active]:block px-3 pb-2 text-xs font-medium text-emerald-800">
        Drop to move it to the inventory
      </p>
      {open && (
        <div id={listId} className="group-data-[drop-active]:hidden">
          {count === 0 ? (
            <p className="px-3 pb-3 text-xs text-slate-600">
              Pieces you take out of the room wait here until you place them again.
            </p>
          ) : (
            <ul ref={listRef} className="px-2 pb-2 space-y-1" aria-label="Pieces not in the room">
              {items.map((item) => {
                const card = { type: 'item', id: item.id } as const;
                const lit = isHighlighted(card);
                const name = nameOf(item);
                return (
                  <li
                    key={item.id}
                    ref={register(card)}
                    className={`flex items-center gap-2 px-2 py-1.5 bg-white border border-slate-200 rounded-md ${glowClass(lit, 'ring-emerald-300')}`}
                    data-inventory-id={item.id}
                    data-highlighted={lit || undefined}
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-slate-300 shrink-0"
                      style={{ backgroundColor: migrateColor(item.color) }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-xs font-medium text-slate-700">
                        {name}
                      </span>
                      <span className="block text-[10px] text-slate-600">
                        {feetToDisplay(item.width, unitSystem)} ×{' '}
                        {feetToDisplay(item.depth, unitSystem)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => leave(item.id, onPlace)}
                      className="shrink-0 px-2 py-1 rounded-sm text-xs font-medium bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition-colors"
                      aria-label={`Place ${name} in the room`}
                      data-place
                    >
                      Place
                    </button>
                    <Tooltip text="Delete">
                      <button
                        type="button"
                        onClick={() => leave(item.id, onDelete)}
                        className="shrink-0 p-1.5 rounded-sm text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors flex items-center justify-center"
                        aria-label={`Delete ${name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
