import { useId, useRef, useState } from 'react';
import { track } from '../../lib/analytics';
import { feetToDisplay, feetToInputValue, parseToFeet, unitSuffix } from '../../lib/units';
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
}

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
}: DimensionInputProps) {
  // While focused the user edits a draft; otherwise the value is displayed.
  const [draft, setDraft] = useState<string | null>(null);
  // Why the last entry was rejected (the previous value was kept); cleared by the next edit.
  const [error, setError] = useState('');
  const focusText = useRef('');
  const errorId = `${useId()}-error`;

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
    onChange(feet);
  };

  const suffix = unitSuffix(unitSystem);
  const shown = draft ?? (typeof value === 'number' ? feetToInputValue(value, unitSystem) : '');

  return (
    <div className="relative w-full">
      <div className="relative flex items-center">
        <input
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
          }}
          onBlur={commitValue}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={`${className} ${error ? 'border-red-400 focus:ring-red-500' : ''} ${suffix ? 'pr-7' : ''} flex-1`}
          placeholder={placeholder}
          aria-label={label || placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
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
    </div>
  );
}
