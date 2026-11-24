import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_DOORS, INITIAL_ITEMS, INITIAL_ROOM, INITIAL_WINDOWS } from './constants';
import {
  cycleDetent,
  detentHeights,
  loadDetent,
  saveDetent,
  sheetSummary,
  snapDetent,
  stepDetent,
} from './sheet';

const heights = { peek: 70, half: 380, full: 790 };

describe('detent order', () => {
  it('steps up and down, staying at the ends', () => {
    expect(stepDetent('peek', 1)).toBe('half');
    expect(stepDetent('half', 1)).toBe('full');
    expect(stepDetent('full', 1)).toBe('full');
    expect(stepDetent('full', -1)).toBe('half');
    expect(stepDetent('peek', -1)).toBe('peek');
  });
  it('a tap cycles peek -> half -> full -> peek', () => {
    expect(cycleDetent('peek')).toBe('half');
    expect(cycleDetent('half')).toBe('full');
    expect(cycleDetent('full')).toBe('peek');
  });
});

describe('snapDetent', () => {
  it('a slow release settles on the nearest detent', () => {
    expect(snapDetent(400, 0, heights)).toBe('half');
    expect(snapDetent(200, 0, heights)).toBe('peek');
    expect(snapDetent(650, 0, heights)).toBe('full');
  });
  it('a flick moves on to the next detent in its direction', () => {
    expect(snapDetent(400, 1.2, heights)).toBe('full'); // dragged up past half, flicked up
    expect(snapDetent(360, 1.2, heights)).toBe('half'); // just below half, flicked up: back to half
    expect(snapDetent(360, -1.2, heights)).toBe('peek');
    expect(snapDetent(760, -0.8, heights)).toBe('half');
    expect(snapDetent(800, 2, heights)).toBe('full');
    expect(snapDetent(60, -2, heights)).toBe('peek');
  });
});

describe('detentHeights', () => {
  it('half is 45% of a phone screen', () => {
    expect(detentHeights(844, 70, 796)).toEqual({ peek: 70, half: 380, full: 796 });
  });
  it('half stays clearly between peek and full on a short landscape screen', () => {
    const h = detentHeights(375, 70, 327);
    expect(h.half).toBeGreaterThan(h.peek + 50);
    expect(h.half).toBeLessThan(h.full - 50);
  });
});

describe('remembered detent', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('defaults to half, and reads back what was saved', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
    });
    expect(loadDetent()).toBe('half');
    saveDetent('peek');
    expect(loadDetent()).toBe('peek');
    store.set('room-planner-sheet', 'bogus');
    expect(loadDetent()).toBe('half');
  });
  it('survives storage that throws', () => {
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('blocked');
      },
    });
    expect(loadDetent()).toBe('half');
    expect(() => saveDetent('full')).not.toThrow();
  });
});

describe('sheetSummary', () => {
  const layout = {
    roomDims: INITIAL_ROOM,
    items: INITIAL_ITEMS,
    doors: INITIAL_DOORS,
    windows: INITIAL_WINDOWS,
  };
  it('names the active step', () => {
    expect(sheetSummary(layout, 'room-setup', null, 'ft-in')).toBe(
      `1. Room · 12' × 12' · 1 door · 1 window`,
    );
    expect(sheetSummary(layout, 'furniture', null, 'ft-in')).toBe('2. Items · 6 pieces');
    expect(sheetSummary({ ...layout, items: [], doors: [] }, 'furniture', null, 'ft-in')).toBe(
      '2. Items · no furniture yet',
    );
    expect(sheetSummary({ ...layout, doors: [], windows: [] }, 'room-setup', null, 'm')).toMatch(
      /^1\. Room · [\d.]+ m × [\d.]+ m$/,
    );
  });
  it('or the selected piece, door or window', () => {
    expect(sheetSummary(layout, 'furniture', { type: 'item', id: 6 }, 'ft-in')).toBe(
      `Chair · 1'6" × 1'6"`,
    );
    expect(sheetSummary(layout, 'room-setup', { type: 'door', id: 1 }, 'ft-in')).toBe(
      'Door 1 · bottom wall',
    );
    expect(sheetSummary(layout, 'room-setup', { type: 'window', id: 1 }, 'ft-in')).toBe(
      'Window 1 · top wall',
    );
    // A selection that no longer exists falls back to the step.
    expect(sheetSummary(layout, 'furniture', { type: 'item', id: 99 }, 'ft-in')).toBe(
      '2. Items · 6 pieces',
    );
  });
});
