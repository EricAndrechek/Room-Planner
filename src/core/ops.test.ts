import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkIntegrity, loadPlan } from './load';
import { wallFrame } from './geometry/walls';
import {
  addItem,
  addOpening,
  insertVertex,
  moveItem,
  moveRoom,
  moveVertex,
  nextId,
  removeItem,
  removeOpening,
  removeRoom,
  removeVertex,
  toInventory,
  updateItem,
  updateOpening,
} from './ops';
import type { Opening, Plan, Room } from './schema';

const plan = (): Plan => {
  const r = loadPlan(
    {
      version: 4,
      unit: 'ft',
      rooms: [
        {
          id: 'room-1',
          outline: [
            { x: 0, y: 0 },
            { x: 12, y: 0 },
            { x: 12, y: 10 },
            { x: 0, y: 10 },
          ],
          openings: [
            { id: 'door-1', kind: 'door', wall: 2, offset: 2, width: 3 },
            { id: 'window-1', kind: 'window', wall: 0, offset: 4, width: 4 },
          ],
        },
      ],
      items: [{ id: 'item-1', label: 'Bed', width: 5, depth: 6.5, placement: { x: 6, y: 4 } }],
    },
    'strict',
  );
  if (!r.ok) throw new Error('plan');
  return r.plan;
};

/** Where an opening is on the floor: its two ends. */
const ends = (room: Room, o: Opening) => {
  const f = wallFrame(room, o.wall);
  const at = (a: number) => ({ x: f.origin.x + f.along.x * a, y: f.origin.y + f.along.y * a });
  return [at(o.offset), at(o.offset + o.width)];
};

describe('items', () => {
  it('adds with the next id, moves, updates, takes out and removes', () => {
    let p = addItem(plan(), { label: 'Desk', width: 4, depth: 2 });
    expect(p.items[1]).toMatchObject({ id: 'item-2', shape: 'rect' });
    expect(p.items[1]!.placement).toBeUndefined();
    p = moveItem(p, 'item-2', { x: 3, y: 8 });
    expect(p.items[1]!.placement).toEqual({ x: 3, y: 8, rotation: 0 });
    p = updateItem(p, 'item-2', { label: 'Writing desk', id: 'ignored' });
    expect(p.items[1]).toMatchObject({ id: 'item-2', label: 'Writing desk' });
    p = toInventory(p, 'item-2');
    expect(p.items[1]).not.toHaveProperty('placement');
    expect(p.items[1]).toMatchObject({ label: 'Writing desk', width: 4 });
    p = removeItem(p, 'item-2');
    expect(p.items.map((i) => i.id)).toEqual(['item-1']);
    expect(checkIntegrity(p)).toEqual([]);
  });

  it('returns the same plan for an unknown id and never changes its input', () => {
    const p = plan();
    const before = structuredClone(p);
    expect(moveItem(p, 'nope', { x: 1, y: 1 })).toBe(p);
    expect(removeOpening(p, 'nope')).toBe(p);
    moveItem(p, 'item-1', { x: 1, y: 1 });
    expect(p).toEqual(before);
  });
});

describe('openings', () => {
  it('adds, changes and removes doors and windows', () => {
    let p = addOpening(plan(), 'room-1', { kind: 'door', wall: 1, offset: 1, width: 3 });
    expect(p.rooms[0]!.openings[2]).toMatchObject({
      id: 'door-2',
      type: 'swing-in',
      hinge: 'start',
    });
    p = updateOpening(p, 'door-2', { type: 'pocket', offset: 2 });
    expect(p.rooms[0]!.openings[2]).toMatchObject({ id: 'door-2', type: 'pocket', offset: 2 });
    p = removeOpening(p, 'door-2');
    expect(p.rooms[0]!.openings.map((o) => o.id)).toEqual(['door-1', 'window-1']);
    expect(nextId(p, 'window')).toBe('window-2');
  });
});

