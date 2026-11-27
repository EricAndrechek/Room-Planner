import { describe, expect, it } from 'vitest';
import { checkItemsCollision } from '../core/geometry';
import { sweptArea, openingDoorGeometry } from '../core/geometry/doors';
import { loadPlan } from '../core/load';
import { OPENING_GAP, findFurnitureSpot } from '../core/placement';
import { defaultLayout } from '../core/testing/v3/layout';
import type { Door, FurnitureItem, Layout, RoomWindow, Wall } from '../core/testing/v3/types';
import { lOutline, lShapeOf, roomBounds, wallFrame } from '../core/geometry/walls';
import { overlappedRooms, sharedWalls } from '../core/floor';
import { checkIntegrity } from '../core/load';
import type { Plan } from '../core/schema';
import {
  addCorner,
  addDoor,
  addRoomBeside,
  deleteRoom,
  duplicatePiece,
  duplicateRoom,
  moveRoomBy,
  placePieceAt,
  setRoomPosition,
  addPiece,
  addWindow,
  changePiece,
  clearPieces,
  moveCorner,
  moveOpeningToWall,
  movePieceClear,
  movePieceInside,
  movePiecesInside,
  narrowedOpenings,
  openingSpot,
  removeCorner,
  setRoomShape,
  setWallLength,
  slideOpening,
  placePiece,
  takeOutPiece,
  toggleHidden,
  toggleLock,
  updateOpening,
} from './edits';
import {
  WALLS,
  boxOf,
  editablePlan,
  inventoryPieces,
  itemWarnings,
  mainRoom,
  openingPlace,
  placedPieces,
  wallIndex,
} from './plans';

const toPlan = (layout: Layout) => {
  const r = loadPlan(layout, 'strict', { lengthsInFeet: true });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};

describe('updateOpening', () => {
  const door: Door = {
    id: 1,
    width: 3,
    position: 6,
    wall: 'bottom',
    hinge: 'left',
    type: 'swing-in',
  };
  const rect = { width: 14, height: 10 };
  const plan = toPlan({ roomDims: rect, doors: [door], windows: [], items: [] });
  /** The door after an edit, in the editor's terms. */
  const edit = (patch: Parameters<typeof updateOpening>[2], minWidth = 1) => {
    const room = mainRoom(updateOpening(plan, 'door-1', patch, minWidth));
    return openingPlace(room, room.openings[0]!);
  };

  it('clamps width and position to the wall', () => {
    expect(edit({ position: 20 }).position).toBe(11);
    expect(edit({ width: 50 })).toMatchObject({ width: 14, position: 0 });
    expect(edit({ width: 0.2 }).width).toBe(1);
    expect(edit({ width: 0.2 }, 0.5).width).toBe(0.5);
  });

  it('returns the same plan for an unknown id', () => {
    expect(updateOpening(plan, 'door-99', { width: 2 }, 1)).toBe(plan);
  });
});

