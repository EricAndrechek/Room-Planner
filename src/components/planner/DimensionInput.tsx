import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { track } from '../../lib/analytics';
import {
  feetToDisplay,
  feetToInputValue,
  formatHint,
  inputShape,
  normalizeLength,
  otherReading,
  parseLength,
  roundNum,
  unitSuffix,
  type Reading,
} from '../../core/units';
import type { UnitSystem } from '../../types';

interface DimensionInputProps {
  /** Current value in feet. */
  value: number;
  /** Called with the new value in feet: within [min, max], or adjusted as `clamp` / `allowAbove` say. */
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
  /**
   * Out of range is clamped instead of rejected, with a note saying why: e.g. a door wider than
   * its wall becomes as wide as the wall ("Set to 12': the whole wall").
   */
  clamp?: { max: string; min?: string };
  /**
   * Above `max` is still allowed up to `upTo` feet, with `note` under the field (a piece bigger
   * than its room: it is drawn, and flagged as outside the room).
   */
  allowAbove?: { upTo: number; note: string };
  /**
   * Where to show the error and the "did you mean?" prompt instead of under the field: e.g. a
   * full-width row under a Width/Length pair, where a half-width column would cramp them.
   */
  messageSlot?: HTMLElement | null;
  /** Field name prefixed to those messages ("Width: …"), for when they are not under the field. */
  messageLabel?: string;
}

/** A large size as people say it: "117 ft" (imperial) or "45 m" (metric). */
const bigSize = (feet: number, unitSystem: UnitSystem) =>
  unitSystem === 'ft-in' || unitSystem === 'ft'
    ? `${roundNum(feet, 1)} ft`
    : feetToDisplay(feet, unitSystem);

/** What the user typed, quoted back in a message: trimmed and cut short. */
const quoted = (draft: string) => {
  const t = draft.trim();
  return t.length > 14 ? `${t.slice(0, 13)}…` : t;
};

/** Why a typed size was not used as typed (analytics `reason`). */
type Reason = 'min' | 'max' | 'invalid' | 'pair';

