/**
 * Furniture shapes in the editor (PR 7a): changing a piece's shape, its L cut, the two starters
 * in "Add Item", and plans with shaped pieces opening, sharing and announcing like any other.
 */
import { describe, expect, it } from 'vitest';
import { checkIntegrity, loadPlan } from '../core/load';
import { buildPlanUrl, readPlanLink } from '../core/share/plan';
import { describeLayoutChange } from '../hooks/useAnnouncements';
import type { Item, Plan } from '../types';
import { readSharedPlan } from './boot';
import { PIECE_PRESETS, addPiece, changePiece, toggleHidden, toggleLock } from './edits';
import {
  blankPlan,
  boxOf,
  editablePlan,
  itemWarnings,
  samePlan,
  snapPieces,
  starterPlan,
} from './plans';

const piece = (over: Partial<Item> = {}): Item => ({
  id: 'item-1',
  label: 'Sofa',
  color: '#93c5fd',
  shape: 'rect',
  width: 9,
  depth: 7,
  placement: { x: 5, y: 4.5, rotation: 30 },
  ...over,
});
const planWith = (...items: Item[]): Plan => ({ ...blankPlan(), items });
const only = (p: Plan) => p.items[0]!;
const valid = (p: Plan) => expect(checkIntegrity(p)).toEqual([]);

describe('changing a piece shape', () => {
  it('keeps the box, the position and the rotation; an L gets the default cut', () => {
    const before = planWith(piece());
    const l = changePiece(before, 'item-1', { shape: 'l' });
    expect(only(l)).toMatchObject({
      shape: 'l',
      width: 9,
      depth: 7,
      cut: { corner: 'tr', width: 6, depth: 4 },
      placement: { x: 5, y: 4.5, rotation: 30 },
    });
    valid(l);
    const round = changePiece(l, 'item-1', { shape: 'ellipse' });
    expect(only(round)).toEqual({ ...piece(), shape: 'ellipse' });
    expect('cut' in only(round)).toBe(false);
    valid(round);
    expect(only(changePiece(round, 'item-1', { shape: 'rect' }))).toEqual(piece());
  });

  it('an L keeps its cut when other fields change, and can take another corner or size', () => {
    const l = changePiece(planWith(piece()), 'item-1', { shape: 'l' });
    const renamed = changePiece(l, 'item-1', { label: 'Sectional' });
    expect(only(renamed).cut).toBe(only(l).cut);
    const flipped = changePiece(l, 'item-1', { cut: { corner: 'bl' } });
    expect(only(flipped).cut).toEqual({ corner: 'bl', width: 6, depth: 4 });
    expect(only(changePiece(flipped, 'item-1', { cut: { width: 5 } })).cut).toEqual({
      corner: 'bl',
      width: 5,
      depth: 4,
    });
  });

  it('shrinking an L keeps its cut inside the box, from the same corner of the box', () => {
    const l = changePiece(planWith(piece()), 'item-1', { shape: 'l' });
    const small = changePiece(l, 'item-1', { width: 4, depth: 3 });
    expect(only(small).cut).toEqual({ corner: 'tr', width: 3.9, depth: 2.9 });
    expect(boxOf(only(small))).toMatchObject({ x: boxOf(only(l)).x, y: boxOf(only(l)).y });
    valid(small);
    // A cut asked to be as big as the piece stays smaller than it.
    const capped = changePiece(l, 'item-1', { cut: { width: 9, depth: 0 } });
    expect(only(capped).cut).toMatchObject({ width: 8.9, depth: 0.1 });
    valid(capped);
  });

  it('snapping sees the shape', () => {
    const l = changePiece(planWith(piece()), 'item-1', { shape: 'l' });
    expect(snapPieces(l)[0]).toMatchObject({ shape: 'l', cut: only(l).cut, width: 9, height: 7 });
    expect(snapPieces(planWith(piece()))[0]).not.toHaveProperty('cut');
  });
});