describe('openingSpot', () => {
  const door = (wall: Wall, position: number, width = 3): Door => ({
    id: `${wall}${position}`.replace('.', '_'),
    width,
    position,
    wall,
    hinge: 'left',
    type: 'swing-in',
  });
  const win = (wall: Wall, position: number, width = 3): RoomWindow => ({
    id: `w${wall}${position}`.replace('.', '_'),
    width,
    position,
    wall,
  });
  const room12 = { width: 12, height: 12 };
  const DOOR = { wall: 'bottom', position: 2 } as const;
  const find = (
    layout: Partial<Layout> & { roomDims: Layout['roomDims'] },
    width: number,
    preferred: { wall: Wall; position: number },
    swing?: Parameters<typeof openingSpot>[3],
  ) => {
    // The edits number walls; these tests name a rectangle's.
    const spot = openingSpot(
      toPlan({ doors: [], windows: [], items: [], ...layout }),
      width,
      { ...preferred, wall: wallIndex(preferred.wall) },
      swing,
    );
    return { ...spot, wall: WALLS[spot.wall]! };
  };
  const at = (doors: Door[], windows: RoomWindow[] = [], roomDims = room12, width = 3) =>
    find({ roomDims, doors, windows }, width, DOOR);

  it('uses the default spot on an empty wall', () => {
    expect(at([])).toEqual({ wall: 'bottom', position: 2 });
  });

  it('goes to the first free spot after the openings already on the wall', () => {
    expect(at([door('bottom', 2)])).toEqual({ wall: 'bottom', position: 5 + OPENING_GAP });
    // 9..12 is free but flush with the corner, so the next wall's default spot wins.
    expect(at([door('bottom', 2), door('bottom', 5.5)])).toEqual({ wall: 'top', position: 2 });
    // A free stretch before the first opening counts too.
    expect(at([door('bottom', 1), door('bottom', 8)])).toEqual({
      wall: 'bottom',
      position: 4 + OPENING_GAP,
    });
    // The default spot is kept when it is clear (the starter door sits at 6..9).
    expect(at([door('bottom', 6)])).toEqual({ wall: 'bottom', position: 2 });
  });

  it('keeps at least the gap between neighbours', () => {
    // 2..5 and 9..12 taken: 5.5..8.5 leaves exactly the gap on both sides.
    expect(at([door('bottom', 2), door('bottom', 9)])).toEqual({ wall: 'bottom', position: 5.5 });
    // With 8.9..11.9 taken, 5.5..8.5 would come within 0.4ft: no room on the bottom wall.
    expect(at([door('bottom', 2), door('bottom', 8.9)]).wall).toBe('top');
  });

  it('moves on to the next wall (top, right, bottom, left order) when the wall is full', () => {
    const fullBottom = [
      door('bottom', 0),
      door('bottom', 3.5),
      door('bottom', 7),
      door('bottom', 10.5, 1.5),
    ];
    expect(at(fullBottom)).toEqual({ wall: 'top', position: 2 });
    expect(at([...fullBottom], [win('top', 0, 12)])).toEqual({ wall: 'right', position: 2 });
  });

  it('treats doors and windows alike as obstacles', () => {
    expect(at([], [win('bottom', 1, 4)])).toEqual({ wall: 'bottom', position: 5 + OPENING_GAP });
    expect(
      find({ roomDims: room12, doors: [door('top', 2)] }, 3, { wall: 'top', position: 2 }),
    ).toEqual({ wall: 'top', position: 5.5 });
  });

  it('falls back to the default when every wall is full', () => {
    const full = (['top', 'right', 'bottom', 'left'] as Wall[]).map((w) => win(w, 0, 12));
    expect(at([], full)).toEqual({ wall: 'bottom', position: 2 });
  });

  it('skips walls shorter than the opening, and falls back when the room is too small', () => {
    // 2ft wide room: top/bottom are too short for a 3ft door, left/right are 10ft long.
    expect(at([], [], { width: 2, height: 10 })).toEqual({ wall: 'right', position: 2 });
    expect(at([], [], { width: 2, height: 2 })).toEqual({ wall: 'bottom', position: 2 });
  });

  it('keeps a corner margin, unless the corner is the only place left', () => {
    // On a 4ft wall the default (2) is clamped to 1, flush with the far corner: 0.5 keeps both margins.
    expect(at([], [], { width: 4, height: 4 })).toEqual({ wall: 'bottom', position: 0.5 });
    expect(at([door('bottom', 0.5)]).position).not.toBe(0);
    // A 3ft wall only fits a 3ft door corner to corner: that is still better than nothing.
    expect(at([], [], { width: 3, height: 3 })).toEqual({ wall: 'bottom', position: 0 });
    // Every wall has only a flush-with-the-corner gap left: use the first one.
    const tight = (['top', 'right', 'bottom', 'left'] as Wall[]).map((w) => win(w, 0, 8.5));
    expect(at([], tight)).toEqual({ wall: 'bottom', position: 9 });
  });

  describe('keeps a new door swing clear of furniture', () => {
    const furniture = (patch: Partial<FurnitureItem>): FurnitureItem => ({
      id: 'f',
      label: 'Piece',
      width: 2,
      height: 2,
      x: 0,
      y: 0,
      rotation: 0,
      color: '#93c5fd',
      ...patch,
    });
    const swing = { type: 'swing-in', hinge: 'left' } as const;
    const place = (items: FurnitureItem[], doors: Door[] = []) =>
      find({ roomDims: room12, doors, items }, 3, DOOR, swing);

    it('skips spots whose swing hits a piece, on the same wall first', () => {
      // A chest in front of the default spot (2..5 along the bottom, 9..12 deep).
      const chest = furniture({ id: 'chest', x: 2, y: 10, width: 2, height: 1.5 });
      expect(place([chest])).toEqual({ wall: 'bottom', position: 4 }); // flush is fine
      // Rotated pieces use their rotated outline: a 4x0.5 bar turned 45deg, centered at
      // (7.5, 10.5), reaches from x 5.9 to 9.1, so it blocks 4..7 but not the default 2..5...
      const bar = furniture({ id: 'bar', x: 5.5, y: 10.25, width: 4, height: 0.5, rotation: 45 });
      expect(place([bar])).toEqual({ wall: 'bottom', position: 2 });
      // ...and with the chest too, 4..7 is the first clear spot: the bar crosses the swing's
      // bounding square there, but neither the quarter circle the leaf really sweeps nor the
      // doorway in front of it.
      expect(place([bar, chest])).toEqual({ wall: 'bottom', position: 4 });
    });

    it('keeps the doorway clear too, for every door type', () => {
      const chair = furniture({ x: 2.5, y: 11, width: 1, height: 1 });
      for (const type of ['swing-out', 'pocket', 'opening', 'sliding'] as const) {
        expect(
          find({ roomDims: room12, items: [chair] }, 3, DOOR, { type, hinge: 'left' }),
        ).not.toEqual({ wall: 'bottom', position: 2 });
      }
    });

    it('moves to another wall when the whole wall is blocked, and ignores hidden pieces', () => {
      const bench = furniture({ x: 0, y: 10, width: 12, height: 2 });
      expect(place([bench])).toEqual({ wall: 'top', position: 2 });
      expect(place([{ ...bench, visible: false }])).toEqual({ wall: 'bottom', position: 2 });
    });

    it('falls back to the free-spot rule when every swing would hit furniture', () => {
      const rug = furniture({ x: 0, y: 0, width: 12, height: 12 });
      expect(place([rug])).toEqual({ wall: 'bottom', position: 2 });
      expect(place([rug], [door('bottom', 2)])).toEqual({ wall: 'bottom', position: 5.5 });
    });

    it('ignores furniture for windows, and for the swing of doors that open outside', () => {
      const rug = furniture({ x: 0, y: 0, width: 12, height: 12 });
      expect(find({ roomDims: room12, items: [rug] }, 3, { wall: 'top', position: 2 })).toEqual({
        wall: 'top',
        position: 2,
      });
      // A desk 2.5-3.5 ft into the room: in a swing-in door's swing at 2..5, but not in its
      // doorway (1.5 ft deep). A swing-out door there only needs its doorway clear.
      const desk = furniture({ x: 2, y: 8.5, width: 3, height: 1 });
      expect(place([desk])).not.toEqual({ wall: 'bottom', position: 2 });
      expect(
        find({ roomDims: room12, items: [desk] }, 3, DOOR, { type: 'swing-out', hinge: 'left' }),
      ).toEqual({ wall: 'bottom', position: 2 });
    });
  });
});

