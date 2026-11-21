import { describe, expect, it } from 'vitest';
import type { FurnitureItem } from '../types';
import { PIXELS_PER_UNIT } from './constants';
import { getRotatedCorners } from './geometry';
import {
  SNAP_THRESHOLD_PX,
  buildSnapCandidates,
  describeSnap,
  fitMeasurementLabels,
  itemBounds,
  measureClearances,
  snapAxis,
  snapGuides,
  snapItem,
  snapNudge,
  thresholdFeet,
  type SnapLine,
} from './snapping';

const item = (over: Partial<FurnitureItem>): FurnitureItem => ({
  id: 1,
  label: 'Moving',
  width: 2,
  height: 2,
  x: 0,
  y: 0,
  rotation: 0,
  color: '#93c5fd',
  visible: true,
  ...over,
});

const room = { width: 12, height: 10 };
/** 8 screen px at 100% zoom = 0.2 ft. */
const T = thresholdFeet(SNAP_THRESHOLD_PX, 1, PIXELS_PER_UNIT);

describe('itemBounds', () => {
  it('is the stored box when unrotated or upside down', () => {
    expect(itemBounds(item({ x: 1, y: 2, width: 3, height: 1 }))).toEqual({
      left: 1,
      top: 2,
      right: 4,
      bottom: 3,
    });
    expect(itemBounds(item({ x: 1, y: 2, width: 3, height: 1, rotation: 180 }))).toEqual({
      left: 1,
      top: 2,
      right: 4,
      bottom: 3,
    });
  });

  it('swaps width and depth at 90 and 270 degrees, about the center', () => {
    for (const rotation of [90, 270, -90]) {
      expect(itemBounds(item({ x: 1, y: 2, width: 4, height: 2, rotation }))).toEqual({
        left: 2,
        top: 1,
        right: 4,
        bottom: 5,
      });
    }
  });

  it('matches the rotated corners at any angle', () => {
    const it45 = item({ x: 3, y: 3, width: 4, height: 2, rotation: 30 });
    const corners = getRotatedCorners(it45);
    const b = itemBounds(it45);
    expect(b.left).toBeCloseTo(Math.min(...corners.map((c) => c.x)), 9);
    expect(b.right).toBeCloseTo(Math.max(...corners.map((c) => c.x)), 9);
    expect(b.top).toBeCloseTo(Math.min(...corners.map((c) => c.y)), 9);
    expect(b.bottom).toBeCloseTo(Math.max(...corners.map((c) => c.y)), 9);
  });
});

describe('thresholdFeet', () => {
  it('is a fixed number of screen pixels at every zoom', () => {
    expect(thresholdFeet(8, 1, 40)).toBeCloseTo(0.2);
    expect(thresholdFeet(8, 2, 40)).toBeCloseTo(0.1); // zoomed in: fewer feet
    expect(thresholdFeet(8, 0.5, 40)).toBeCloseTo(0.4); // zoomed out: more feet
  });
});

describe('buildSnapCandidates', () => {
  it('has the walls, the room center and every other visible piece', () => {
    const c = buildSnapCandidates(
      [
        item({ id: 1 }),
        item({ id: 2, label: 'Bed', x: 5, y: 1, width: 4, height: 6 }),
        item({ id: 3, label: 'Hidden', x: 9, visible: false }),
      ],
      room,
      1,
    );
    expect(c.x.map((l) => l.pos)).toEqual([0, 12, 6, 5, 7, 9]);
    expect(c.y.map((l) => l.pos)).toEqual([0, 10, 5, 1, 4, 7]);
    expect(c.x.some((l) => l.source.kind === 'item' && l.source.id === 3)).toBe(false);
    expect(c.x.some((l) => l.source.kind === 'item' && l.source.id === 1)).toBe(false);
  });
});

