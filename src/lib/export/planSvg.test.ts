import { describe, expect, it } from 'vitest';
import { INITIAL_DOORS, INITIAL_ITEMS, INITIAL_ROOM, INITIAL_WINDOWS } from '../constants';
import { FEET_PER_METER } from '../units';
import type { Door, FurnitureItem, Layout, RoomWindow, Wall } from '../../types';
import { escapeXml, planSvg } from './planSvg';
import {
  buildPlanScene,
  scaleBarFeet,
  type GroupNode,
  type PlanInput,
  type SceneNode,
} from './scene';

const date = new Date('2026-11-13T12:00:00Z');
const sample: Layout = {
  roomDims: INITIAL_ROOM,
  doors: INITIAL_DOORS,
  windows: INITIAL_WINDOWS,
  items: INITIAL_ITEMS,
};
const input = (layout: Layout, extra: Partial<PlanInput> = {}): PlanInput => ({
  layout,
  unitSystem: 'ft-in',
  title: 'Bedroom',
  date,
  locale: 'en-US',
  ...extra,
});

const item = (patch: Partial<FurnitureItem>): FurnitureItem => ({
  id: 1,
  label: 'Item',
  width: 3,
  height: 2,
  x: 1,
  y: 1,
  rotation: 0,
  color: '#93c5fd',
  ...patch,
});

/** Minimal XML well-formedness check: every tag closes in order, no stray `<` or `&`. */
const assertWellFormed = (xml: string) => {
  const stack: string[] = [];
  const text = xml.replace(/<(\/?)([a-zA-Z]+)([^<>]*?)(\/?)>/g, (_m, close, name, attrs, self) => {
    expect(attrs).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
    if (close) expect(stack.pop()).toBe(name);
    else if (!self) stack.push(name);
    return '';
  });
  expect(stack).toEqual([]);
  expect(text).not.toMatch(/[<>]/);
  expect(text).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
};

const groups = (nodes: SceneNode[], role: string): GroupNode[] =>
  nodes.flatMap((n) =>
    n.kind === 'group' ? [...(n.role === role ? [n] : []), ...groups(n.children, role)] : [],
  );

const texts = (nodes: SceneNode[]): string[] =>
  nodes.flatMap((n) =>
    n.kind === 'group' ? texts(n.children) : n.kind === 'text' ? [n.text] : [],
  );