describe('adding doors to the starter room', () => {
  it('puts each new door away from the corners with its swing clear of the furniture', () => {
    const start = toPlan(defaultLayout());
    let plan = start;
    for (let n = 0; n < 3; n++) {
      const added = addDoor(plan);
      plan = added.plan;
      const room = mainRoom(plan);
      const spot = openingPlace(room, added.door);
      const len = 12; // the starter room is 12' x 12'
      expect(spot.position).toBeGreaterThanOrEqual(0.5);
      expect(spot.position + 3).toBeLessThanOrEqual(len - 0.5);
      const pts = sweptArea(openingDoorGeometry(room, added.door).leaves[0]!, 15);
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const box = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        rotation: 0,
      };
      for (const item of start.items) {
        expect(checkItemsCollision(boxOf(item), box), item.label).toBe(false);
      }
    }
  });
});

describe('moveOpeningToWall', () => {
  const room = { width: 12, height: 10 };
  const win = (id: number, wall: Wall, position: number, width = 3): RoomWindow => ({
    id,
    width,
    position,
    wall,
  });
  /** Where `window 1` lands on `wall` (its position there), or null if it fits nowhere. */
  const moved = (windows: RoomWindow[], wall: Wall) => {
    const plan = moveOpeningToWall(
      toPlan({ roomDims: room, doors: [], windows, items: [] }),
      'window-1',
      wallIndex(wall),
    );
    if (!plan) return null;
    const r = mainRoom(plan);
    return openingPlace(
      r,
      r.openings.find((o) => o.id === 'window-1')!,
    ).position;
  };

  it('keeps the position when it is free on the new wall', () => {
    expect(moved([win(1, 'top', 4)], 'left')).toBe(4);
  });

  it('never lands on another opening: moves along the wall instead', () => {
    const pos = moved([win(1, 'top', 3), win(2, 'left', 3, 3)], 'left')!;
    expect(pos).not.toBeNull();
    // At least OPENING_GAP clear of the window at 3..6.
    expect(pos + 3 <= 3 - 0.5 || pos >= 6 + 0.5).toBe(true);
  });

  it('is null when the wall is full or shorter than the opening', () => {
    const full = [win(2, 'left', 0, 4.5), win(3, 'left', 5.5, 4.5)];
    expect(moved([win(1, 'top', 2), ...full], 'left')).toBeNull();
    expect(moved([win(1, 'top', 0, 11)], 'left')).toBeNull();
  });
});