describe('snapAxis', () => {
  const lines: SnapLine[] = buildSnapCandidates([], room, 0).x;

  it('returns null when nothing is within the threshold', () => {
    expect(snapAxis(1, 3, lines, T)).toBeNull();
  });

  it('snaps the start edge flush to the left wall', () => {
    const s = snapAxis(0.15, 2.15, lines, T)!;
    expect(s.delta).toBeCloseTo(-0.15);
    expect(s.matches[0]!.line.source).toEqual({ kind: 'wall', wall: 'left' });
  });

  it('never snaps the wrong side of a piece to a wall (no pulling through it)', () => {
    // The piece's right edge is 0.1 from the LEFT wall: outside the room, not a flush candidate.
    expect(snapAxis(-2.1, -0.1, lines, T)).toBeNull();
  });

  it('picks the closest of several candidates', () => {
    const many: SnapLine[] = [
      ...lines,
      ...buildSnapCandidates([item({ id: 2, label: 'A', x: 3.1, width: 1 })], room, 1).x.slice(3),
    ];
    // Piece spans 1..3: its end is 0.1 from A's start (3.1) - closer than anything else.
    const s = snapAxis(1, 3, many, T)!;
    expect(s.delta).toBeCloseTo(0.1);
    expect(s.matches[0]!.edge).toBe('end');
  });

  it('collects every line that coincides after snapping', () => {
    const c = buildSnapCandidates(
      [
        item({ id: 2, label: 'A', x: 4, y: 0, width: 2 }),
        item({ id: 3, label: 'B', x: 4, y: 6, width: 3 }),
      ],
      room,
      1,
    );
    const s = snapAxis(4.1, 6.1, c.x, T)!;
    expect(s.delta).toBeCloseTo(-0.1);
    const labels = s.matches.map((m) => (m.line.source.kind === 'item' ? m.line.source.label : ''));
    // start=4 lines up with A's and B's left edges, center=5 with A's center, end=6 with A's right.
    expect(labels.sort()).toEqual(['A', 'A', 'A', 'B']);
  });

  it('centers only snap to centers', () => {
    const c = buildSnapCandidates([], room, 0);
    // Center 6.1 -> room center 6.
    const s = snapAxis(5.1, 7.1, c.x, T)!;
    expect(s.delta).toBeCloseTo(-0.1);
    expect(s.matches[0]).toMatchObject({
      edge: 'center',
      line: { source: { kind: 'room-center' } },
    });
  });
});

describe('snapItem', () => {
  it('snaps x and y independently, exactly flush to the walls', () => {
    const r = snapItem(
      item({ x: 9.88, y: 0.13, width: 2, height: 2 }),
      buildSnapCandidates([], room, 1),
      T,
    );
    expect(r.x).toBe(10); // right edge on the right wall (12)
    expect(r.y).toBe(0); // top edge on the top wall
    expect(r.snapX && r.snapY).toBeTruthy();
  });

  it('leaves an axis alone when nothing is close on it', () => {
    const r = snapItem(item({ x: 3.3, y: 0.1 }), buildSnapCandidates([], room, 1), T);
    expect(r.x).toBe(3.3);
    expect(r.snapX).toBeNull();
    expect(r.y).toBe(0);
  });

  it('aligns edge to edge with another piece', () => {
    const bed = item({ id: 2, label: 'Bed', x: 4, y: 3, width: 5, height: 6 });
    const r = snapItem(
      item({ x: 2.15, y: 5.5, width: 1.7, height: 1.5 }),
      buildSnapCandidates([bed], room, 1),
      T,
    );
    // Right edge (3.85) snaps flush against the bed's left edge (4).
    expect(r.x).toBeCloseTo(2.3, 9);
    expect(describeSnap(r)).toBe('Against Bed');
  });

  it('works for rotated pieces through their rotated bounds', () => {
    // 4x2 piece rotated 90deg occupies a 2x4 box; its visual left edge is x + 1.
    const moving = item({ x: -0.9, y: 3, width: 4, height: 2, rotation: 90 });
    const r = snapItem(moving, buildSnapCandidates([], room, 1), T);
    expect(r.x).toBe(-1); // visual left edge exactly on the wall
    expect(r.bounds.left).toBeCloseTo(0, 9);
  });

  it('a threshold in screen pixels captures less when zoomed in', () => {
    const c = buildSnapCandidates([], room, 1);
    const near = item({ x: 0.15 });
    expect(snapItem(near, c, thresholdFeet(8, 1, PIXELS_PER_UNIT)).x).toBe(0); // 6px away: snaps
    expect(snapItem(near, c, thresholdFeet(8, 3, PIXELS_PER_UNIT)).x).toBe(0.15); // 18px: no
  });

  it('ignores hidden pieces', () => {
    const ghost = item({ id: 2, label: 'Ghost', x: 5, visible: false });
    const r = snapItem(item({ x: 2.9 }), buildSnapCandidates([ghost], room, 1), T);
    expect(r.x).toBe(2.9);
  });

  it('prefers a wall over a piece at the same distance', () => {
    const other = item({ id: 2, label: 'Shelf', x: 0, y: 5, width: 1 });
    const r = snapItem(item({ x: 0.1, y: 1 }), buildSnapCandidates([other], room, 1), T);
    expect(r.x).toBe(0);
    expect(describeSnap(r)).toBe('Against left wall');
  });
});

