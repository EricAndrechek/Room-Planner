import { useRef, type KeyboardEvent } from 'react';

interface SegmentedProps<T extends string> {
  /** Accessible name of the group, e.g. "Door 1 wall". */
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Focus ring color class, e.g. `focus-visible:ring-indigo-500`. */
  ring?: string;
  /** Selected segment text color class. */
  activeText?: string;
}

/**
 * A row of mutually exclusive options (a radio group drawn as a segmented control): one tap
 * picks, arrow keys move between options and pick, Tab enters at the selected one.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  ring = 'focus-visible:ring-indigo-500',
  activeText = 'text-indigo-700',
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

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
    const next = (current + delta + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next]!.value);
  };

  return (
    <div role="radiogroup" aria-label={label} className="flex bg-slate-100 rounded-sm p-0.5">
      {options.map((o, i) => {
        const on = i === current;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
            className={`flex-1 py-1 text-[10px] font-medium rounded-sm transition-colors outline-hidden focus-visible:ring-2 ${ring} ${
              on ? `bg-white ${activeText} shadow-xs` : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