describe('corners', () => {
  it('insertVertex splits a wall and re-anchors its openings', () => {
    // Split the bottom wall (12 ft, running right to left) 4 ft from its start: the door at
    // offset 2 (2..5) is cut, and stays whole on the longer, second half.
    const p = insertVertex(plan(), 'room-1', 2, 1 / 3);
    const room = p.rooms[0]!;
    expect(room.outline).toHaveLength(5);
    expect(room.outline[3]).toEqual({ x: 8, y: 10 });
    expect(room.openings[0]).toMatchObject({ wall: 3, offset: 0, width: 3 });
    expect(room.openings[1]).toMatchObject({ wall: 0, offset: 4 }); // an earlier wall: unchanged
    expect(checkIntegrity(p)).toEqual([]);
  });

  it('removeVertex merges two walls, keeping openings where they were', () => {
    const split = insertVertex(plan(), 'room-1', 2, 0.75);
    const merged = removeVertex(split, 'room-1', 3);
    expect(merged.rooms[0]!.outline).toEqual(plan().rooms[0]!.outline);
    expect(merged.rooms[0]!.openings).toEqual(plan().rooms[0]!.openings);
  });

  it('moveVertex keeps each opening its distance from the corner that stayed', () => {
    // Move the bottom-right corner 2 ft right: the right wall's openings keep their offset from
    // its top; the bottom wall's door keeps its distance from the bottom-left corner.
    const p = moveVertex(plan(), 'room-1', 2, { x: 14, y: 10 });
    const before = ends(plan().rooms[0]!, plan().rooms[0]!.openings[0]!);
    const after = ends(p.rooms[0]!, p.rooms[0]!.openings[0]!);
    expect(after[1]!.x).toBeCloseTo(before[1]!.x, 9);
    expect(after[0]!.x).toBeCloseTo(before[0]!.x, 9);
    expect(checkIntegrity(p)).toEqual([]);
  });

  it('refuses a corner move that would cross the outline, and a third corner removed', () => {
    const p = plan();
    expect(moveVertex(p, 'room-1', 2, { x: -5, y: -5 })).toBe(p);
    const triangle = removeVertex(p, 'room-1', 2);
    expect(triangle.rooms[0]!.outline).toHaveLength(3);
    expect(removeVertex(triangle, 'room-1', 0)).toBe(triangle);
  });

  it('refuses a corner that would leave walls almost touching', () => {
    // A counterexample the property below found: the triangle's corners pile up near (0, 0).
    let p = removeVertex(plan(), 'room-1', 1);
    p = insertVertex(p, 'room-1', 0, 0.05172476760274019);
    p = removeVertex(p, 'room-1', 3 % p.rooms[0]!.outline.length);
    p = insertVertex(p, 'room-1', 0, 0.05);
    expect(checkIntegrity(p)).toEqual([]);
  });

  it('after any sequence of corner edits, openings are on their walls and unchanged walls did not move', () => {
    const op = fc.oneof(
      fc.record({
        kind: fc.constant('insert' as const),
        wall: fc.nat(20),
        t: fc.double({ min: 0.05, max: 0.95, noNaN: true }),
      }),
      fc.record({ kind: fc.constant('remove' as const), i: fc.nat(20) }),
      fc.record({
        kind: fc.constant('move' as const),
        i: fc.nat(20),
        dx: fc.double({ min: -3, max: 3, noNaN: true }),
        dy: fc.double({ min: -3, max: 3, noNaN: true }),
      }),
    );
    fc.assert(
      fc.property(fc.array(op, { maxLength: 12 }), (ops) => {
        let p = plan();
        for (const o of ops) {
          const room = p.rooms[0]!;
          const n = room.outline.length;
          let next: Plan;
          let changed: number[];
          if (o.kind === 'insert') {
            const w = o.wall % n;
            next = insertVertex(p, 'room-1', w, o.t);
            changed = [w];
          } else if (o.kind === 'remove') {
            const i = o.i % n;
            next = removeVertex(p, 'room-1', i);
            changed = [(i - 1 + n) % n, i];
          } else {
            const i = o.i % n;
            const c = room.outline[i]!;
            next = moveVertex(p, 'room-1', i, { x: c.x + o.dx, y: c.y + o.dy });
            changed = [(i - 1 + n) % n, i];
          }
          // Every opening fits a wall of its room.
          expect(checkIntegrity(next)).toEqual([]);
          if (next !== p) {
            // Openings on walls the edit did not touch are where they were on the floor.
            room.openings.forEach((before, k) => {
              if (changed.includes(before.wall)) return;
              const after = next.rooms[0]!.openings[k]!;
              const [a0, a1] = ends(room, before);
              const [b0, b1] = ends(next.rooms[0]!, after);
              for (const [a, b] of [
                [a0, b0],
                [a1, b1],
              ] as const) {
                expect(b!.x).toBeCloseTo(a!.x, 9);
                expect(b!.y).toBeCloseTo(a!.y, 9);
              }
            });
          }
          p = next;
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('rooms', () => {
  it('moveRoom takes the pieces in it along; removeRoom puts them in the inventory', () => {
    let p = plan();
    p = {
      ...p,
      rooms: [
        ...p.rooms,
        {
          ...p.rooms[0]!,
          id: 'room-2',
          outline: p.rooms[0]!.outline.map((q) => ({ x: q.x + 12, y: q.y })),
          openings: [],
        },
      ],
    };
    p = addItem(p, { label: 'Lamp', width: 1, depth: 1, placement: { x: 20, y: 5, rotation: 0 } });
    const moved = moveRoom(p, 'room-2', 0, 3);
    expect(moved.items[1]!.placement).toMatchObject({ x: 20, y: 8 });
    expect(moved.items[0]!.placement).toEqual(p.items[0]!.placement);
    const removed = removeRoom(p, 'room-2');
    expect(removed.rooms).toHaveLength(1);
    expect(removed.items[1]).not.toHaveProperty('placement');
    expect(removeRoom(removed, 'room-1')).toBe(removed); // the last room stays
  });
});