/**
 * Text input for lengths. Shows the value in the active unit system and accepts free-form input
 * with any unit (`12'6"`, `11 7`, `11'7`, `11 1/2'`, `150cm`, `2,5 m`...; see `parseLength`),
 * committing on blur or Enter. An empty field goes back to its value. Input that is not a length,
 * or out of range, is rejected with an inline error that says how to type it (the previous value
 * stays), unless the field clamps or allows it (`clamp`, `allowAbove`); a bare number with a likely
 * other reading in range (`60` for a 5' sofa: 60") asks "did you mean?" first.
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
  clamp,
  allowAbove,
  messageSlot,
  messageLabel,
}: DimensionInputProps) {
  // While focused the user edits a draft; otherwise the value is displayed.
  const [draft, setDraft] = useState<string | null>(null);
  // Why the last entry was rejected (the previous value was kept); cleared by the next edit.
  const [error, setError] = useState('');
  // What happened to the last entry when it was used, adjusted (clamped, or bigger than the room).
  const [note, setNote] = useState('');
  const focusText = useRef('');
  const uid = useId();
  const errorId = `${uid}-error`;
  const noteId = `${uid}-note`;
  const promptId = `${uid}-confirm`;
  const inputRef = useRef<HTMLInputElement>(null);
  // An entry waiting for "did you mean?": an unusually large room side, or out of range with a
  // likely other reading (`alt`). `keep` is what keeping it as typed means (null: it can't be).
  const [pending, setPending] = useState<{
    feet: number;
    alt: Reading | null;
    why: 'large' | 'range';
    keep: { feet: number; note: string } | null;
  } | null>(null);
  const firstChoice = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (pending) firstChoice.current?.focus();
  }, [pending]);
  const kind = confirmAbove !== undefined ? 'room' : 'piece';
  const show = (feet: number) => feetToDisplay(feet, unitSystem);

  const choose = (
    choice: 'reinterpret' | 'keep' | 'cancel',
    e?: MouseEvent<HTMLButtonElement> | null,
  ) => {
    if (!pending) return;
    if (choice === 'reinterpret' && pending.alt !== null) onChange(pending.alt.feet);
    else if (choice === 'keep' && pending.keep) {
      onChange(pending.keep.feet);
      setNote(pending.keep.note);
    }
    setPending(null);
    track('dimension_confirm', { choice });
    // Keyboard users go back to the field; a tap does not pop the phone keyboard up again.
    if (!e || e.detail === 0) inputRef.current?.focus();
  };

  // No field name in analytics: furniture fields are labelled with the user's own item names. The
  // input's shape (digits as 9) says which forms are typed, never what was typed.
  const reject = (message: string, reason: Reason, text: string) => {
    setError(message);
    track('dimension_rejected', {
      reason,
      units: unitSystem,
      shape: inputShape(text),
      outcome: 'rejected',
    });
  };
  /** Used, but not as typed: clamped to the limit, or allowed past it; the note says so. */
  const adjust = (feet: number, message: string, reason: Reason, outcome: string, text: string) => {
    onChange(feet);
    setNote(message);
    track('dimension_adjusted', { reason, units: unitSystem, shape: inputShape(text), outcome });
  };

  const commitValue = () => {
    if (draft === null) return;
    const text = draft;
    setDraft(null);
    // Untouched: keep the exact value (re-parsing the rounded-sm display would nudge it).
    if (text === focusText.current) return;
    setNote('');
    const parsed = parseLength(text, unitSystem);
    if (!parsed.ok) {
      // Cleared and left: nothing to use, nothing wrong. The value stays.
      if (parsed.problem === 'empty') return;
      if (parsed.problem === 'pair') {
        const first = normalizeLength(text).split(/\s*(?:x|\*|by)\s*/)[0];
        reject(
          `One size per field: type ${first} here and the other size in its own field`,
          'pair',
          text,
        );
      } else {
        reject(
          `Couldn't read “${quoted(text)}”. Type it like ${formatHint(text, unitSystem)}`,
          'invalid',
          text,
        );
      }
      return;
    }
    const feet = parsed.feet;
    const hi = Math.max(min, max);
    const low = feet < min - 1e-9;
    const high = feet > hi + 1e-9;
    if (low || high) {
      const reason: Reason = low ? 'min' : 'max';
      const canKeep =
        high && allowAbove && feet <= allowAbove.upTo + 1e-9
          ? { feet, note: allowAbove.note }
          : null;
      // A bare number that reads as something sensible another way (60 -> 60" for a sofa): ask.
      // (A room's other reading must be an ordinary size: below the "are you sure?" line.)
      const alt = otherReading(text, unitSystem, { min, max: confirmAbove ?? hi }, kind);
      if (alt) {
        setError('');
        setPending({ feet, alt, why: 'range', keep: canKeep });
        track('dimension_rejected', {
          reason,
          units: unitSystem,
          shape: inputShape(text),
          outcome: 'suggested',
        });
        return;
      }
      if (canKeep) {
        adjust(feet, canKeep.note, reason, 'allowed', text);
        return;
      }
      if (clamp && (high || clamp.min)) {
        const to = high ? hi : min;
        adjust(to, `Set to ${show(to)}: ${high ? clamp.max : clamp.min}`, reason, 'clamped', text);
        return;
      }
      reject(
        low
          ? `Min ${show(min)} (that's ${show(feet)})`
          : `Max ${show(hi)} (that's ${bigSize(feet, unitSystem)})`,
        reason,
        text,
      );
      return;
    }
    setError('');
    setNote('');
    if (confirmAbove !== undefined && feet > confirmAbove + 1e-9) {
      const alt = otherReading(text, unitSystem, { min, max: confirmAbove }, 'room');
      setPending({ feet, alt, why: 'large', keep: { feet, note: '' } });
      return;
    }
    onChange(feet);
  };

  // The error / "did you mean?" prompt: under the field, or in `messageSlot` (a full-width row
  // under a pair of fields), named after the field so it is clear which one it is about.
  const prefix = messageLabel ? <span className="font-semibold">{messageLabel}: </span> : null;
  // The question: "That's a 117 ft room — did you mean 11'7"?" for a room side, or "That's 60 ft —
  // did you mean 60" (5')?" for a bare number out of range.
  const question = (p: NonNullable<typeof pending>) => {
    const what =
      p.why === 'large' ? `a ${bigSize(p.feet, unitSystem)} room` : bigSize(p.feet, unitSystem);
    if (!p.alt) return `That's ${what} — keep it?`;
    const typed =
      p.alt.typed === show(p.alt.feet) ? p.alt.typed : `${p.alt.typed} (${show(p.alt.feet)})`;
    return `That's ${what} — did you mean ${typed}?`;
  };
  const messages =
    error || pending || note ? (
      <>
        {error && (
          <p id={errorId} className="mt-1 text-[10px] leading-tight text-red-700" role="alert">
            {prefix}
            {error}
          </p>
        )}
        {note && !error && !pending && (
          <p
            id={noteId}
            className="mt-1 text-[10px] leading-tight text-amber-800"
            role="status"
            data-testid="dimension-note"
          >
            {prefix}
            {note}
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
              {prefix}
              {question(pending)}
            </p>
            <div className="flex flex-wrap gap-1.5 [&>button]:whitespace-nowrap">
              <button
                ref={firstChoice}
                type="button"
                onClick={(e) => choose(pending.alt !== null ? 'reinterpret' : 'keep', e)}
                className="px-2 py-1 rounded-sm bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium transition-colors"
              >
                {pending.alt !== null ? `Use ${show(pending.alt.feet)}` : 'Keep'}
              </button>
              <button
                type="button"
                onClick={(e) => choose(pending.alt !== null && pending.keep ? 'keep' : 'cancel', e)}
                className="px-2 py-1 rounded-sm bg-white border border-amber-300 hover:bg-amber-100 text-amber-950 text-[11px] font-medium transition-colors"
              >
                {pending.alt !== null && pending.keep
                  ? `Keep ${bigSize(pending.feet, unitSystem)}`
                  : 'Cancel'}
              </button>
            </div>
          </div>
        )}
      </>
    ) : null;

  const suffix = unitSuffix(unitSystem);
  const shown = draft ?? (typeof value === 'number' ? feetToInputValue(value, unitSystem) : '');

  return (
    <div className="relative w-full">
      {/* The value and its unit are measurements: a page translator must not reword them. */}
      <div className="relative flex items-center" translate="no">
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="text"
          value={shown}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError('');
            if (note) setNote('');
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
          aria-describedby={
            error ? errorId : pending ? `${promptId}-text` : note ? noteId : undefined
          }
        />
        {suffix && (
          <span className="absolute right-1.5 text-[10px] text-slate-500 pointer-events-none select-none bg-white px-0.5">
            {suffix}
          </span>
        )}
      </div>
      {messages && (messageSlot ? createPortal(messages, messageSlot) : messages)}
    </div>
  );
}
