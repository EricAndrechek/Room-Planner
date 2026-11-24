import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkLayout } from './check';
import {
  besideRoom,
  doorConnections,
  floorBounds,
  neighbourOf,
  outlinesOverlap,
  overlappedRooms,
  roomAt,
  roomName,
  sharedWalls,
  snapRoomMove,
} from './floor';
import { lOutline } from './geometry/walls';
import { loadPlan } from './load';
import { addRoom, removeRoom, renameRoom } from './ops';
import type { Plan, Room } from './schema';

const rect = (w: number, h: number, x = 0, y = 0) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const load = (doc: Partial<Plan> & { rooms: unknown[] }): Plan => {
  const r = loadPlan({ version: 4, unit: 'ft', items: [], ...doc }, 'strict');
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};

const at = (x: number, y: number) => ({ x, y, rotation: 0 });

/** Bedroom 12 x 10 at the origin, Hall 6 x 10 to its right (sharing its right wall). */
const twoRooms = (openings: unknown[] = [], items: unknown[] = []) =>
  load({
    rooms: [
      { id: 'bed', name: 'Bedroom', outline: rect(12, 10), openings },
      { id: 'hall', name: 'Hall', outline: rect(6, 10, 12, 0), openings: [] },
    ],
    items: items as Plan['items'],
  });

describe('shared walls', () => {
  it('finds the wall two flush rooms share, once, along the first room’s wall', () => {
    expect(sharedWalls(twoRooms())).toEqual([
      {
        a: 'bed',
        wallA: 1,
        b: 'hall',
        wallB: 3,
        from: 0,
        to: 10,
        start: { x: 12, y: 0 },
        end: { x: 12, y: 10 },
      },
    ]);
  });

  it('a partly shared wall shares only the overlap; rooms apart or meeting at a corner share none', () => {
    const p = load({
      rooms: [
        { id: 'a', outline: rect(12, 10), openings: [] },
        { id: 'b', outline: rect(4, 4, 12, 3), openings: [] },
        { id: 'c', outline: rect(4, 4, 30, 0), openings: [] },
        { id: 'd', outline: rect(4, 4, 12, 10), openings: [] },
      ],
    });
    const s = sharedWalls(p);
    expect(s.map((w) => [w.a, w.b, w.from, w.to])).toEqual([['a', 'b', 3, 7]]);
  });

  it('works for an L-shaped room and a room in its notch', () => {
    const l = lOutline({ width: 12, height: 10, corner: 'tr', cutWidth: 5, cutHeight: 4 });
    const p = load({
      rooms: [
        { id: 'l', outline: l, openings: [] },
        { id: 'n', outline: rect(5, 4, 7, 0), openings: [] },
      ],
    });
    const s = sharedWalls(p);
    // The notch room touches the L along its two inner walls.
    expect(s).toHaveLength(2);
    expect(outlinesOverlap(p.rooms[0]!, p.rooms[1]!)).toBe(false);
  });
});

