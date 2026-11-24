/**
 * The plan check with every furniture shape (docs/design/plan-format.md, section 3, "Geometry"):
 * overlaps, inside the room and door blocking follow the true outline, at any rotation.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkLayout, type IssueCode } from './check';
import { shapeExtents } from './geometry/shapes';
import { loadPlan } from './load';
import type { Item, Plan, PlanInput } from './schema';

const square = (n: number) => [
  { x: 0, y: 0 },
  { x: n, y: 0 },
  { x: n, y: n },
  { x: 0, y: n },
];

const load = (p: Partial<PlanInput>): Plan => {
  const r = loadPlan(
    {
      version: 4,
      unit: 'ft',
      rooms: [{ id: 'room-1', outline: square(12), openings: [] }],
      ...p,
    },
    'strict',
  );
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};

const issues = (plan: Plan, codes: IssueCode[]) =>
  checkLayout(plan, { codes }).map((i) => `${i.code} ${i.ids.join(',')}`);

/** A 9' x 7' sectional with a 6' x 4' cut, pushed into the bottom-left corner of the room. */
const sectional = (over: Partial<Item> = {}) => ({
  id: 'sofa',
  label: 'Sectional',
  shape: 'l' as const,
  width: 9,
  depth: 7,
  cut: { corner: 'tr' as const, width: 6, depth: 4 },
  placement: { x: 4.5, y: 8.5, rotation: 0 },
  ...over,
});

describe('furniture shapes in the plan check', () => {
  it('an L against two walls with a table flush in its notch: no overlap, nothing outside', () => {
    const plan = load({
      items: [
        sectional(),
        // The notch is x 3..9, y 5..9: a 3' x 2' table touching both inner edges.
        { id: 'table', label: 'Table', width: 3, depth: 2, placement: { x: 4.5, y: 8 } },
      ],
    });
    expect(issues(plan, ['item_overlap', 'item_outside_room'])).toEqual([]);
    // Drawn as its bounding box (three rectangles were the workaround), the table overlaps it.
    const boxed = load({ items: [sectional({ shape: 'rect', cut: undefined }), plan.items[1]!] });
    expect(issues(boxed, ['item_overlap'])).toEqual(['item_overlap sofa,table']);
  });

  it('an L overlaps what reaches into either arm', () => {
    const plan = load({
      items: [
        sectional(),
        { id: 'lamp', label: 'Lamp', width: 1, depth: 1, placement: { x: 2.9, y: 6 } },
      ],
    });
    expect(issues(plan, ['item_overlap'])).toEqual(['item_overlap sofa,lamp']);
  });

  it('a round table clear of a door swing that its bounding box would be in', () => {
    const door = { id: 'door-1', kind: 'door' as const, wall: 0, offset: 3, width: 3 };
    const at = (x: number, y: number, shape: Item['shape']) =>
      load({
        rooms: [{ id: 'room-1', outline: square(12), openings: [door] }],
        items: [{ id: 't', label: 'Table', shape, width: 2, depth: 2, placement: { x, y } }],
      });
    // The swing is a quarter circle of radius 3 about the hinge at (3, 0).
    expect(issues(at(6, 3, 'ellipse'), ['door_blocked'])).toEqual([]);
    expect(issues(at(6, 3, 'rect'), ['door_blocked'])).toEqual(['door_blocked t,door-1']);
    expect(issues(at(5.5, 2.5, 'ellipse'), ['door_blocked'])).toEqual(['door_blocked t,door-1']);
  });

  it('an oval turned 45 degrees and flush with a wall by its curve is inside the room', () => {
    const oval = { shape: 'ellipse' as const, width: 4, depth: 2 };
    const e = shapeExtents(oval, 45);
    const plan = (shape: Item['shape']) =>
      load({
        items: [
          {
            id: 'o',
            label: 'Oval',
            ...oval,
            shape,
            placement: { x: -e.left, y: 6, rotation: 45 },
          },
        ],
      });
    expect(issues(plan('ellipse'), ['item_outside_room'])).toEqual([]);
    expect(issues(plan('rect'), ['item_outside_room'])).toEqual(['item_outside_room o']);
  });

  const shape = fc.constantFrom('rect' as const, 'l' as const, 'ellipse' as const);
  const piece = fc
    .record({
      shape,
      width: fc.double({ min: 0.5, max: 5, noNaN: true }),
      depth: fc.double({ min: 0.5, max: 5, noNaN: true }),
      corner: fc.constantFrom('tl' as const, 'tr' as const, 'br' as const, 'bl' as const),
      x: fc.double({ min: 0, max: 12, noNaN: true }),
      y: fc.double({ min: 0, max: 12, noNaN: true }),
      quarter: fc.integer({ min: 0, max: 3 }),
    })
    .map(({ corner, quarter, x, y, ...p }) => ({
      ...p,
      ...(p.shape === 'l' && { cut: { corner, width: p.width / 2, depth: p.depth / 2 } }),
      placement: { x, y, rotation: quarter * 90 },
    }));

  it('overlap does not change when the whole room turns a quarter (property)', () => {
    fc.assert(
      fc.property(piece, piece, (a, b) => {
        const turn = (p: typeof a) => ({
          ...p,
          // About the room's centre (6, 6), clockwise.
          placement: {
            x: 12 - p.placement.y,
            y: p.placement.x,
            rotation: (p.placement.rotation + 90) % 360,
          },
        });
        const plan = (x: typeof a, y: typeof a) =>
          load({
            items: [
              { id: 'a', label: 'A', ...x },
              { id: 'b', label: 'B', ...y },
            ],
          });
        const before = issues(plan(a, b), ['item_overlap', 'item_outside_room']);
        const after = issues(plan(turn(a), turn(b)), ['item_overlap', 'item_outside_room']);
        expect(after).toEqual(before);
      }),
    );
  });

  it('a piece whose true extents are inside the room is never outside it (property)', () => {
    fc.assert(
      fc.property(piece, fc.double({ min: 0, max: 359, noNaN: true }), (p, rotation) => {
        const e = shapeExtents(p, rotation);
        // Pushed into the top-left corner by its true outline.
        const plan = load({
          items: [{ id: 'p', label: 'P', ...p, placement: { x: -e.left, y: -e.top, rotation } }],
        });
        expect(issues(plan, ['item_outside_room'])).toEqual([]);
      }),
    );
  });
});
