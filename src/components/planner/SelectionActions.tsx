import { PackagePlus } from 'lucide-react';
import { migrateColor } from '../../core/colors';
import type { Item } from '../../types';
import { Tooltip } from './Tooltip';

interface SelectionActionsProps {
  /** The selected piece (in the room, in furniture mode). */
  item: Item;
  onMoveToInventory: () => void;
  /** `overlay`: over the top of the plan on desktop; `floating`: a chip riding on the phone sheet. */
  variant: 'overlay' | 'floating';
}

const nameOf = (item: Item) => item.label.trim() || 'Item';

/** What can be done with the piece selected on the plan: take it out of the room. */
export function SelectionActions({ item, onMoveToInventory, variant }: SelectionActionsProps) {
  const name = nameOf(item);
  const label = `Move ${name} to inventory`;
  if (variant === 'floating') {
    return (
      <Tooltip text="Move to inventory">
        <button
          type="button"
          onClick={onMoveToInventory}
          className="pointer-events-auto shrink-0 flex items-center justify-center w-11 h-11 rounded-full shadow-lg bg-white/95 text-emerald-800 ring-1 ring-slate-300 backdrop-blur-xs animate-fade-in"
          aria-label={label}
          data-testid="selection-to-inventory"
        >
          <PackagePlus className="w-5 h-5" aria-hidden="true" />
        </button>
      </Tooltip>
    );
  }
  return (
    <div
      className="absolute top-16 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100%-2rem)] flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full bg-white/95 shadow-lg ring-1 ring-slate-200 backdrop-blur-xs animate-fade-in"
      role="toolbar"
      aria-label={`Selected: ${name}`}
      data-testid="selection-actions"
    >
      <span
        className="w-3 h-3 rounded-full border border-slate-300 shrink-0"
        style={{ backgroundColor: migrateColor(item.color) }}
        aria-hidden="true"
      />
      <span className="text-xs font-medium text-slate-700 truncate" aria-hidden="true">
        {name}
      </span>
      <button
        type="button"
        onClick={onMoveToInventory}
        className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 hover:bg-emerald-100 transition-colors"
        aria-label={label}
        data-testid="selection-to-inventory"
      >
        <PackagePlus className="w-3.5 h-3.5" aria-hidden="true" />
        Move to inventory
      </button>
    </div>
  );
}
