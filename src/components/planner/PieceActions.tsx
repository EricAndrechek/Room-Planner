import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Archive, Copy, Ellipsis, RotateCw, Trash2 } from 'lucide-react';
import type { Item } from '../../types';
import { Tooltip } from './Tooltip';

/** What can be done with a piece on the plan; the same four everywhere it is offered. */
export interface PieceActionHandlers {
  onRotate: () => void;
  onDuplicate: () => void;
  onSetAside: () => void;
  onDelete: () => void;
}

export type PieceAction = 'rotate' | 'duplicate' | 'aside' | 'delete';

interface Action {
  key: PieceAction;
  /** Short label (menus, tooltips). */
  label: string;
  /** Accessible name with the piece's name (toolbar buttons). */
  name: string;
  icon: ReactNode;
  run: () => void;
  danger?: boolean;
}

export const pieceName = (item: Pick<Item, 'label'>) => item.label.trim() || 'Item';

/** The actions for `item` (a locked piece cannot be turned). */
export function pieceActions(item: Item, h: PieceActionHandlers, iconClass: string): Action[] {
  const name = pieceName(item);
  const all: Action[] = [
    {
      key: 'rotate',
      label: 'Rotate 90°',
      name: `Rotate ${name} 90°`,
      icon: <RotateCw className={iconClass} aria-hidden="true" />,
      run: h.onRotate,
    },
    {
      key: 'duplicate',
      label: 'Duplicate',
      name: `Duplicate ${name}`,
      icon: <Copy className={iconClass} aria-hidden="true" />,
      run: h.onDuplicate,
    },
    {
      key: 'aside',
      label: 'Set aside',
      name: `Set aside ${name}`,
      icon: <Archive className={iconClass} aria-hidden="true" />,
      run: h.onSetAside,
    },
    {
      key: 'delete',
      label: 'Delete',
      name: `Delete ${name}`,
      icon: <Trash2 className={iconClass} aria-hidden="true" />,
      run: h.onDelete,
      danger: true,
    },
  ];
  return item.locked ? all.filter((a) => a.key !== 'rotate') : all;
}

/**
 * The selected piece's actions as a row of buttons: `canvas`, a small dark bar next to the piece
 * on the plan (desktop); `sheet`, 44 px buttons in the top row of the phone sheet.
 */
export function SelectionToolbar({
  item,
  variant,
  onAction,
}: {
  item: Item;
  variant: 'canvas' | 'sheet';
  onAction: (action: PieceAction) => void;
}) {
  const handlers: PieceActionHandlers = {
    onRotate: () => onAction('rotate'),
    onDuplicate: () => onAction('duplicate'),
    onSetAside: () => onAction('aside'),
    onDelete: () => onAction('delete'),
  };
  const actions = pieceActions(item, handlers, variant === 'sheet' ? 'w-5 h-5' : 'w-4 h-4');
  if (variant === 'sheet') {
    return (
      <div
        role="toolbar"
        aria-label={`${pieceName(item)} actions`}
        className="pointer-events-auto grid grid-flow-col auto-cols-fr gap-1 p-1 rounded-2xl bg-slate-100/80"
        data-testid="selection-actions"
        data-variant="sheet"
      >
        {actions.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={a.run}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-12 px-1 py-1 rounded-xl text-[11px] leading-tight font-medium transition-colors active:scale-95 ${
              a.danger
                ? 'text-red-700 hover:bg-red-50 active:bg-red-50'
                : 'text-slate-700 hover:bg-white active:bg-white'
            }`}
            aria-label={a.name}
            data-action={a.key}
          >
            {a.icon}
            <span className="whitespace-nowrap">{a.key === 'rotate' ? 'Rotate' : a.label}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div
      role="toolbar"
      aria-label={`${pieceName(item)} actions`}
      className="flex items-center gap-0.5 p-1 rounded-full bg-slate-900/90 text-white shadow-xl ring-1 ring-white/10 backdrop-blur-xs animate-fade-in"
      data-testid="selection-actions"
      data-variant="canvas"
      // A press here is not a press on the plan (no pan, no deselect).
      onPointerDown={(e) => e.stopPropagation()}
    >
      {actions.map((a) => (
        <Tooltip key={a.key} text={a.label}>
          <button
            type="button"
            onClick={a.run}
            className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-emerald-300 outline-hidden ${
              a.danger ? 'hover:bg-red-500/90' : 'hover:bg-white/15'
            }`}
            aria-label={a.name}
            data-action={a.key}
          >
            {a.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

/**
 * A card's "more" menu: the same actions as the selection bar. Arrow keys move through the items,
 * Escape closes it and returns the focus to its button.
 */
export function PieceMenu({ item, ...handlers }: PieceActionHandlers & { item: Item }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const actions = pieceActions(item, handlers, 'w-4 h-4');

  useEffect(() => {
    if (!open) return;
    items.current[0]?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const close = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items.current.filter(Boolean) as HTMLButtonElement[];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (k: number) => {
      e.preventDefault();
      e.stopPropagation();
      list[(k + list.length) % list.length]?.focus();
    };
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Tab') close(false);
  };

  return (
    <div ref={wrap} className="relative" onClick={(e) => e.stopPropagation()}>
      <Tooltip text="More" disabled={open}>
        <button
          ref={button}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`p-1.5 rounded-sm transition-colors flex items-center justify-center ${open ? 'bg-slate-100 text-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
          aria-label={`More actions for ${pieceName(item)}`}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          data-testid="piece-menu-button"
        >
          <Ellipsis className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </Tooltip>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={`${pieceName(item)} actions`}
          className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-xl border border-slate-200 p-1 z-[60] animate-fade-in"
          onKeyDown={onKeyDown}
          data-testid="piece-menu"
        >
          {actions.map((a, k) => (
            <button
              key={a.key}
              ref={(el) => {
                items.current[k] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close();
                a.run();
              }}
              className={`w-full flex items-center gap-2.5 px-2.5 min-h-10 rounded-lg text-sm text-left transition-colors focus-visible:outline-hidden ${
                a.danger
                  ? 'text-red-700 hover:bg-red-50 focus-visible:bg-red-50'
                  : 'text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100'
              }`}
              data-action={a.key}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
