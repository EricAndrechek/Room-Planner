import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { track } from '../../lib/analytics';
import {
  feetToDisplay,
  feetToInputValue,
  parseToFeet,
  roundNum,
  suggestReading,
  unitSuffix,
} from '../../lib/units';
import type { UnitSystem } from '../../types';

interface DimensionInputProps {
  /** Current value in feet. */
  value: number;
  /** Called with the parsed value in feet, only when it is within [min, max] (else rejected). */
  onChange: (feet: number) => void;
  className?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  label?: string;
  unitSystem?: UnitSystem;
  /** For a visible `<label htmlFor>`. */
  id?: string;
  /**
   * Room sides: a value above this many feet (but within `max`) is not used straight away. An
   * inline prompt asks first, offering a likely intended reading when there is one ("That's a
   * 117 ft room — did you mean 11'7"?").
   */
  confirmAbove?: number;
}

/** A large size as people say it: "117 ft" (imperial) or "45 m" (metric). */
const bigSize = (feet: number, unitSystem: UnitSystem) =>
  unitSystem === 'ft-in' || unitSystem === 'ft'
    ? `${roundNum(feet, 1)} ft`
    : feetToDisplay(feet, unitSystem);

/**
 * Text input for lengths. Shows the value in the active unit system and
 * accepts free-form input with any unit (`12'6"`, `11 7`, `150cm`, `1.5m`...),
 * committing on blur or Enter. Out-of-range input is rejected with an inline error (the previous
 * value stays); it is never silently clamped.
 */
export function DimensionInput({
  value,
  onChange,
  className = '',
  placeholder,
  min = 0,
  max = 1000,
  label,
  unitSystem = 'ft-in',
  id,
  confirmAbove,
}: DimensionInputProps) {
  // While focused the user edits a draft; otherwise the value is displayed.
  const [draft, setDraft] = useState<string | null>(null);
  // Why the last entry was rejected (the previous value was kept); cleared by the next edit.
  const [error, setError] = useState('');
  const focusText = useRef('');
  const uid = useId();
  const errorId = `${uid}-error`;
  const promptId = `${uid}-confirm`;
  const inputRef = useRef<HTMLInputElement>(null);
  // An unusually large entry waiting for "did you mean?" (`alt`: the other likely reading).
  const [pending, setPending] = useState<{ feet: number; alt: number | null } | null>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pending) firstChoice.current?.focus();
  }, [pending]);

  const choose = (
    choice: 'reinterpret' | 'keep' | 'cancel',
    e?: MouseEvent<HTMLButtonElement> | null,
  ) => {
    if (!pending) return;
    if (choice === 'reinterpret' && pending.alt !== null) onChange(pending.alt);
    else if (choice === 'keep') onChange(pending.feet);
    setPending(null);
    track('dimension_confirm', { choice });
    // Keyboard users go back to the field; a tap does not pop the phone keyboard up again.
    if (!e || e.detail === 0) inputRef.current?.focus();
  };

  const reject = (message: string, reason: 'min' | 'max' | 'invalid') => {
    setError(message);
    // No field name: furniture fields are labelled with the user's own item names.
    track('dimension_rejected', { reason, units: unitSystem });
  };

  const commitValue = () => {
    if (draft === null) return;
    setDraft(null);
    // Untouched: keep the exact value (re-parsing the rounded-sm display would nudge it).
    if (draft === focusText.current) return;
    // Out-of-range or unreadable input is rejected, never clamped: the previous value stays.
    if (!/\d/.test(draft)) {
      reject(`Type a length, e.g. ${feetToDisplay(12.5, unitSystem)}`, 'invalid');
      return;
    }
    const feet = parseToFeet(draft, unitSystem);
    if (feet < min - 1e-9) {
      reject(`Min ${feetToDisplay(min, unitSystem)}`, 'min');
      return;
    }
    const hi = Math.max(min, max);
    if (feet > hi + 1e-9) {
      // "117" meant as 11'7" is the usual slip: say how to type feet and inches.
      const hint =
        unitSystem === 'ft-in' && /^\s*\d+\s*$/.test(draft) ? `. For 11'7", type 11 7` : '';
      reject(`Max ${feetToDisplay(hi, unitSystem)}${hint}`, 'max');
      return;
    }
    setError('');
    if (confirmAbove !== undefined && feet > confirmAbove + 1e-9) {
      setPending({ feet, alt: suggestReading(draft, unitSystem, { min, max: confirmAbove }) });
      return;
    }
    onChange(feet);
  };

  const suffix = unitSuffix(unitSystem);
  const shown = draft ?? (typeof value === 'number' ? feetToInputValue(value, unitSystem) : '');

  return (
    <div className="relative w-full">
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="text"
          value={shown}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError('');
          }}
          onFocus={() => {
            focusText.current = shown;
            setDraft(shown);
            setPending(null); // back in the field: the question is dropped
          }}
          onBlur={commitValue}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            // The commit may move focus to the "did you mean?" buttons: this Enter must not
            // press one of them too.
            e.preventDefault();
            e.currentTarget.blur();
          }}
          className={`${className} ${error ? 'border-red-400 focus:ring-red-500' : ''} ${suffix ? 'pr-7' : ''} flex-1`}
          placeholder={placeholder}
          aria-label={label || placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : pending ? `${promptId}-text` : undefined}
        />
        {suffix && (
          <span className="absolute right-1.5 text-[10px] text-slate-500 pointer-events-none select-none bg-white px-0.5">
            {suffix}
          </span>
        )}
      </div>
      {error && (
        <p id={errorId} className="mt-1 text-[10px] leading-tight text-red-700" role="alert">
          {error}
        </p>
      )}
      {pending && (
        // Focus moves to the first choice, so the group's question is read out with it.
        <div
          role="group"
          aria-labelledby={`${promptId}-text`}
          className="mt-1 p-2 rounded-md border border-amber-300 bg-amber-50 text-amber-950"
          data-testid="dimension-confirm"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            choose('cancel');
          }}
        >
          <p id={`${promptId}-text`} className="text-[11px] leading-snug mb-1.5">
            That&apos;s a {bigSize(pending.feet, unitSystem)} room —{' '}
            {pending.alt !== null
              ? `did you mean ${feetToDisplay(pending.alt, unitSystem)}?`
              : 'keep it?'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              ref={firstChoice}
              type="button"
              onClick={(e) => choose(pending.alt !== null ? 'reinterpret' : 'keep', e)}
              className="px-2 py-1 rounded-sm bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium transition-colors"
            >
              {pending.alt !== null ? `Use ${feetToDisplay(pending.alt, unitSystem)}` : 'Keep'}
            </button>
            <button
              type="button"
              onClick={(e) => choose(pending.alt !== null ? 'keep' : 'cancel', e)}
              className="px-2 py-1 rounded-sm bg-white border border-amber-300 hover:bg-amber-100 text-amber-950 text-[11px] font-medium transition-colors"
            >
              {pending.alt !== null ? `Keep ${bigSize(pending.feet, unitSystem)}` : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