describe('doors between rooms', () => {
  it('a door on the shared wall connects the two rooms; one on an outside wall does not', () => {
    const p = twoRooms([
      { id: 'door-1', kind: 'door', wall: 1, offset: 3, width: 3 },
      { id: 'door-2', kind: 'door', wall: 2, offset: 3, width: 3 },
    ]);
    const bed = p.rooms[0]!;
    expect(neighbourOf(p, bed, bed.openings[0]!)?.id).toBe('hall');
    expect(neighbourOf(p, bed, bed.openings[1]!)).toBeNull();
    expect(doorConnections(p).map((c) => [c.door.id, c.room.id, c.other.id])).toEqual([
      ['door-1', 'bed', 'hall'],
    ]);
  });

  it('door-blocking looks at both rooms: a swing out into the next room, and both doorways', () => {
    const door = { id: 'door-1', kind: 'door', wall: 1, offset: 3, width: 3, type: 'swing-out' };
    // A chair in the hall, right where the door swings.
    const swing = twoRooms(
      [door],
      [{ id: 'chair', label: 'Chair', width: 1, depth: 1, placement: at(13, 4.5) }],
    );
    expect(checkLayout(swing, { codes: ['door_blocked'] }).map((i) => i.message)).toEqual([
      'Chair is in the way of the door between Bedroom and Hall.',
    ]);
    // The same chair with a sliding door (no swing): it stands in the hall's doorway.
    const sliding = twoRooms(
      [{ ...door, type: 'sliding' }],
      [{ id: 'chair', label: 'Chair', width: 1, depth: 1, placement: at(12.6, 4.5) }],
    );
    expect(checkLayout(sliding, { codes: ['door_blocked', 'doorway_blocked'] })).toMatchObject([
      { code: 'doorway_blocked', ids: ['chair', 'door-1'] },
    ]);
  });

  it('a window on a shared wall is reported; on an outside wall it is not', () => {
    const p = twoRooms([
      { id: 'window-1', kind: 'window', wall: 1, offset: 3, width: 3 },
      { id: 'window-2', kind: 'window', wall: 0, offset: 3, width: 3 },
    ]);
    expect(checkLayout(p, { codes: ['window_between_rooms'] })).toMatchObject([
      {
        code: 'window_between_rooms',
        ids: ['window-1', 'bed'],
        message: 'The window window-1 is on a wall Bedroom shares with Hall.',
      },
    ]);
  });
});

describe('overlap', () => {
  const room = (outline: Room['outline']) => ({ outline });
  it('flush rooms and rooms meeting at a corner do not overlap; others do', () => {
    expect(outlinesOverlap(room(rect(10, 10)), room(rect(5, 5, 10, 0)))).toBe(false);
    expect(outlinesOverlap(room(rect(10, 10)), room(rect(5, 5, 10, 10)))).toBe(false);
    expect(outlinesOverlap(room(rect(10, 10)), room(rect(5, 5, 9, 2)))).toBe(true);
    expect(outlinesOverlap(room(rect(10, 10)), room(rect(10, 10)))).toBe(true);
    expect(outlinesOverlap(room(rect(10, 10)), room(rect(2, 2, 4, 4)))).toBe(true);
    expect(outlinesOverlap(room(rect(10, 10)), room(rect(10, 2, 0, 0)))).toBe(true);
    // A cross: no corner of either inside the other, but the walls cross.
    expect(outlinesOverlap(room(rect(10, 2, 0, 4)), room(rect(2, 10, 4, 0)))).toBe(true);
  });

  it('is reported by the check', () => {
    const p = load({
      rooms: [
        { id: 'a', name: 'Kitchen', outline: rect(10, 10), openings: [] },
        { id: 'b', outline: rect(5, 5, 8, 8), openings: [] },
      ],
    });
    expect(checkLayout(p, { codes: ['room_overlap'] }).map((i) => i.message)).toEqual([
      'Kitchen overlaps Room 2.',
    ]);
  });
});

