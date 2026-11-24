import { describe, expect, it } from 'vitest';
import { checkLayout, type Issue } from './check';
import { loadPlan } from './load';
import type { PlanInput, Plan } from './schema';

const rect = (w: number, h: number, x = 0, y = 0) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const load = (p: Partial<PlanInput>): Plan => {
  const r = loadPlan(
    {
      version: 4,
      unit: 'ft',
      rooms: [{ id: 'room-1', outline: rect(12, 10), openings: [] }],
      ...p,
    },
    'strict',
  );
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};
const codes = (issues: Issue[]) => issues.map((i) => `${i.code} ${i.ids.join(',')}`);
const at = (x: number, y: number, rotation = 0) => ({ x, y, rotation });

describe('checkLayout', () => {
  it('finds nothing wrong with a clear room', () => {
    expect(
      checkLayout(
        load({ items: [{ id: 'bed', label: 'Bed', width: 5, depth: 6, placement: at(6, 5) }] }),
        { minClearance: 0 },
      ),
    ).toEqual([]);
  });

  it('reports overlaps with their depth in the display unit, and pieces outside', () => {
    const p = load({
      settings: { unitSystem: 'in' },
      items: [
        { id: 'sofa', label: 'Sofa', width: 7, depth: 3, placement: at(4, 2) },
        { id: 'table', label: 'Coffee Table', width: 4, depth: 2, placement: at(4, 4.1667) },
        { id: 'chair', label: 'Chair', width: 2, depth: 2, placement: at(11.5, 5) },
      ],
    });
    const issues = checkLayout(p, { codes: ['item_overlap', 'item_outside_room'] });
    expect(codes(issues)).toEqual(['item_overlap sofa,table', 'item_outside_room chair']);
    expect(issues[0]!.message).toBe('Sofa overlaps Coffee Table by 4 in.');
    expect(issues[1]).toMatchObject({ severity: 'error', message: 'Chair is outside the room.' });
  });

  it('uses the true shapes: a chair in the notch of an L-shaped sectional does not overlap it', () => {
    const p = load({
      items: [
        {
          id: 'sofa',
          label: 'Sectional',
          shape: 'l',
          width: 8,
          depth: 6,
          cut: { corner: 'tr', width: 5, depth: 3 },
          placement: at(4, 3),
        },
        { id: 'chair', label: 'Chair', width: 2, depth: 2, placement: at(5.5, 1.5) },
      ],
    });
    expect(checkLayout(p, { codes: ['item_overlap'] })).toEqual([]);
    const round = load({
      items: [
        {
          id: 'table',
          label: 'Table',
          shape: 'ellipse',
          width: 4,
          depth: 4,
          placement: at(3, 3),
        },
        { id: 'stool', label: 'Stool', width: 0.6, depth: 0.6, placement: at(1.1, 1.1) },
      ],
    });
    // In the bounding box's corner, outside the circle.
    expect(checkLayout(round, { codes: ['item_overlap'] })).toEqual([]);
  });

  it('a piece must be inside one room of an L-shaped floor, angled walls included', () => {
    const p = load({
      rooms: [
        {
          id: 'room-1',
          outline: [
            { x: 0, y: 0 },
            { x: 6, y: 0 },
            { x: 6, y: 4 },
            { x: 12, y: 4 },
            { x: 12, y: 10 },
            { x: 0, y: 10 },
          ],
          openings: [],
        },
      ],
      items: [
        { id: 'in', label: 'Bed', width: 4, depth: 3, placement: at(3, 6) },
        { id: 'notch', label: 'Desk', width: 3, depth: 2, placement: at(9, 2) },
        { id: 'corner', label: 'Rug', width: 6, depth: 4, placement: at(6, 4) },
      ],
    });
    expect(codes(checkLayout(p, { codes: ['item_outside_room'] }))).toEqual([
      'item_outside_room notch',
      'item_outside_room corner',
    ]);
  });

  it('pieces in a door swing or doorway, and a door swinging out into the next room', () => {
    const p = load({
      rooms: [
        {
          id: 'a',
          outline: rect(10, 10),
          openings: [
            { id: 'door-1', kind: 'door', wall: 1, offset: 3, width: 3, type: 'swing-out' },
          ],
        },
        { id: 'b', outline: rect(10, 10, 10, 0), openings: [] },
      ],
      items: [
        { id: 'chair', label: 'Chair', width: 1, depth: 1, placement: at(9.5, 4.5) },
        { id: 'plant', label: 'Plant', width: 1, depth: 1, placement: at(11, 4.5) },
      ],
    });
    const issues = checkLayout(p, { codes: ['door_blocked', 'doorway_blocked'] });
    expect(codes(issues)).toEqual(['doorway_blocked chair,door-1']);
    expect(issues[0]!.message).toBe(
      'Chair stands in the doorway of the door on the right wall of a.',
    );
  });

  it('openings that overlap, rooms that overlap (sharing a wall is fine), tight gaps', () => {
    const p = load({
      rooms: [
        {
          id: 'a',
          name: 'Bedroom',
          outline: rect(10, 10),
          openings: [
            { id: 'door-1', kind: 'door', wall: 0, offset: 1, width: 3 },
            { id: 'window-1', kind: 'window', wall: 0, offset: 3, width: 3 },
          ],
        },
        { id: 'b', name: 'Hall', outline: rect(5, 10, 10, 0), openings: [] },
        { id: 'c', name: 'Closet', outline: rect(4, 4, 8, 8), openings: [] },
      ],
      items: [
        { id: 'bed', label: 'Bed', width: 4, depth: 4, placement: at(3, 6) },
        { id: 'desk', label: 'Desk', width: 2, depth: 2, placement: at(6.5, 6) },
      ],
    });
    expect(codes(checkLayout(p, { codes: ['opening_overlap', 'room_overlap'] }))).toEqual([
      'opening_overlap door-1,window-1',
      'room_overlap a,c',
      'room_overlap b,c',
    ]);
    const tight = checkLayout(p, { codes: ['tight_clearance'] });
    expect(tight.map((i) => i.message)).toContain('Only 6" between Bed and Desk.');
    expect(tight.every((i) => i.severity === 'info')).toBe(true);
  });

  it('ignores hidden pieces and pieces in the inventory', () => {
    const p = load({
      items: [
        { id: 'a', label: 'A', width: 3, depth: 3, placement: at(5, 5) },
        { id: 'b', label: 'B', width: 3, depth: 3, placement: at(5, 5), hidden: true },
        { id: 'c', label: 'C', width: 30, depth: 3 },
      ],
    });
    expect(checkLayout(p)).toEqual([]);
  });
});