describe('addPiece', () => {
  it('adds a 3 x 2 piece in the middle of an empty room', () => {
    const plan = toPlan({ roomDims: { width: 12, height: 12 }, doors: [], windows: [], items: [] });
    const { plan: next, item } = addPiece(plan, '#93c5fd');
    expect(next.items).toEqual([item]);
    expect(boxOf(item)).toEqual({ x: 4.5, y: 5, width: 3, height: 2, rotation: 0 });
  });

  it('in the sample room, lands in free floor: inside, no overlap, no door blocked', () => {
    const { plan, item } = addPiece(toPlan(defaultLayout()), '#93c5fd');
    expect(itemWarnings(plan).get(item.id)).toEqual({ outOfBounds: false, collision: false });
  });
});

describe('movePiecesInside', () => {
  it('moves every shown piece outside the room back in, and leaves the rest', () => {
    const plan = toPlan(defaultLayout());
    const out = changePiece(changePiece(plan, 'item-1', { x: 10 }), 'item-2', { y: -1 });
    const fixed = movePiecesInside(out);
    expect(boxOf(fixed.items[0]!)).toMatchObject({ x: 7, y: 0 });
    expect(boxOf(fixed.items[1]!)).toMatchObject({ y: 0 });
    expect(fixed.items.slice(2)).toEqual(plan.items.slice(2));
    expect(movePiecesInside(plan)).toBe(plan);
  });
});

describe('fixing one warning in place', () => {
  it('movePieceInside brings just that piece in (one plan change), and is a no-op inside', () => {
    const plan = toPlan(defaultLayout());
    const out = changePiece(changePiece(plan, 'item-1', { x: 10 }), 'item-2', { y: -1 });
    const fixed = movePieceInside(out, 'item-1');
    expect(boxOf(fixed.items[0]!)).toMatchObject({ x: 7, y: 0 });
    // The other stranded piece is not touched.
    expect(fixed.items[1]).toEqual(out.items[1]);
    expect(movePieceInside(plan, 'item-1')).toBe(plan);
  });

  it('movePieceClear moves a piece out of a door swing to the nearest clear spot, same turn', () => {
    const door: Door = {
      id: 1,
      width: 3,
      position: 4,
      wall: 'bottom',
      hinge: 'left',
      type: 'swing-in',
    };
    const chair: FurnitureItem = {
      id: 2,
      label: 'Chair',
      width: 1,
      height: 1,
      x: 5,
      y: 9.6,
      rotation: 0,
      color: '#fdba74',
      visible: true,
    };
    const plan = toPlan({
      roomDims: { width: 12, height: 12 },
      doors: [door],
      windows: [],
      items: [chair],
    });
    expect(itemWarnings(plan).get('item-2')?.blocksDoor).toBe(true);
    const moved = movePieceClear(plan, 'item-2')!;
    expect(moved).not.toBeNull();
    const w = itemWarnings(moved).get('item-2');
    expect(w?.blocksDoor ?? false).toBe(false);
    expect(w?.blocksDoorway ?? false).toBe(false);
    expect(w?.collision ?? false).toBe(false);
    expect(w?.outOfBounds ?? false).toBe(false);
    const before = boxOf(plan.items[0]!);
    const after = boxOf(moved.items[0]!);
    expect(after.rotation).toBe(before.rotation);
    // Nearby: within a few feet of where it was.
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(4);
  });

  it('movePieceClear moves an overlapping piece off the other one', () => {
    const plan = toPlan(defaultLayout());
    const a = boxOf(plan.items[0]!);
    const overlapping = changePiece(plan, 'item-2', { x: a.x + 0.5, y: a.y + 0.5 });
    expect(itemWarnings(overlapping).get('item-2')?.collision).toBe(true);
    const moved = movePieceClear(overlapping, 'item-2')!;
    expect(itemWarnings(moved).get('item-2')?.collision ?? false).toBe(false);
  });

  it('movePieceClear is null when nothing is free (a piece as big as the room)', () => {
    const plan = toPlan({
      roomDims: { width: 4, height: 4 },
      doors: [],
      windows: [],
      items: [
        {
          id: 1,
          label: 'A',
          width: 4,
          height: 4,
          x: 0,
          y: 0,
          rotation: 0,
          color: '#ffffff',
          visible: true,
        },
        {
          id: 2,
          label: 'B',
          width: 2,
          height: 2,
          x: 1,
          y: 1,
          rotation: 0,
          color: '#ffffff',
          visible: true,
        },
      ],
    });
    expect(movePieceClear(plan, 'item-2')).toBeNull();
  });
});

