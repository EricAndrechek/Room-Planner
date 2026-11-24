import { describe, expect, it } from 'vitest';
import { loadPlan } from '../load';
import type { Plan } from '../schema';
import { buildPlanScene, type SceneNode } from './scene';
import { sceneToSvg } from './svg';

const plan = (): Plan => {
  const r = loadPlan(
    {
      version: 4,
      name: 'Flat',
      unit: 'ft',
      rooms: [
        {
          id: 'living',
          outline: [
            { x: 0, y: 0 },
            { x: 6, y: 0 },
            { x: 6, y: 4 },
            { x: 12, y: 4 },
            { x: 12, y: 10 },
            { x: 0, y: 10 },
          ],
          openings: [{ id: 'door-1', kind: 'door', wall: 2, offset: 1, width: 3 }],
        },
        {
          id: 'hall',
          outline: [
            { x: 12, y: 4 },
            { x: 16, y: 4 },
            { x: 16, y: 10 },
            { x: 12, y: 10 },
          ],
          openings: [{ id: 'window-1', kind: 'window', wall: 1, offset: 1, width: 3 }],
        },
      ],
      items: [
        {
          id: 'sofa',
          label: 'Sofa',
          shape: 'l',
          width: 6,
          depth: 4,
          cut: { corner: 'tr', width: 3, depth: 2 },
          placement: { x: 3.5, y: 7 },
        },
        {
          id: 'table',
          label: 'Table',
          shape: 'ellipse',
          width: 2,
          depth: 2,
          placement: { x: 14, y: 7, rotation: 30 },
        },
        { id: 'lamp', label: 'Lamp', width: 1, depth: 1, placement: { x: 1, y: 1 }, hidden: true },
        { id: 'chair', label: 'Spare chair', width: 1.5, depth: 1.5 },
      ],
    },
    'strict',
  );
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};

/** The list's heading sits this far (at most) above its baseline. */
const FONT_GAP = 12;

const flat = (nodes: SceneNode[]): SceneNode[] =>
  nodes.flatMap((n) => (n.kind === 'group' ? [n, ...flat(n.children)] : [n]));

describe('buildPlanScene on a plan', () => {
  const scene = buildPlanScene({
    plan: plan(),
    date: new Date('2026-01-01T12:00:00Z'),
    locale: 'en-US',
  });
  const nodes = flat(scene.nodes);
  const groups = (role: string) =>
    nodes.filter(
      (n): n is Extract<SceneNode, { kind: 'group' }> => n.kind === 'group' && n.role === role,
    );

  it('draws every room, its doors and windows, and the floor size and area', () => {
    expect(groups('room')).toHaveLength(2);
    expect(groups('door')[0]!.attrs).toMatchObject({ wall: '2', type: 'swing-in' });
    expect(groups('window')[0]!.attrs).toEqual({ wall: 'right' });
    const texts = nodes.flatMap((n) => (n.kind === 'text' ? [n.text] : []));
    expect(texts).toContain('Flat');
    expect(texts).toContain(`16' × 10' · 120 sq ft`);
  });

  it('draws an L and an ellipse as paths, and leaves out hidden pieces and the inventory', () => {
    const items = groups('item');
    expect(items.map((g) => g.attrs?.label)).toEqual(['Sofa', 'Table']);
    expect(items.every((g) => g.children[0]!.kind === 'path')).toBe(true);
    const svg = sceneToSvg(scene);
    expect(svg).toContain('data-label="Sofa"');
    expect(svg).not.toContain('data-label="Spare chair"');
    expect(svg).not.toContain('Lamp');
  });

  const ruleY = (sc: typeof scene) => {
    const footer = flat(sc.nodes).find((n) => n.kind === 'group' && n.role === 'footer');
    const rule = footer?.kind === 'group' ? footer.children[0] : undefined;
    return rule?.kind === 'path' && rule.d[0]![0] === 'M' ? rule.d[0]![2] : NaN;
  };
  const withoutInventory = () => {
    const all = plan();
    const placed = { ...all, items: all.items.filter((i) => i.placement) };
    return buildPlanScene({ plan: placed, date: new Date(0), locale: 'en-US' });
  };

  it('lists the inventory under the plan, above the footer', () => {
    const [list] = groups('inventory');
    const texts = list!.children.flatMap((n) => (n.kind === 'text' ? [n.text] : []));
    expect(texts).toEqual(['Not placed (1)', `Spare chair · 1'6" × 1'6"`]);
    expect(list!.children.find((n) => n.kind === 'rect')).toMatchObject({ fill: '#93c5fd' });
    const ys = list!.children.map((n) => (n.kind === 'rect' ? n.y : n.kind === 'text' ? n.y : 0));
    // Below where the footer would be without it (so below the plan), above the footer.
    expect(Math.min(...ys) - FONT_GAP).toBeGreaterThan(ruleY(withoutInventory()));
    expect(Math.max(...ys)).toBeLessThan(ruleY(scene));
  });

  it('has no list, and the same page width, when nothing is in the inventory', () => {
    const without = withoutInventory();
    expect(flat(without.nodes).some((n) => n.kind === 'group' && n.role === 'inventory')).toBe(
      false,
    );
    expect(without.height).toBeLessThan(scene.height);
    expect(without.width).toBe(scene.width);
  });
});
