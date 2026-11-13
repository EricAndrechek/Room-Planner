import { useEffect, useRef, useState } from 'react';
import { feetToDisplay, feetToInputValue, parseToFeet, unitSuffix } from '../../lib/units';
import type { UnitSystem } from '../../types';

interface DimensionInputProps {
  /** Current value in feet. */
  value: number;
  /** Called with the parsed value in feet, clamped to [min, max]. */
  onChange: (feet: number) => void;
  className?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  label?: string;
  unitSystem?: UnitSystem;
}

/**
 * Text input for lengths. Shows the value in the active unit system and
 * accepts free-form input with any unit (`12'6"`, `150cm`, `1.5m`...),
 * committing on blur or Enter.
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
}: DimensionInputProps) {
  // While focused the user edits a draft; otherwise the value is displayed.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const focusText = useRef('');
  const errorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(errorTimer.current), []);

  const flashError = (message: string) => {
    setError(message);
    clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(''), 3000);
  };

  const commitValue = () => {
    if (draft === null) return;
    setDraft(null);
    // Untouched: keep the exact value (re-parsing the rounded-sm display would nudge it).
    if (draft === focusText.current) return;
    const feet = parseToFeet(draft, unitSystem);
    if (feet < min) {
      flashError(`Min: ${feetToDisplay(min, unitSystem)}`);
      onChange(min);
      return;
    }
    if (feet > max) {
      flashError(`Max: ${feetToDisplay(max, unitSystem)}`);
      onChange(max);
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
          type="text"
          inputMode="text"
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => {
            focusText.current = shown;
            setDraft(shown);
          }}
          onBlur={commitValue}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className={`${className} ${error ? 'border-red-400 focus:ring-red-500' : ''} ${suffix ? 'pr-7' : ''} flex-1`}
          placeholder={placeholder}
          aria-label={label || placeholder}
        />
        {suffix && (
          <span className="absolute right-1.5 text-[10px] text-slate-400 pointer-events-none select-none bg-white px-0.5">
            {suffix}
          </span>
        )}
      </div>
      {error && <p className="absolute -bottom-5 left-0 text-[10px] text-red-500">{error}</p>}
    </div>
  );
}