describe('the starters in Add Item', () => {
  it('an L-shaped sofa and a round table, free of the sample room furniture, valid', () => {
    for (const preset of ['l-sofa', 'round-table'] as const) {
      const { plan, item } = addPiece(blankPlan(), '#fca5a5', preset);
      expect(item).toMatchObject({
        label: PIECE_PRESETS[preset].label,
        shape: PIECE_PRESETS[preset].shape,
      });
      valid(plan);
      expect(loadPlan(plan, 'strict').ok).toBe(true);
    }
    const sofa = addPiece(blankPlan(), '#fca5a5', 'l-sofa').item;
    expect(sofa).toMatchObject({ width: 9, depth: 7, cut: { corner: 'tr', width: 6, depth: 4 } });
    const table = addPiece(starterPlan(), '#fca5a5', 'round-table');
    expect(table.item).toMatchObject({ shape: 'ellipse', width: 4, depth: 4 });
    const w = itemWarnings(table.plan).get(table.item.id)!;
    expect(w).toMatchObject({ outOfBounds: false, collision: false });
    expect(w.blocksDoor ?? false).toBe(false);
  });

  it('"New item" is still a 3 x 2 rectangle', () => {
    expect(addPiece(blankPlan(), '#fca5a5').item).toMatchObject({
      label: 'New Item',
      shape: 'rect',
      width: 3,
      depth: 2,
    });
  });
});

describe('plans with shaped pieces', () => {
  const shaped = (): Plan =>
    planWith(
      piece({ shape: 'l', cut: { corner: 'br', width: 5, depth: 3 }, placement: undefined }),
      piece({ id: 'item-2', label: 'Table', shape: 'ellipse', width: 4, depth: 3 }),
    );

  it('open in the editor (L and round pieces are editable; the inventory is not yet)', () => {
    const plan = shaped();
    expect(editablePlan(plan)).toEqual({
      ok: false,
      why: ['pieces that are not placed in the room'],
    });
    plan.items[0]!.placement = { x: 4.5, y: 3.5, rotation: 0 };
    expect(editablePlan(plan)).toEqual({ ok: true, plan });
  });

  it('round-trip through a share link and JSON', async () => {
    const plan = shaped();
    plan.items[0]!.placement = { x: 4.5, y: 3.5, rotation: 90 };
    const link = await readPlanLink(await buildPlanUrl('https://example.com/', plan));
    if (!link.ok) throw new Error(JSON.stringify(link));
    expect(samePlan(link.plan, plan)).toBe(true);
    expect(link.plan.items.map((i) => [i.shape, i.cut])).toEqual([
      ['l', { corner: 'br', width: 5, depth: 3 }],
      ['ellipse', undefined],
    ]);
    const json = readSharedPlan(JSON.parse(JSON.stringify(plan)));
    expect(json.ok && samePlan(json.plan, plan)).toBe(true);
  });

  it('a shape change is announced', () => {
    const before = planWith(piece());
    const l = changePiece(before, 'item-1', { shape: 'l' });
    expect(describeLayoutChange(before, l, 'ft-in')).toBe('Sofa is now L-shaped');
    expect(
      describeLayoutChange(l, changePiece(l, 'item-1', { cut: { corner: 'bl' } }), 'ft-in'),
    ).toBe('Sofa: cut at the bottom left corner');
    const round = changePiece(before, 'item-1', { shape: 'ellipse' });
    expect(describeLayoutChange(before, round, 'ft-in')).toBe('Sofa is now oval');
    expect(describeLayoutChange(round, before, 'ft-in')).toBe('Sofa is now a rectangle');
  });
});

describe('changePiece removes what the patch removes', () => {
  it('a piece can be unlocked and shown again (the flags are deleted, not left behind)', () => {
    const locked = toggleLock(starterPlan(), 'item-1');
    expect(only(locked).locked).toBe(true);
    expect('locked' in only(toggleLock(locked, 'item-1'))).toBe(false);
    const hidden = toggleHidden(starterPlan(), 'item-1');
    expect(only(hidden).hidden).toBe(true);
    expect('hidden' in only(toggleHidden(hidden, 'item-1'))).toBe(false);
  });
});