describe('room shapes', () => {
  const blank = (): Plan =>
    toPlan({ roomDims: { width: 12, height: 10 }, doors: [], windows: [], items: [] });
  const L = { width: 12, height: 10, corner: 'br', cutWidth: 5, cutHeight: 4 } as const;

  it('setRoomShape makes an L from the room and back to its bounding box', () => {
    const l = setRoomShape(blank(), { kind: 'l', l: L });
    expect(mainRoom(l).outline).toEqual(lOutline(L));
    expect(setRoomShape(l, { kind: 'l', l: L })).toBe(l);
    const back = setRoomShape(l, { kind: 'rect' });
    expect(mainRoom(back).outline).toEqual(mainRoom(blank()).outline);
    // A cut too big for the room is kept inside it, half a foot from each side.
    const big = setRoomShape(blank(), { kind: 'l', l: { ...L, cutWidth: 40 } });
    expect(lShapeOf(mainRoom(big))).toMatchObject({ cutWidth: 11.5, cutHeight: 4 });
  });

  it('setWallLength moves the far corner along the wall, and refuses crossing walls', () => {
    const l = setRoomShape(blank(), { kind: 'l', l: L });
    // Wall 2 runs down the right side from (12, 0) to (12, 6).
    const longer = setWallLength(l, 1, 8);
    expect(mainRoom(longer).outline[2]).toEqual({ x: 12, y: 8 });
    expect(setWallLength(l, 1, 6)).toBe(l);
    // Wall 3 runs along the top of the cut from (12, 6) to (7, 6): at 20 ft its end would be
    // outside the left wall. A wall shorter than the tolerance would make walls touch.
    expect(setWallLength(l, 2, 20)).toBe(l);
    expect(setWallLength(l, 0, 0.0001)).toBe(l);
  });

  it('addCorner splits a wall in the middle and removeCorner takes it out again', () => {
    const p = blank();
    const added = addCorner(p, 0);
    expect(mainRoom(added).outline[1]).toEqual({ x: 6, y: 0 });
    expect(removeCorner(added, 1)).toEqual(p);
    // A triangle keeps its three corners.
    const tri = removeCorner(p, 0);
    expect(removeCorner(tri, 0)).toBe(tri);
  });

  it('moveCorner makes an angled wall that doors and windows can be put on and slid along', () => {
    // Pull the top-right corner in: wall 0 runs from (0, 0) to (9, 3).
    const p = moveCorner(blank(), 1, { x: 9, y: 3 });
    expect(p).not.toBe(blank());
    const angled = Math.hypot(9, 3);
    const { plan: withWin, window: win } = addWindow(p);
    expect(win.wall).toBe(0);
    const moved = moveOpeningToWall(withWin, win.id, 0);
    expect(moved).toBe(withWin);
    // Sliding by (1, 0) moves it along the wall by the part of the move along it.
    const slid = slideOpening(withWin, win.id, 1, 0);
    const before = openingPlace(mainRoom(withWin), win).position;
    const after = openingPlace(mainRoom(slid), mainRoom(slid).openings[0]!).position;
    expect(after - before).toBeCloseTo(9 / angled, 9);
  });

  it('movePiecesInside brings a piece out of the cut-out of an L to the nearest free spot', () => {
    const l = setRoomShape(
      toPlan({
        roomDims: { width: 12, height: 10 },
        doors: [],
        windows: [],
        items: [
          { id: 1, label: 'Chair', width: 2, height: 2, x: 9, y: 7, rotation: 0, color: '#93c5fd' },
          { id: 2, label: 'Desk', width: 2, height: 2, x: 4, y: 7, rotation: 0, color: '#93c5fd' },
        ],
      }),
      { kind: 'l', l: L },
    );
    expect(itemWarnings(l).get('item-1')?.outOfBounds).toBe(true);
    const fixed = movePiecesInside(l);
    const w = itemWarnings(fixed);
    expect(w.get('item-1')).toEqual({ outOfBounds: false, collision: false });
    expect(fixed.items[1]).toBe(l.items[1]);
    // Nearest: straight up out of the cut (the cut starts at y 6), not across to the left.
    expect(boxOf(fixed.items[0]!)).toMatchObject({ x: 9, y: 4 });
  });
});

describe('narrowedOpenings', () => {
  it('lists the doors and windows a shape change made narrower', () => {
    const plan = toPlan({
      roomDims: { width: 12, height: 10 },
      doors: [],
      windows: [{ id: 1, wall: 'top', position: 1, width: 10 }],
      items: [],
    });
    const l = setRoomShape(plan, {
      kind: 'l',
      l: { width: 12, height: 10, corner: 'tr', cutWidth: 5, cutHeight: 4 },
    });
    expect(narrowedOpenings(plan, l).map((o) => [o.id, o.width])).toEqual([['window-1', 7]]);
    expect(narrowedOpenings(l, l)).toEqual([]);
  });
});

