import { describe, expect, it } from 'vitest';
import { historyReducer, initHistory } from './useHistory';

type S = { n: number };
const reduce = historyReducer<S>(3);
const set = (n: number, commit = true) => ({ type: 'set' as const, update: () => ({ n }), commit });

describe('history reducer', () => {
  it('undo/redo walk committed snapshots', () => {
    let h = initHistory<S>({ n: 0 });
    h = reduce(h, set(1));
    h = reduce(h, set(2));
    expect(h.present.n).toBe(2);
    h = reduce(h, { type: 'undo' });
    expect(h.present.n).toBe(1);
    h = reduce(h, { type: 'undo' });
    expect(h.present.n).toBe(0);
    h = reduce(h, { type: 'undo' });
    expect(h.present.n).toBe(0);
    h = reduce(h, { type: 'redo' });
    h = reduce(h, { type: 'redo' });
    expect(h.present.n).toBe(2);
  });

  it('every committed change is one undo step (the original skipped one)', () => {
    let h = initHistory<S>({ n: 0 });
    for (const n of [1, 2]) h = reduce(h, set(n));
    h = reduce(h, { type: 'undo' });
    expect(h.present.n).toBe(1);
  });

  it('transient edits are committed once', () => {
    let h = initHistory<S>({ n: 0 });
    for (const n of [1, 2, 3]) h = reduce(h, set(n, false));
    expect(h.stack).toHaveLength(1);
    h = reduce(h, { type: 'commit' });
    expect(h.stack.map((s) => s.n)).toEqual([0, 3]);
    h = reduce(h, { type: 'commit' }); // unchanged -> no extra step
    expect(h.stack).toHaveLength(2);
  });

  it('undo discards uncommitted edits first', () => {
    let h = initHistory<S>({ n: 0 });
    h = reduce(h, set(1));
    h = reduce(h, set(5, false));
    h = reduce(h, { type: 'undo' });
    expect(h.present.n).toBe(1);
  });

  it('a new change after undo drops the redo branch', () => {
    let h = initHistory<S>({ n: 0 });
    h = reduce(h, set(1));
    h = reduce(h, { type: 'undo' });
    h = reduce(h, set(7));
    h = reduce(h, { type: 'redo' });
    expect(h.present.n).toBe(7);
    expect(h.stack.map((s) => s.n)).toEqual([0, 7]);
  });

  it('is capped', () => {
    let h = initHistory<S>({ n: 0 });
    for (let n = 1; n <= 10; n++) h = reduce(h, set(n));
    expect(h.stack.map((s) => s.n)).toEqual([8, 9, 10]);
    expect(h.index).toBe(2);
  });

  it('reset clears history', () => {
    let h = initHistory<S>({ n: 0 });
    h = reduce(h, set(1));
    h = reduce(h, { type: 'reset', value: { n: 9 } });
    expect(h).toEqual({ present: { n: 9 }, stack: [{ n: 9 }], index: 0 });
  });
});
