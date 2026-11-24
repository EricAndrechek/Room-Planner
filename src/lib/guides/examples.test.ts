import { describe, expect, it } from 'vitest';
import type { FurnitureItem } from '../../types';
import { computeLayoutWarnings } from '../openings';
import { EXAMPLES, examplesFor } from './examples';
import { GUIDES } from './index';
import { exampleShareFragment, exampleSvg } from './render';
import { decodeShareFragment } from '../share';
import { fromShareConfig } from '../layout';

const byLabel = (id: string, label: string, nth = 0): FurnitureItem => {
  const found = EXAMPLES.find((e) => e.id === id)!.layout.items.filter((i) => i.label === label);
  expect(found.length, `${id}: ${label}`).toBeGreaterThan(nth);
  return found[nth];
};

/** Clear distance in inches between two unrotated boxes along one axis. */
const gapX = (a: FurnitureItem, b: FurnitureItem) =>
  Math.round(Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)) * 12);
const gapY = (a: FurnitureItem, b: FurnitureItem) =>
  Math.round(Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height)) * 12);

describe('guide example layouts', () => {
  it('have unique ids and belong to a guide, with at least two per guide', () => {
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    for (const e of EXAMPLES) expect(GUIDES.map((g) => g.slug)).toContain(e.guide);
    for (const g of GUIDES) expect(examplesFor(g.slug).length).toBeGreaterThanOrEqual(2);
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))(
    '%s: nothing overlaps, sticks out of the room or blocks a door',
    (_id, e) => {
      const warnings = [...computeLayoutWarnings(e.layout).entries()]
        .map(([id, w]) => ({ label: e.layout.items.find((i) => i.id === id)?.label, ...w }))
        .filter((w) => w.collision || w.outOfBounds || w.blocksDoor || w.blocksDoorway);
      expect(warnings).toEqual([]);
    },
  );

  it('quote true clearances', () => {
    // Queen bedroom: 30 in each side of the bed, 46 in from the bed to the dresser.
    const room = { x: 0, y: 0, width: 10, height: 12 } as FurnitureItem;
    const queen = byLabel('queen-bedroom-10x12', 'Queen bed');
    expect(Math.round(queen.x * 12)).toBe(30);
    expect(Math.round((room.width - queen.x - queen.width) * 12)).toBe(30);
    expect(gapY(queen, byLabel('queen-bedroom-10x12', 'Dresser'))).toBe(46);
    // King bedroom: 40 in each side, 50 in from the bench to the dresser.
    const king = byLabel('king-bedroom-13x14', 'King bed');
    expect(Math.round(king.x * 12)).toBe(40);
    expect(Math.round((13 - king.x - king.width) * 12)).toBe(40);
    expect(
      gapY(byLabel('king-bedroom-13x14', 'Bench'), byLabel('king-bedroom-13x14', 'Dresser')),
    ).toBe(50);
    // Twin beds: 68 in between them.
    expect(
      gapX(byLabel('twin-beds-12x12', 'Twin bed'), byLabel('twin-beds-12x12', 'Twin bed', 1)),
    ).toBe(68);
    // Living room with TV: 15 in sofa to coffee table, 30 in behind the sofa, 15 in to the armchair.
    const sofa = byLabel('living-tv-13x15', 'Sofa');
    const table = byLabel('living-tv-13x15', 'Coffee table');
    expect(gapY(sofa, table)).toBe(15);
    expect(Math.round((15 - sofa.y - sofa.height) * 12)).toBe(30);
    expect(gapX(table, byLabel('living-tv-13x15', 'Armchair'))).toBe(15);
    // L-shaped living room: 15 in from both seats to the table, 9 ft 6 in from sofa to TV.
    const lTable = byLabel('living-l-14x16', 'Coffee table');
    expect(gapX(byLabel('living-l-14x16', 'Sofa'), lTable)).toBe(15);
    expect(gapY(byLabel('living-l-14x16', 'Loveseat'), lTable)).toBe(15);
    expect(gapX(byLabel('living-l-14x16', 'Sofa'), byLabel('living-l-14x16', 'TV console'))).toBe(
      114,
    );
    // Studio: 32 in behind the sofa (to the table), coffee table 15 in from the sofa.
    expect(gapY(byLabel('studio-15x20', 'Sofa'), byLabel('studio-15x20', 'Table'))).toBe(32);
    expect(gapY(byLabel('studio-15x20', 'Sofa'), byLabel('studio-15x20', 'Coffee table'))).toBe(15);
    // Dorm: 54 in between the desk chairs.
    expect(
      gapX(
        byLabel('dorm-double-12x15', 'Desk chair'),
        byLabel('dorm-double-12x15', 'Desk chair', 1),
      ),
    ).toBe(54);
    // Office: at least 36 in behind the desk (to the reading chair, the nearest piece behind it).
    expect(
      gapY(byLabel('office-9x10', 'Desk'), byLabel('office-9x10', 'Reading chair')),
    ).toBeGreaterThanOrEqual(36);
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))(
    '%s: the share link opens exactly this layout',
    async (_id, e) => {
      const fragment = await exampleShareFragment(e);
      expect(fragment).toMatch(/^s=[A-Za-z0-9_-]+$/);
      const config = (await decodeShareFragment(fragment))!;
      expect(config.name).toBe(e.name);
      const layout = fromShareConfig(config);
      expect(layout.roomDims).toEqual(e.layout.roomDims);
      expect(layout.items.map((i) => i.label)).toEqual(e.layout.items.map((i) => i.label));
      for (const [n, item] of layout.items.entries()) {
        expect(item.x).toBeCloseTo(e.layout.items[n].x, 6);
        expect(item.y).toBeCloseTo(e.layout.items[n].y, 6);
        expect(item.width).toBeCloseTo(e.layout.items[n].width, 6);
        expect(item.height).toBeCloseTo(e.layout.items[n].height, 6);
      }
      expect(layout.doors.map((d) => d.type)).toEqual(e.layout.doors.map((d) => d.type));
    },
  );

  it('render as an inline, scalable SVG with no date in it', () => {
    const svg = exampleSvg(EXAMPLES[0]);
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    expect(svg).not.toMatch(/^<svg [^>]* width="/);
    expect(svg).toContain('Queen bed');
    // The export's footer reads "<date> · <site>"; the guides show the site only.
    expect(svg).toMatch(/text-anchor="end" fill="#64748b">room-planner\.andrechek\.com</);
  });
});