describe('bypass', () => {
  it('a zero threshold (Alt held / snapping off) never moves the piece', () => {
    const r = snapItem(item({ x: 0.05, y: 0.05 }), buildSnapCandidates([], room, 1), 0);
    expect(r).toMatchObject({ x: 0.05, y: 0.05, snapX: null, snapY: null });
  });
});

describe('snapNudge', () => {
  const c = buildSnapCandidates([], room, 1);

  it('keeps the fixed step when nothing is near', () => {
    const r = snapNudge(item({ x: 3, y: 3 }), 0.25, 0, c, T);
    expect(r.x).toBe(3.25);
    expect(r.snapX).toBeNull();
  });

  it('snaps when the step lands within the threshold', () => {
    const r = snapNudge(item({ x: 0.4, y: 3 }), -0.25, 0, c, T);
    expect(r.x).toBe(0);
    expect(describeSnap(r)).toBe('Against left wall');
  });

  it('only snaps on the axis that moved', () => {
    const r = snapNudge(item({ x: 0.1, y: 3 }), 0, 0.25, c, T);
    expect(r.x).toBe(0.1);
    expect(r.y).toBe(3.25);
  });

  it('never snaps back to where it started (a flush piece can always move away)', () => {
    const zoomedOut = thresholdFeet(8, 0.25, PIXELS_PER_UNIT); // 0.8 ft
    const r = snapNudge(item({ x: 0, y: 3 }), 0.25, 0, c, zoomedOut);
    expect(r.x).toBe(0.25);
  });
});

describe('snapGuides', () => {
  it('draws one guide per aligned position, spanning the aligned pieces', () => {
    const a = item({ id: 2, label: 'A', x: 4, y: 0, width: 2, height: 1 });
    const b = item({ id: 3, label: 'B', x: 4, y: 8, width: 3, height: 1 });
    const r = snapItem(item({ x: 4.1, y: 4, height: 2 }), buildSnapCandidates([a, b], room, 1), T);
    const g = snapGuides(r);
    const at4 = g.find((x) => x.axis === 'x' && x.pos === 4)!;
    expect(at4).toMatchObject({ from: 0, to: 9, kind: 'edge' });
    expect(g.find((x) => x.axis === 'x' && x.pos === 6)).toMatchObject({ from: 0, to: 6 });
  });

  it('marks wall and center guides', () => {
    const r = snapItem(item({ x: 0.1, y: 3.95 }), buildSnapCandidates([], room, 1), T);
    const g = snapGuides(r);
    expect(g.find((x) => x.axis === 'x')!.kind).toBe('wall');
    expect(g.find((x) => x.axis === 'y')!.kind).toBe('center');
    expect(snapGuides({ bounds: r.bounds, snapX: null, snapY: null })).toEqual([]);
  });
});

describe('describeSnap', () => {
  it('names walls, pieces and the room center', () => {
    const bed = item({ id: 2, label: 'Bed', x: 4, y: 3, width: 4, height: 6 });
    const c = buildSnapCandidates([bed], room, 1);
    expect(describeSnap(snapItem(item({ x: 4.1, y: 0.1 }), c, T))).toBe(
      'Aligned with Bed, Against top wall',
    );
    expect(
      describeSnap(snapItem(item({ x: 5.1, y: 4.05 }), buildSnapCandidates([], room, 1), T)),
    ).toBe('Centered in the room');
    expect(describeSnap({ snapX: null, snapY: null })).toBe('');
  });
});