describe('editablePlan', () => {
  it('opens any single-room outline, listed from its top-left corner and moved to the origin', () => {
    const outline = lOutline(
      { width: 8, height: 6, corner: 'tl', cutWidth: 3, cutHeight: 2 },
      { x: 5, y: 5 },
    );
    // Listed from its third corner, with a window on what is then wall 0.
    const turned = [...outline.slice(2), ...outline.slice(0, 2)];
    const r = loadPlan(
      {
        version: 4,
        unit: 'ft',
        rooms: [
          {
            id: 'room-1',
            outline: turned,
            openings: [{ id: 'window-1', kind: 'window', wall: 0, offset: 1, width: 2 }],
          },
        ],
        items: [{ id: 'item-1', label: 'Bed', width: 2, depth: 2, placement: { x: 10, y: 10 } }],
      },
      'strict',
    );
    if (!r.ok) throw new Error('invalid');
    const e = editablePlan(r.plan);
    if (!e.ok) throw new Error(e.why.join());
    const room = mainRoom(e.plan);
    expect(room.outline).toEqual(
      lOutline({ width: 8, height: 6, corner: 'tl', cutWidth: 3, cutHeight: 2 }),
    );
    expect(room.openings[0]!.wall).toBe(2);
    expect(e.plan.items[0]!.placement).toMatchObject({ x: 5, y: 5 });
    // Nothing moves on the floor: the window is on the same wall segment.
    const a = wallFrame(mainRoom(r.plan), 0);
    const b = wallFrame(room, 2);
    expect(b.origin).toEqual({ x: a.origin.x - 5, y: a.origin.y - 5 });
  });

  it('opens several rooms: each listed from its top-left corner, the floor moved to the origin', () => {
    const r = loadPlan(
      {
        version: 4,
        unit: 'ft',
        rooms: [
          {
            id: 'a',
            outline: lOutline(
              { width: 4, height: 4, corner: 'tr', cutWidth: 1, cutHeight: 1 },
              { x: 2, y: 3 },
            ),
          },
          {
            id: 'b',
            // Listed from its bottom-right corner.
            outline: [
              { x: 12, y: 5 },
              { x: 10, y: 5 },
              { x: 10, y: 3 },
              { x: 12, y: 3 },
            ],
            openings: [{ id: 'door-1', kind: 'door', wall: 1, offset: 0.5, width: 1 }],
          },
        ],
        items: [{ id: 'item-1', label: 'Stool', width: 1, depth: 1, placement: { x: 11, y: 4 } }],
      },
      'strict',
    );
    if (!r.ok) throw new Error('invalid');
    const e = editablePlan(r.plan);
    if (!e.ok) throw new Error(e.why.join());
    expect(e.plan.rooms[0]!.outline[0]).toEqual({ x: 0, y: 0 });
    expect(e.plan.rooms[1]!.outline).toEqual([
      { x: 8, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 2 },
      { x: 8, y: 2 },
    ]);
    // The door stays on the same stretch of wall (now wall 3, the left one).
    expect(e.plan.rooms[1]!.openings[0]!.wall).toBe(3);
    expect(e.plan.items[0]!.placement).toMatchObject({ x: 9, y: 1 });
  });
});

describe('toggleLock and toggleHidden', () => {
  it('turn the flag on, and off again', () => {
    const plan = toPlan(defaultLayout());
    const locked = toggleLock(plan, 'item-1');
    expect(locked.items[0]!.locked).toBe(true);
    expect(toggleLock(locked, 'item-1').items[0]).toEqual(plan.items[0]);
    const hidden = toggleHidden(plan, 'item-1');
    expect(hidden.items[0]!.hidden).toBe(true);
    expect(toggleHidden(hidden, 'item-1').items[0]).toEqual(plan.items[0]);
  });
});