describe('a new room beside another', () => {
  it('goes against the right side first, then the bottom, left and top', () => {
    const base = load({ rooms: [{ id: 'a', outline: rect(12, 10), openings: [] }] });
    const r1 = besideRoom(base, base.rooms[0]!, rect(10, 10));
    expect(r1).toEqual({ outline: rect(10, 10, 12, 0), side: 'right' });
    const two = addRoom(base, { id: 'b', outline: r1.outline });
    const r2 = besideRoom(two, two.rooms[0]!, rect(10, 10));
    expect(r2.side).toBe('bottom');
    expect(r2.outline).toEqual(rect(10, 10, 0, 10));
    const three = addRoom(two, { id: 'c', outline: r2.outline });
    expect(besideRoom(three, three.rooms[0]!, rect(10, 10)).side).toBe('left');
    expect(
      sharedWalls(addRoom(three, besideRoom(three, three.rooms[0]!, rect(10, 10)))).length,
    ).toBe(3);
  });

  it('never overlaps a room, and shares a wall with the room it was put beside (property)', () => {
    const size = fc.integer({ min: 2, max: 20 });
    fc.assert(
      fc.property(
        fc.array(fc.tuple(size, size, fc.nat(4)), { minLength: 1, maxLength: 7 }),
        (rooms) => {
          let p = load({ rooms: [{ id: 'room-1', outline: rect(10, 10), openings: [] }] });
          for (const [w, h, from] of rooms) {
            const anchor = p.rooms[from % p.rooms.length]!;
            const { outline, side } = besideRoom(p, anchor, rect(w, h));
            expect(overlappedRooms(p, { outline })).toEqual([]);
            const next = addRoom(p, { outline });
            if (side) {
              const id = next.rooms[next.rooms.length - 1]!.id;
              expect(
                sharedWalls(next).some(
                  (s) => (s.a === anchor.id && s.b === id) || (s.b === anchor.id && s.a === id),
                ),
              ).toBe(true);
            }
            p = next;
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('moving a room', () => {
  const p = load({
    rooms: [
      { id: 'a', outline: rect(12, 10), openings: [] },
      { id: 'b', outline: rect(6, 6, 20, 0), openings: [] },
    ],
  });
  it('lines its corners up with another room’s within the threshold, so the walls are flush', () => {
    // Room b dragged 7.8 ft left: its left wall lands 0.2 ft from room a's right wall.
    const s = snapRoomMove(p, 'b', -7.8, 0.15, 0.3);
    expect(s.dx).toBe(-8);
    expect(s.dy).toBe(0);
    expect(s.guides.map((g) => [g.axis, g.pos])).toEqual([
      ['x', 12],
      ['y', 0],
    ]);
  });
  it('without anything near, rounds to the step (or not at all)', () => {
    expect(snapRoomMove(p, 'b', 3.13, 20.4, 0.3, 0.25)).toMatchObject({
      dx: 3.25,
      dy: 20.5,
      guides: [],
    });
    expect(snapRoomMove(p, 'b', 3.13, 20.4, 0.3)).toMatchObject({ dx: 3.13, dy: 20.4 });
  });
});

describe('rooms', () => {
  it('names rooms by their name, else by their place in the list', () => {
    const p = twoRooms();
    expect(roomName(p, p.rooms[0]!)).toBe('Bedroom');
    const unnamed = renameRoom(p, 'hall', '  ');
    expect(unnamed.rooms[1]).not.toHaveProperty('name');
    expect(roomName(unnamed, unnamed.rooms[1]!)).toBe('Room 2');
    expect(renameRoom(p, 'hall', ' Hallway ').rooms[1]!.name).toBe('Hallway');
    expect(renameRoom(p, 'hall', 'Hall')).toBe(p);
  });

  it('finds the room a point is in, and the floor’s box', () => {
    const p = twoRooms();
    expect(roomAt(p, { x: 3, y: 3 })?.id).toBe('bed');
    expect(roomAt(p, { x: 15, y: 3 })?.id).toBe('hall');
    expect(roomAt(p, { x: 30, y: 3 })).toBeNull();
    expect(floorBounds(p)).toEqual({ left: 0, top: 0, right: 18, bottom: 10 });
  });

  it('deleting a room sets its pieces aside (and only its pieces), in one edit', () => {
    const p = twoRooms(
      [],
      [
        { id: 'bed-1', label: 'Bed', width: 5, depth: 6, placement: at(4, 4) },
        { id: 'bench', label: 'Bench', width: 3, depth: 1, placement: at(15, 5) },
      ],
    );
    const next = removeRoom(p, 'hall');
    expect(next.rooms.map((r) => r.id)).toEqual(['bed']);
    expect(next.items[0]).toEqual(p.items[0]);
    expect(next.items[1]).not.toHaveProperty('placement');
    expect(next.items[1]).toMatchObject({ label: 'Bench', width: 3, depth: 1 });
  });
});