describe('measureClearances', () => {
  it('measures to the walls on every side of a lone piece', () => {
    const m = measureClearances(itemBounds(item({ x: 2, y: 3, width: 2, height: 1 })), [], room, 1);
    expect(Object.fromEntries(m.map((x) => [x.side, x.distance]))).toEqual({
      left: 2,
      right: 8,
      top: 3,
      bottom: 6,
    });
    expect(m.every((x) => x.to === 'wall')).toBe(true);
    const left = m.find((x) => x.side === 'left')!;
    expect(left).toMatchObject({ x1: 0, x2: 2, y1: 3.5, y2: 3.5 });
  });

  it('stops at the nearest piece in a clear line, measured across the overlap', () => {
    const near = item({ id: 2, x: 6, y: 2, width: 1, height: 2 });
    const far = item({ id: 3, x: 9, y: 2, width: 1, height: 4 });
    const m = measureClearances(
      itemBounds(item({ x: 2, y: 3, width: 2, height: 2 })),
      [near, far],
      room,
      1,
    );
    const right = m.find((x) => x.side === 'right')!;
    expect(right).toMatchObject({ distance: 2, to: 'item', x1: 4, x2: 6, y1: 3.5 });
  });

  it('ignores pieces that are not in a straight line, hidden, or overlapping', () => {
    const diagonal = item({ id: 2, x: 6, y: 7 });
    const hidden = item({ id: 3, x: 5, y: 3, visible: false });
    const overlapping = item({ id: 4, x: 3, y: 3.5 });
    const m = measureClearances(
      itemBounds(item({ x: 2, y: 3, width: 2, height: 2 })),
      [diagonal, hidden, overlapping],
      room,
      1,
    );
    expect(m.find((x) => x.side === 'right')).toMatchObject({ distance: 8, to: 'wall' });
  });

  it('skips flush sides and sides outside the room', () => {
    const m = measureClearances(
      itemBounds(item({ x: 0, y: -1, width: 2, height: 2 })),
      [],
      room,
      1,
    );
    expect(m.map((x) => x.side).sort()).toEqual(['bottom', 'right']);
  });

  it('uses rotated bounds', () => {
    const m = measureClearances(
      itemBounds(item({ x: 1, y: 3, width: 4, height: 2, rotation: 90 })),
      [],
      room,
      1,
    );
    expect(m.find((x) => x.side === 'left')!.distance).toBeCloseTo(2, 9);
  });
});

describe('fitMeasurementLabels', () => {
  const m = measureClearances(
    itemBounds(item({ x: 0.3, y: 1.5, width: 2, height: 2 })),
    [],
    room,
    1,
  );

  it('formats in the unit system', () => {
    const labels = fitMeasurementLabels(m, 1, PIXELS_PER_UNIT, 'ft-in');
    expect(labels.find((l) => l.side === 'right')!.text).toBe(`9'8"`);
    expect(
      fitMeasurementLabels(m, 1, PIXELS_PER_UNIT, 'cm').find((l) => l.side === 'top')!.text,
    ).toBe('45.7 cm');
  });

  it('drops a gap too small on screen for its label, and more of them when zoomed out', () => {
    const at1 = fitMeasurementLabels(m, 1, PIXELS_PER_UNIT, 'ft-in').map((l) => l.side);
    expect(at1).not.toContain('left'); // 0.3 ft = 12px: no room for a label
    expect(at1).toContain('right');
    const tiny = fitMeasurementLabels(m, 0.25, PIXELS_PER_UNIT, 'ft-in').map((l) => l.side);
    expect(tiny.length).toBeLessThan(at1.length);
  });

  it('drops the smaller of two overlapping labels', () => {
    const crowded = [
      { side: 'left' as const, distance: 3, to: 'wall' as const, x1: 0, y1: 1, x2: 3, y2: 1 },
      {
        side: 'top' as const,
        distance: 1,
        to: 'wall' as const,
        x1: 1.5,
        y1: 0.5,
        x2: 1.5,
        y2: 1.5,
      },
    ];
    expect(fitMeasurementLabels(crowded, 1, PIXELS_PER_UNIT, 'ft').map((l) => l.side)).toEqual([
      'left',
    ]);
  });
});

describe('performance', () => {
  it('snapping and measuring stay cheap with 30 pieces (O(n) per pointer move)', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      item({
        id: i + 2,
        label: `P${i}`,
        x: (i % 6) * 2,
        y: Math.floor(i / 6) * 2,
        width: 1.5,
        height: 1.2,
        rotation: (i * 17) % 360,
      }),
    );
    const c = buildSnapCandidates(items, room, 1);
    const t0 = performance.now();
    for (let k = 0; k < 1000; k++) {
      const r = snapItem(item({ x: (k % 100) / 10, y: (k % 80) / 10 }), c, T);
      snapGuides(r);
      fitMeasurementLabels(
        measureClearances(r.bounds, items, room, 1),
        1,
        PIXELS_PER_UNIT,
        'ft-in',
      );
    }
    const perMove = (performance.now() - t0) / 1000;
    // Typically ~0.01 ms; a 16 ms frame budget leaves a huge margin even on a slow phone.
    expect(perMove).toBeLessThan(1);
  });
});