describe('the inventory', () => {
  const sample = () => toPlan(defaultLayout());

  it('takes a piece out of the room: it keeps its name, size, colour and lock', () => {
    const plan = toggleLock(sample(), 'item-1');
    const out = takeOutPiece(plan, 'item-1');
    const bed = out.items.find((i) => i.id === 'item-1')!;
    expect(bed.placement).toBeUndefined();
    const { placement: _placement, ...rest } = plan.items[0]!;
    expect(bed).toEqual(rest);
    expect(out.items.slice(1)).toEqual(plan.items.slice(1));
    expect(inventoryPieces(out).map((i) => i.id)).toEqual(['item-1']);
    expect(placedPieces(out)).toHaveLength(5);
  });

  it('drops `hidden`: a piece in the inventory is not drawn anyway', () => {
    const out = takeOutPiece(toggleHidden(sample(), 'item-2'), 'item-2');
    expect(out.items[1]).not.toHaveProperty('hidden');
  });

  it('leaves the plan as it is for a piece already out, or an unknown id', () => {
    const out = takeOutPiece(sample(), 'item-1');
    expect(takeOutPiece(out, 'item-1')).toBe(out);
    expect(takeOutPiece(out, 'item-99')).toBe(out);
    expect(placePiece(out, 'item-2')).toBe(out);
    expect(placePiece(out, 'item-99')).toBe(out);
  });

  it('places a piece back unrotated at the free spot nearest the middle of the room', () => {
    const plan = sample();
    const turned = changePiece(plan, 'item-5', { rotation: 90 });
    const back = placePiece(takeOutPiece(turned, 'item-5'), 'item-5');
    const desk = back.items.find((i) => i.id === 'item-5')!;
    expect(desk.placement?.rotation).toBe(0);
    // Inside, clear of every piece and of the door's swing and doorway.
    expect(itemWarnings(back).get('item-5')).toEqual({ outOfBounds: false, collision: false });
    // Where a new piece of its size would go.
    const out = takeOutPiece(turned, 'item-5');
    expect(desk.placement).toEqual(findFurnitureSpot(out, mainRoom(out), desk));
    expect(boxOf(desk)).toMatchObject({ width: 2, height: 4 });
  });

  it('places a piece that was hidden before as a shown one', () => {
    const out = takeOutPiece(toggleHidden(sample(), 'item-2'), 'item-2');
    const hiddenAgain = { ...out, items: out.items.map((i) => ({ ...i, hidden: true })) };
    const back = placePiece(hiddenAgain, 'item-2');
    expect(back.items[1]!.placement).toBeDefined();
    expect(back.items[1]).not.toHaveProperty('hidden');
  });

  it('places into an empty room at its middle', () => {
    const plan = toPlan({ roomDims: { width: 12, height: 12 }, doors: [], windows: [], items: [] });
    const { plan: withOne } = addPiece(plan, '#93c5fd');
    const back = placePiece(takeOutPiece(withOne, 'item-1'), 'item-1');
    expect(back).toEqual(withOne);
  });

  it('is ignored by the warnings: a piece out of the room never overlaps or blocks', () => {
    const plan = sample();
    // The bed moved onto the dresser overlaps it; out of the room, neither warns.
    const clash = changePiece(plan, 'item-1', { x: 0, y: 7 });
    expect(itemWarnings(clash).get('item-4')?.collision).toBe(true);
    const out = takeOutPiece(clash, 'item-1');
    const warnings = itemWarnings(out);
    expect(warnings.has('item-1')).toBe(false);
    expect(warnings.get('item-4')).toEqual({ outOfBounds: false, collision: false });
  });

  it('"Clear room" removes the pieces in the room and keeps the inventory', () => {
    const out = takeOutPiece(sample(), 'item-3');
    const cleared = clearPieces(out);
    expect(cleared.items.map((i) => i.id)).toEqual(['item-3']);
    expect(clearPieces(cleared)).toBe(cleared);
  });

  it('a plan with pieces in the inventory opens in the editor, and they stay there', () => {
    const out = takeOutPiece(sample(), 'item-1');
    expect(editablePlan(out)).toEqual({ ok: true, plan: out });
    // A room away from the origin is moved there with its pieces; the inventory has no position.
    const moved = {
      ...out,
      rooms: out.rooms.map((r) => ({
        ...r,
        outline: r.outline.map((p) => ({ x: p.x + 5, y: p.y + 2 })),
      })),
      items: out.items.map((i) =>
        i.placement
          ? { ...i, placement: { ...i.placement, x: i.placement.x + 5, y: i.placement.y + 2 } }
          : i,
      ),
    };
    const e = editablePlan(moved);
    expect(e.ok && e.plan.items).toEqual(out.items);
  });
});

