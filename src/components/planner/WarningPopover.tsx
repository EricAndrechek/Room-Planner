import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import type { ItemWarning } from '../../core/geometry';
import type { Item } from '../../types';
import { pieceName } from './PieceActions';

/** How a flagged piece is fixed in place: brought inside its room, or moved to a clear spot. */
export type WarningFix = 'inside' | 'clear';

export interface WarningIssue {
  kind: 'outside' | 'door' | 'doorway' | 'overlap';
  /** One sentence that says what the badge means. */
  sentence: string;
  fix: WarningFix;
}

/** What a piece's warning means, one sentence per problem (outside first, as it is fixed first). */
export function warningIssues(w: ItemWarning | undefined): WarningIssue[] {
  if (!w) return [];
  const out: WarningIssue[] = [];
  if (w.outOfBounds) {
    out.push({
      kind: 'outside',
      sentence: 'This piece is partly outside the room.',
      fix: 'inside',
    });
  }
  if (w.blocksDoor) {
    out.push({ kind: 'door', sentence: "This piece is in the door's swing path.", fix: 'clear' });
  } else if (w.blocksDoorway) {
    out.push({ kind: 'doorway', sentence: 'This piece is standing in a doorway.', fix: 'clear' });
  }
  if (w.collision) {
    out.push({ kind: 'overlap', sentence: 'This piece overlaps another piece.', fix: 'clear' });
  }
  return out;
}

/** The button for a fix: "Move inside", or "Move it out of the way" (a door) / to a free spot. */
export const fixLabel = (fix: WarningFix, issues: WarningIssue[]): string =>
  fix === 'inside'
    ? 'Move inside'
    : issues.some((i) => i.kind === 'door' || i.kind === 'doorway')
      ? 'Move it out of the way'
      : 'Move it to a free spot';

interface WarningPopoverProps {
  item: Item;
  warning: ItemWarning | undefined;
  /** Why the last fix did nothing (no free spot), if it did not. */
  failed?: string | null;
  onFix: (fix: WarningFix) => void;
  onClose: () => void;
  /** Mounted: the element, to bring it into view (phones: above the sheet). */
  onShown?: (el: HTMLElement) => void;
}

/**
 * Tapping a piece's warning badge: what the warning means in one sentence each, and a one-tap fix
 * (one undo step). Not modal: the plan stays usable; Escape or the close button dismiss it and
 * focus goes back to the badge.
 */
export function WarningPopover({
  item,
  warning,
  failed,
  onFix,
  onClose,
  onShown,
}: WarningPopoverProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const issues = warningIssues(warning);
  const fixes = [...new Set(issues.map((i) => i.fix))];
  const empty = issues.length === 0;
  useEffect(() => {
    if (empty) return;
    first.current?.focus({ preventScroll: true });
    if (ref.current) onShown?.(ref.current);
    // Once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (empty) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      className="w-60 rounded-xl bg-white p-3 text-left shadow-xl ring-1 ring-slate-200 animate-fade-in"
      data-testid="warning-popover"
      data-draggable
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Arrows, R and Delete here are for these buttons, not the canvas shortcuts.
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <h2 id={titleId} className="text-xs font-semibold text-slate-800">
          {pieceName(item)}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="-m-1 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <ul className="mb-2 space-y-0.5 text-xs leading-snug text-slate-700">
        {issues.map((i) => (
          <li key={i.kind}>{i.sentence}</li>
        ))}
      </ul>
      {failed && (
        <p className="mb-2 text-[11px] leading-snug text-amber-800" role="status">
          {failed}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {fixes.map((fix, n) => (
          <button
            key={fix}
            ref={n === 0 ? first : undefined}
            type="button"
            onClick={() => onFix(fix)}
            className="min-h-8 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-300 outline-hidden"
          >
            {fixLabel(fix, issues)}
          </button>
        ))}
      </div>
    </div>
  );
}