describe('planSvg', () => {
  it('renders the default sample as a standalone, well-formed SVG', () => {
    const svg = planSvg(input(sample));
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toMatch(/ width="\d+" height="\d+" viewBox="0 0 \d+ \d+"/);
    assertWellFormed(svg);
    // No external resources: nothing a strict CSP or offline mode could block.
    expect(svg).not.toMatch(/href=|url\(|@import|<image|<foreignObject/);
    expect(svg).toContain('<title>Bedroom</title>');
    expect(svg).toContain('November 13, 2026 · room-planner.andrechek.com');
    expect(svg.match(/data-role="item"/g)).toHaveLength(INITIAL_ITEMS.length);
    expect(svg.match(/data-role="door"/g)).toHaveLength(1);
    expect(svg.match(/data-role="window"/g)).toHaveLength(1);
    for (const name of ['Bed', 'Desk', 'Wardrobe', 'Rug']) expect(svg).toContain(`>${name}<`);
  });

  it('escapes labels and titles', () => {
    const svg = planSvg(
      input(
        { ...sample, items: [item({ label: '<Desk & "Chair">', width: 6, height: 3 })] },
        { title: `Tom's <b>"room"</b> & co` },
      ),
    );
    assertWellFormed(svg);
    expect(svg).toContain('&lt;Desk &amp; &quot;Chair&quot;&gt;');
    expect(svg).toContain('data-label="&lt;Desk &amp; &quot;Chair&quot;&gt;"');
    expect(svg).toContain('<title>Tom&apos;s &lt;b&gt;&quot;room&quot;&lt;/b&gt; &amp; co</title>');
    expect(svg).not.toContain('<Desk');
    expect(svg).not.toContain('<b>');
  });

  it('keeps Unicode names and drops characters XML cannot carry', () => {
    const svg = planSvg(
      input(
        { ...sample, items: [item({ label: 'Кровать 床 🛏️\u0001', width: 8, height: 4 })] },
        { title: 'Спальня 卧室 🛏️\uD800' },
      ),
    );
    assertWellFormed(svg);
    expect(svg).toContain('<title>Спальня 卧室 🛏️</title>');
    expect(svg).toContain('>Кровать 床 🛏️<');
    expect(svg).not.toContain('\u0001');
    expect(svg).not.toContain('\uD800<');
  });

  it('draws rotated furniture rotated about its center, with an upright label', () => {
    const scene = buildPlanScene(
      input({ ...sample, items: [item({ x: 2, y: 3, width: 4, height: 2, rotation: 210 })] }),
    );
    const [piece] = groups(scene.nodes, 'item');
    const rect = piece!.children.find((c) => c.kind === 'rect')!;
    const label = piece!.children.find((c) => c.kind === 'text')!;
    if (rect.kind !== 'rect' || label.kind !== 'text') throw new Error('unexpected nodes');
    expect(rect.rotate?.deg).toBe(210);
    expect(rect.rotate?.cx).toBeCloseTo(rect.x + rect.w / 2, 1);
    expect(rect.rotate?.cy).toBeCloseTo(rect.y + rect.h / 2, 1);
    expect(rect.w / rect.h).toBeCloseTo(2, 2);
    // 210° would read upside down; the label turns the other way (30°) instead.
    expect(label.rotate?.deg).toBe(30);
    expect(label.rotate?.cx).toBeCloseTo(rect.rotate!.cx, 1);

    const svg = planSvg(input({ ...sample, items: [item({ rotation: 45 })] }));
    expect(svg).toMatch(/<rect[^>]*transform="rotate\(45 [\d.]+ [\d.]+\)"/);
  });

  it('runs a narrow piece’s label along its long side', () => {
    const scene = buildPlanScene(
      input({ ...sample, items: [item({ label: 'Bookshelf', width: 1, height: 5 })] }),
    );
    const label = groups(scene.nodes, 'item')[0]!.children.find((c) => c.kind === 'text');
    expect(label?.kind === 'text' && label.rotate?.deg).toBe(90);
  });

  it('omits hidden furniture', () => {
    const svg = planSvg(
      input({
        ...sample,
        items: [item({ label: 'Shown' }), item({ id: 2, label: 'Ghost', visible: false })],
      }),
    );
    expect(svg).toContain('Shown');
    expect(svg).not.toContain('Ghost');
  });

  it.each<Wall>(['top', 'right', 'bottom', 'left'])(
    'draws doors and windows on the %s wall',
    (wall) => {
      const doors: Door[] = [
        { id: 1, width: 3, position: 1, wall, hinge: 'left', type: 'swing-in' },
        { id: 2, width: 2.5, position: 5, wall, hinge: 'right', type: 'swing-out' },
        { id: 3, width: 3, position: 8, wall, hinge: 'left', type: 'sliding' },
      ];
      const windows: RoomWindow[] = [{ id: 1, width: 1, position: 11, wall }];
      const scene = buildPlanScene(
        input({ roomDims: { width: 14, height: 14 }, doors, windows, items: [] }),
      );
      const doorGroups = groups(scene.nodes, 'door');
      expect(doorGroups.map((g) => g.attrs)).toEqual([
        { wall, type: 'swing-in', hinge: 'left' },
        { wall, type: 'swing-out', hinge: 'right' },
        { wall, type: 'sliding', hinge: 'left' },
      ]);
      // Swing doors have a dashed arc + a leaf; sliding doors two panels and no arc.
      const dashed = (g: GroupNode) => g.children.filter((c) => c.kind === 'path' && c.dash).length;
      expect(doorGroups.map(dashed)).toEqual([1, 1, 0]);
      expect(groups(scene.nodes, 'window').map((g) => g.attrs)).toEqual([{ wall }]);
      assertWellFormed(
        planSvg(input({ roomDims: { width: 14, height: 14 }, doors, windows, items: [] })),
      );
    },
  );

  it('places a swing door at its position, hinged where the editor puts the leaf', () => {
    // 12x12 room, door 3ft wide at 6ft on the bottom wall, hinge left, opening inward.
    const scene = buildPlanScene(input(sample));
    const room = groups(scene.nodes, 'room')[0]!.children[1]!; // interior floor rect
    if (room.kind !== 'rect') throw new Error('expected floor rect');
    const s = room.w / 12;
    const door = groups(scene.nodes, 'door')[0]!;
    const leaf = door.children.find((c) => c.kind === 'path' && c.fill && c.stroke);
    if (leaf?.kind !== 'path') throw new Error('expected door leaf');
    const xs = leaf.d.flatMap((c) => (c[0] === 'M' || c[0] === 'L' ? [c[1]] : []));
    const ys = leaf.d.flatMap((c) => (c[0] === 'M' || c[0] === 'L' ? [c[2]] : []));
    // Hinge at x = 6ft, leaf runs 3ft up into the room from the interior face of the bottom wall.
    expect(Math.min(...xs)).toBeCloseTo(room.x + 6 * s, 1);
    expect(Math.max(...ys)).toBeCloseTo(room.y + 12 * s, 1);
    expect(Math.min(...ys)).toBeCloseTo(room.y + 9 * s, 1);
  });

  it('cuts door openings under the furniture but draws door swings over it', () => {
    const scene = buildPlanScene(input(sample));
    const roles = scene.nodes.flatMap((n) => (n.kind === 'group' ? [n.role] : []));
    const first = (role: string) => roles.indexOf(role);
    expect(first('room')).toBeLessThan(first('door-opening'));
    expect(first('door-opening')).toBeLessThan(first('item'));
    expect(roles.lastIndexOf('item')).toBeLessThan(first('door'));
  });

  it('annotates dimensions in the chosen unit system', () => {
    const layout: Layout = {
      ...sample,
      roomDims: { width: 4.2 * FEET_PER_METER, height: 3.6 * FEET_PER_METER },
    };
    const metric = texts(buildPlanScene(input(layout, { unitSystem: 'm' })).nodes);
    expect(metric).toEqual(expect.arrayContaining(['4.2 m', '3.6 m', '4.2 m × 3.6 m · 15.1 m²']));
    const cm = texts(buildPlanScene(input(layout, { unitSystem: 'cm' })).nodes);
    expect(cm).toEqual(expect.arrayContaining(['420 cm', '360 cm']));

    const imperial = texts(
      buildPlanScene(input({ ...sample, roomDims: { width: 12.5, height: 10 } })).nodes,
    );
    expect(imperial).toEqual(
      expect.arrayContaining([`12'6"`, `10'`, `12'6" × 10' · 125 sq ft`, `6' × 4'`]),
    );
    expect(texts(buildPlanScene(input(sample, { unitSystem: 'in' })).nodes)).toContain('144 in');
  });

  it('picks a round scale-bar length for the unit system', () => {
    expect(scaleBarFeet(70, 'ft-in')).toBe(2);
    expect(scaleBarFeet(20, 'ft')).toBe(10);
    expect(scaleBarFeet(70, 'm') / FEET_PER_METER).toBeCloseTo(1, 6);
    const scene = buildPlanScene(input(sample, { unitSystem: 'cm' }));
    const bar = groups(scene.nodes, 'scale-bar')[0]!;
    expect(texts(bar.children)).toEqual(['0', '100 cm']);
  });

  it('fits labels: shrinks or truncates long names, drops them on tiny pieces', () => {
    const scene = buildPlanScene(
      input({
        ...sample,
        items: [
          item({ id: 1, label: 'An extraordinarily long furniture name', width: 1.2, height: 1 }),
          item({ id: 2, label: 'Tiny', width: 0.1, height: 0.1 }),
        ],
      }),
    );
    const [long, tiny] = groups(scene.nodes, 'item');
    const longText = long!.children.find((c) => c.kind === 'text');
    expect(longText?.kind === 'text' && longText.text.endsWith('…')).toBe(true);
    expect(tiny!.children.filter((c) => c.kind === 'text')).toEqual([]);
  });

  it('includes furniture outside the room in the drawing', () => {
    const scene = buildPlanScene(
      input({ ...sample, items: [item({ x: 14, y: 14, width: 3, height: 3 })] }),
    );
    const rect = groups(scene.nodes, 'item')[0]!.children[0]!;
    if (rect.kind !== 'rect') throw new Error('expected rect');
    expect(rect.x + rect.w).toBeLessThan(scene.width);
    expect(rect.y + rect.h).toBeLessThan(scene.height);
  });

  it('escapeXml handles all five predefined entities', () => {
    expect(escapeXml(`<a & 'b' "c">`)).toBe('&lt;a &amp; &apos;b&apos; &quot;c&quot;&gt;');
  });
});