describe('a floor of several rooms', () => {
  const sample = () => toPlan(defaultLayout());
  const two = () => addRoomBeside(sample(), 'room-1').plan;

  it('adds a room flush against a free side, named, sharing a wall', () => {
    const { plan, room } = addRoomBeside(sample(), 'room-1');
    expect(room).toMatchObject({ id: 'room-2', name: 'Room 2' });
    expect(room.outline).toEqual([
      { x: 12, y: 0 },
      { x: 22, y: 0 },
      { x: 22, y: 10 },
      { x: 12, y: 10 },
    ]);
    expect(sharedWalls(plan)).toHaveLength(1);
    const third = addRoomBeside(plan, 'room-2');
    expect(third.room.name).toBe('Room 3');
    expect(overlappedRooms(third.plan, third.room, third.room.id)).toEqual([]);
    expect(checkIntegrity(third.plan)).toEqual([]);
  });

  it('duplicates a room with its doors and windows (new ids), not its furniture', () => {
    const plan = sample();
    const d = duplicateRoom(plan, 'room-1')!;
    expect(d.room.name).toBe('Room 1 copy');
    expect(d.room.openings.map((o) => o.id)).toEqual(['door-2', 'window-2']);
    expect(d.plan.items).toEqual(plan.items);
    expect(checkIntegrity(d.plan)).toEqual([]);
    expect(overlappedRooms(d.plan, d.room, d.room.id)).toEqual([]);
  });

  it('moves a room with its pieces; refuses a move onto another room', () => {
    const plan = two();
    const moved = moveRoomBy(plan, 'room-2', 0, 4);
    expect(roomBounds(moved.rooms[1]!)).toMatchObject({ left: 12, top: 4 });
    expect(moveRoomBy(plan, 'room-2', -3, 0)).toBe(plan);
    expect(setRoomPosition(plan, 'room-2', { x: 13 }).rooms[1]!.outline[0]).toEqual({
      x: 13,
      y: 0,
    });
    // The bed moves with the first room.
    const bed = plan.items[0]!.placement!;
    const left = moveRoomBy(plan, 'room-1', -2, 0);
    expect(left.items[0]!.placement).toMatchObject({ x: bed.x - 2, y: bed.y });
  });

  it('deleting a room sets its pieces aside', () => {
    const plan = deleteRoom(two(), 'room-1');
    expect(plan.rooms.map((r) => r.id)).toEqual(['room-2']);
    expect(placedPieces(plan)).toEqual([]);
    expect(inventoryPieces(plan)).toHaveLength(6);
  });

  it('adds doors, windows and pieces to the room asked for', () => {
    const plan = two();
    const door = addDoor(plan, 'room-2');
    expect(door.plan.rooms[1]!.openings.map((o) => o.id)).toEqual([door.door.id]);
    expect(addWindow(plan, 'room-2').plan.rooms[1]!.openings).toHaveLength(1);
    const { plan: withPiece, item } = addPiece(plan, '#93c5fd', 'new', 'room-2');
    expect(item.placement!.x).toBeGreaterThan(12);
    expect(itemWarnings(withPiece).get(item.id)).toEqual({ outOfBounds: false, collision: false });
  });

  it('places a set-aside piece where it is dropped, in the room under that point, inside it', () => {
    const plan = takeOutPiece(two(), 'item-1');
    const at = placePieceAt(plan, 'item-1', { x: 17, y: 5 });
    expect(at.items[0]!.placement).toEqual({ x: 17, y: 5, rotation: 0 });
    // Dropped against the wall: pushed in so it is inside the room.
    const edge = placePieceAt(plan, 'item-1', { x: 21.5, y: 9.5 });
    const box = boxOf(edge.items[0]!);
    expect(box.x + box.width).toBeLessThanOrEqual(22 + 1e-9);
    expect(box.y + box.height).toBeLessThanOrEqual(10 + 1e-9);
    // Nowhere (outside every room), or a piece already placed: nothing changes.
    expect(placePieceAt(plan, 'item-1', { x: 40, y: 5 })).toBe(plan);
    expect(placePieceAt(plan, 'item-2', { x: 17, y: 5 })).toBe(plan);
  });

  it('places with the free-spot finder in the room asked for', () => {
    const plan = takeOutPiece(two(), 'item-2');
    const placed = placePiece(plan, 'item-2', 'room-2');
    expect(placed.items[1]!.placement!.x).toBeGreaterThan(12);
  });

  it('duplicates a piece beside it, inside its room, overlapping nothing', () => {
    const plan = two();
    const d = duplicatePiece(plan, 'item-6')!; // the chair
    expect(d.item).toMatchObject({ label: 'Chair', width: 1.5, depth: 1.5 });
    expect(d.item.id).toBe('item-7');
    const w = itemWarnings(d.plan).get(d.item.id);
    expect(w).toMatchObject({ outOfBounds: false, collision: false });
    expect(duplicatePiece(takeOutPiece(plan, 'item-6'), 'item-6')).toBeNull();
  });

  it('brings pieces outside every room into their own room', () => {
    const plan = two();
    const out = changePiece(plan, 'item-1', { x: 20, y: -3 });
    const back = movePiecesInside(out);
    expect(itemWarnings(back).get('item-1')?.outOfBounds).toBe(false);
    // Into the room it was nearest (the second one), not back to its old spot.
    expect(back.items[0]!.placement!.x).toBeGreaterThan(12);
  });
});
