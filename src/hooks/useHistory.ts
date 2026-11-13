import { useCallback, useMemo, useReducer } from 'react';
import { MAX_HISTORY } from '../lib/constants';

/**
 * Undo/redo over an immutable document.
 *
 * `stack[index]` is the last committed snapshot. `present` may run ahead of it
 * with transient edits (a drag in progress, a label being typed) until
 * `commit()` records it. Undo first discards uncommitted edits, then steps back.
 */
interface HistoryState<T> {
  present: T;
  stack: T[];
  index: number;
}

type Action<T> =
  | { type: 'set'; update: (prev: T) => T; commit: boolean }
  | { type: 'commit' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: T };

const push = <T>(state: HistoryState<T>, value: T, limit: number): HistoryState<T> => {
  if (state.stack[state.index] === value) return { ...state, present: value };
  const stack = [...state.stack.slice(0, state.index + 1), value];
  while (stack.length > limit) stack.shift();
  return { present: value, stack, index: stack.length - 1 };
};

export const historyReducer = <T>(limit = MAX_HISTORY) =>
  (state: HistoryState<T>, action: Action<T>): HistoryState<T> => {
    switch (action.type) {
      case 'set': {
        const next = action.update(state.present);
        if (action.commit) return push(state, next, limit);
        return next === state.present ? state : { ...state, present: next };
      }
      case 'commit':
        return push(state, state.present, limit);
      case 'undo': {
        if (state.present !== state.stack[state.index]) {
          return { ...state, present: state.stack[state.index]! };
        }
        if (state.index <= 0) return state;
        return { ...state, index: state.index - 1, present: state.stack[state.index - 1]! };
      }
      case 'redo': {
        if (state.index >= state.stack.length - 1) return state;
        return { ...state, index: state.index + 1, present: state.stack[state.index + 1]! };
      }
      case 'reset':
        return { present: action.value, stack: [action.value], index: 0 };
    }
  };

export const initHistory = <T>(value: T): HistoryState<T> => ({ present: value, stack: [value], index: 0 });

export interface History<T> {
  present: T;
  /** Change the document without recording an undo step (e.g. during a drag). */
  set: (update: (prev: T) => T) => void;
  /** Change the document and record an undo step. */
  apply: (update: (prev: T) => T) => void;
  /** Record the current document as an undo step (no-op if unchanged). */
  commit: () => void;
  undo: () => void;
  redo: () => void;
  /** Replace the document and clear history (opening another project). */
  reset: (value: T) => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useHistory<T>(initial: T | (() => T), limit = MAX_HISTORY): History<T> {
  const reducer = useMemo(() => historyReducer<T>(limit), [limit]);
  const [state, dispatch] = useReducer(reducer, initial, (init) =>
    initHistory(typeof init === 'function' ? (init as () => T)() : init),
  );

  const set = useCallback((update: (prev: T) => T) => dispatch({ type: 'set', update, commit: false }), []);
  const apply = useCallback((update: (prev: T) => T) => dispatch({ type: 'set', update, commit: true }), []);
  const commit = useCallback(() => dispatch({ type: 'commit' }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const reset = useCallback((value: T) => dispatch({ type: 'reset', value }), []);

  const dirty = state.present !== state.stack[state.index];
  return {
    present: state.present,
    set,
    apply,
    commit,
    undo,
    redo,
    reset,
    canUndo: state.index > 0 || dirty,
    canRedo: !dirty && state.index < state.stack.length - 1,
  };
}
