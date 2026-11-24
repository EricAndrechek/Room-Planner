import { describe, expect, it } from 'vitest';
import { loadPlan } from '../load';
import type { Plan } from '../schema';
import { buildPlanScene, type GroupNode, type SceneNode } from './scene';

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** Living 14x12 | Bedroom 12x12 (shares Living's right wall) over Bath 6x8 (under the Bedroom). */
const apartment = (inType: 'swing-in' | 'swing-out' | 'sliding' = 'swing-in'): Plan => {
  const r = loadPlan(
    {
      version: 4,
      name: 'Apartment',
      unit: 'ft',
      rooms: [
        {
          id: 'living',
          name: 'Living',
          outline: rect(0, 0, 14, 12),
          openings: [
            { id: 'd-ext', kind: 'door', wall: 3, offset: 2, width: 3 },
            { id: 'd-bed', kind: 'door', wall: 1, offset: 4, width: 3, type: inType },
            { id: 'w1', kind: 'window', wall: 0, offset: 3, width: 4 },
          ],
        },
        {
          id: 'bed',
          name: 'Bedroom',
          outline: rect(14, 0, 12, 12),
          openings: [
            { id: 'd-bath', kind: 'door', wall: 2, offset: 8, width: 2.5 },
            { id: 'w2', kind: 'window', wall: 0, offset: 4, width: 4 },
          ],
        },
        { id: 'bath', outline: rect(14, 12, 6, 8), openings: [] },
      ],
      items: [
        { id: 'sofa', label: 'Sofa', width: 6, depth: 3, placement: { x: 5, y: 8 } },
        { id: 'bedpiece', label: 'Bed', width: 5, depth: 6.5, placement: { x: 20, y: 5 } },
        { id: 'chair', label: 'Spare chair', width: 1.5, depth: 1.5 },
      ],
    },
    'strict',
  );
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};

const flat = (nodes: SceneNode[]): SceneNode[] =>
  nodes.flatMap((n) => (n.kind === 'group' ? [n, ...flat(n.children)] : [n]));
const build = (plan: Plan) =>
  buildPlanScene({ plan, date: new Date('2026-01-01T12:00:00Z'), locale: 'en-US' });
const groupsOf = (nodes: SceneNode[], role: string) =>
  flat(nodes).filter((n): n is GroupNode => n.kind === 'group' && n.role === role);
const textsOf = (n: SceneNode) => flat([n]).flatMap((c) => (c.kind === 'text' ? [c.text] : []));

describe('buildPlanScene on a floor of several rooms', () => {
  const plan = apartment();
  const scene = build(plan);
  const top = scene.nodes;
  const roles = top.map((n) => (n.kind === 'group' ? n.role : n.kind));

  it('labels every room with its name and area', () => {
    const labels = groupsOf(scene.nodes, 'room-label');
    expect(labels.map((l) => l.attrs?.room)).toEqual(['living', 'bed', 'bath']);
    expect(labels.map(textsOf)).toEqual([
      ['Living', '168 sq ft'],
      ['Bedroom', '144 sq ft'],
      ['Room 3', '48 sq ft'],
    ]);
    // Centred in the room, which a rectangle's bounding box centre is.
    const first = labels[0]!.children[0]!;
    expect(first).toMatchObject({ kind: 'text', anchor: 'middle', bold: true });
  });

  it('draws one thin wall per shared stretch', () => {
    const walls = groupsOf(scene.nodes, 'shared-wall');
    expect(walls.map((w) => w.attrs?.rooms)).toEqual(['living,bed', 'bed,bath']);
  });

  it('reads 3 rooms and the total area under the title, and Set aside for the list', () => {
    const texts = flat(scene.nodes).flatMap((n) => (n.kind === 'text' ? [n.text] : []));
    expect(texts).toContain('3 rooms · 360 sq ft');
    const [list] = groupsOf(scene.nodes, 'inventory');
    expect(textsOf(list!)[0]).toBe('Set aside (1)');
  });

  it('draws every wall band before any floor, and labels before the furniture', () => {
    const order = flat(scene.nodes).filter(
      (n) =>
        n.kind === 'group' &&
        ['room-walls', 'room', 'shared-wall', 'room-label', 'item', 'door'].includes(n.role),
    ) as GroupNode[];
    const idx = (role: string) =>
      order.map((g) => g.role).flatMap((r, i) => (r === role ? [i] : []));
    expect(idx('room-walls')).toHaveLength(3);
    expect(Math.max(...idx('room-walls'))).toBeLessThan(Math.min(...idx('room')));
    expect(Math.max(...idx('room'))).toBeLessThan(Math.min(...idx('shared-wall')));
    expect(Math.max(...idx('shared-wall'))).toBeLessThan(Math.min(...idx('room-label')));
    expect(Math.max(...idx('room-label'))).toBeLessThan(Math.min(...idx('item')));
    expect(Math.max(...idx('item'))).toBeLessThan(Math.min(...idx('door')));
    expect(roles[0]).toBe('title');
  });

  /** x range of the cut path of the door with this connection. */
  const cutXs = (sc: typeof scene, connects: string) => {
    const [cut] = groupsOf(sc.nodes, 'door-opening').filter((g) => g.attrs?.connects === connects);
    const path = cut!.children[0]!;
    if (path.kind !== 'path') throw new Error('no path');
    return path.d.flatMap((c) => (c[0] === 'M' || c[0] === 'L' ? [c[1]] : []));
  };

  it('cuts a door between rooms symmetrically around the shared line', () => {
    const xs = cutXs(scene, 'bed');
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    const [wall] = groupsOf(scene.nodes, 'shared-wall').filter(
      (w) => w.attrs?.rooms === 'living,bed',
    );
    const wp = wall!.children[0]!;
    if (wp.kind !== 'path') throw new Error('no path');
    const wx = wp.d.flatMap((c) => (c[0] === 'M' || c[0] === 'L' ? [c[1]] : []));
    const line = (Math.min(...wx) + Math.max(...wx)) / 2;
    expect(line - lo).toBeCloseTo(hi - line, 1);
    // Wider than the thin band, by the overdraw on each side.
    expect(hi - lo).toBeGreaterThan(Math.max(...wx) - Math.min(...wx));
  });

  it('marks doors between rooms, and leaves exterior doors and windows as they were', () => {
    const doors = groupsOf(scene.nodes, 'door');
    expect(doors.map((d) => d.attrs?.connects)).toEqual([undefined, 'bed', 'bath']);
    expect(groupsOf(scene.nodes, 'window').every((w) => w.attrs?.connects === undefined)).toBe(
      true,
    );
  });

  it('hinges an outward door between rooms on the shared line', () => {
    const swingOut = build(apartment('swing-out'));
    const [leafIn] = groupsOf(scene.nodes, 'door').filter((d) => d.attrs?.connects === 'bed');
    const [leafOut] = groupsOf(swingOut.nodes, 'door').filter((d) => d.attrs?.connects === 'bed');
    const firstX = (g: GroupNode) => {
      const p = g.children.find((c) => c.kind === 'path' && !c.dash && c.fill);
      return p && p.kind === 'path' && p.d[0]![0] === 'M' ? p.d[0]![1] : NaN;
    };
    // Both hinge on the same line (the shared wall's centre), whichever way they swing.
    expect(firstX(leafOut!)).toBeCloseTo(firstX(leafIn!), 1);
  });

  it('draws sliding doors between rooms with jambs across the thin band only', () => {
    const sc = build(apartment('sliding'));
    const door = groupsOf(sc.nodes, 'door').find((d) => d.attrs?.connects === 'bed')!;
    const jamb = door.children.find((c) => c.kind === 'path' && c.stroke === '#334155');
    expect(jamb).toBeDefined();
  });
});

describe('buildPlanScene on awkward floors', () => {
  const load = (rooms: unknown[]) => {
    const r = loadPlan({ version: 4, name: 'X', unit: 'ft', rooms, items: [] }, 'strict');
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.plan;
  };

  it('draws rooms far apart without shared walls', () => {
    const scene = build(
      load([
        { id: 'a', outline: rect(0, 0, 8, 8), openings: [] },
        { id: 'b', outline: rect(40, 30, 8, 8), openings: [] },
      ]),
    );
    expect(groupsOf(scene.nodes, 'shared-wall')).toHaveLength(0);
    expect(groupsOf(scene.nodes, 'room-label')).toHaveLength(2);
  });

  it('labels an L-shaped room inside its outline, next to a rectangle', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 12 },
      { x: 0, y: 12 },
    ];
    const scene = build(
      load([
        { id: 'l', name: 'Hall', outline: l, openings: [] },
        { id: 'r', outline: rect(3, 3, 9, 9), openings: [] },
      ]),
    );
    expect(groupsOf(scene.nodes, 'shared-wall').length).toBeGreaterThan(0);
    const label = groupsOf(scene.nodes, 'room-label').find((g) => g.attrs?.room === 'l')!;
    expect(textsOf(label)[0]).toBe('Hall');
  });

  it('handles a door on a wall that is only partly shared', () => {
    const scene = build(
      load([
        {
          id: 'a',
          outline: rect(0, 0, 10, 10),
          openings: [
            { id: 'in', kind: 'door', wall: 1, offset: 6, width: 2 },
            { id: 'out', kind: 'door', wall: 1, offset: 1, width: 2 },
          ],
        },
        { id: 'b', outline: rect(10, 5, 6, 10), openings: [] },
      ]),
    );
    const doors = groupsOf(scene.nodes, 'door');
    expect(doors.map((d) => d.attrs?.connects)).toEqual(['b', undefined]);
  });
});
