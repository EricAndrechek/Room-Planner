import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadPlan } from '../core/load';
import type { Plan } from '../core/schema';
import { readSharePayload } from '../core/share/link';
import { parseReadable, toReadable, toReadableLink } from '../core/share/readable';
import { goldenCases } from '../core/testing/cases';
import { readSharedPlan } from './boot';
import { EXAMPLES } from './guides/examples';
import { READABLE_EXAMPLES } from './site';

const SITE = 'https://room-planner.andrechek.com/';

/** What the editor opens from `href`. */
async function opened(href: string): Promise<Plan & { openedName: string }> {
  const payload = await readSharePayload(href);
  if (payload.status !== 'ok') throw new Error(`payload ${payload.status}`);
  expect(payload.source).toBe('compact');
  const read = readSharedPlan(payload.data);
  if (!read.ok) throw new Error(`not opened: ${read.problem}`);
  return { ...read.plan, openedName: read.name };
}

/** The parts of a plan the readable syntax carries, rounded for comparison (feet). */
const shape = (plan: Plan) => {
  const r = (v: number) => Math.round(v * 100) / 100 + 0;
  return {
    rooms: plan.rooms.map((room) => ({
      name: room.name?.trim() || null,
      outline: room.outline.map((p) => [r(p.x), r(p.y)]),
      openings: room.openings.map((o) => ({
        kind: o.kind,
        wall: o.wall,
        offset: r(o.offset),
        width: r(o.width),
        ...(o.kind === 'door'
          ? { type: o.type, hinge: o.hinge, swingAngle: o.swingAngle ?? 90 }
          : {}),
      })),
    })),
    items: plan.items.map((i) => ({
      label: i.label.trim() || 'Piece',
      size: [r(i.width), r(i.depth)],
      shape: i.shape,
      cut: i.cut ? [i.cut.corner, r(i.cut.width), r(i.cut.depth)] : null,
      color: i.color.toLowerCase(),
      placement: i.placement
        ? [r(i.placement.x), r(i.placement.y), Math.round(i.placement.rotation * 100) / 100]
        : null,
    })),
  };
};

/** `a` and `b` agree, numbers within `tol` (feet; the syntax writes 3 decimals of its unit). */
const close = (a: unknown, b: unknown, path = ''): void => {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 0.01) expect(a, path).toBe(b);
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    expect(Object.keys(a as object).sort(), path).toEqual(Object.keys(b as object).sort());
    for (const k of Object.keys(a as object)) {
      close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    }
  } else {
    expect(a, path).toEqual(b);
  }
};

const roundTrip = (plan: Plan): Plan => {
  const parsed = parseReadable(toReadable(plan));
  if (parsed.status !== 'ok') throw new Error('unreadable');
  const r = loadPlan(parsed.data, 'lenient');
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};

describe('readable links (#p=)', () => {
  it('open the documented examples as the plans they describe', async () => {
    const bedroom = await opened(`${SITE}#p=${READABLE_EXAMPLES.bedroom}`);
    expect(bedroom.openedName).toBe('Bedroom');
    expect(bedroom.rooms.map((r) => r.outline)).toEqual([
      [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 11 },
        { x: 0, y: 11 },
      ],
    ]);
    // "door:bottom:8:3": 8 ft from the left end of the bottom wall, so 1 ft from its start corner.
    expect(bedroom.rooms[0]!.openings.map((o) => [o.kind, o.wall, o.offset, o.width])).toEqual([
      ['door', 2, 1, 3],
      ['window', 0, 4, 4],
    ]);
    expect(bedroom.items.map((i) => [i.label, Boolean(i.placement)])).toEqual([
      ['Queen bed', true],
      ['Nightstand', true],
      ['Dresser', true],
    ]);

    const flat = await opened(`${SITE}#p=${READABLE_EXAMPLES.flat}`);
    expect(flat.rooms.map((r) => [r.name, r.outline[0]])).toEqual([
      ['Living room', { x: 0, y: 0 }],
      ['Bedroom', { x: 14, y: 0 }],
    ]);
    const table = flat.items.find((i) => i.label === 'Dining table')!;
    expect(table.shape).toBe('ellipse');
    expect(flat.items.find((i) => i.label === 'Armchair')!.placement).toBeUndefined();
    // The door on the living room's right wall is the door between the rooms.
    expect(flat.rooms[0]!.openings[0]).toMatchObject({ kind: 'door', wall: 1, offset: 8 });
  });

  it('forgive what models and chat apps do: case, spaces, extra separators', async () => {
    const clean = await opened(`${SITE}#p=${READABLE_EXAMPLES.bedroom}`);
    const sloppy = READABLE_EXAMPLES.bedroom
      .replace(/(^|;)room:/g, '$1ROOM: ')
      .replace(/door:bottom/g, 'Door : Bottom ')
      .replace(/;/g, ';;')
      .replace('5x6.7', '5 X 6.7');
    const s = await opened(`${SITE}#p=${encodeURI(sloppy)};unknown:thing;`);
    expect(shape(s)).toEqual(shape(clean));
  });

  it('measure an opening from either end of its wall', async () => {
    // A 20 x 12 room. Doors 2 ft from the far end of each wall, 3 ft wide, and the same doors
    // written from the near end.
    const room = 'ft;room:Dining:20x12;';
    const far = await opened(
      `${SITE}#p=${room}door:top:end-2:3;door:right:end-2:3;door:bottom:right-2:3;window:left:bottom-2:3`,
    );
    const near = await opened(
      `${SITE}#p=${room}door:top:15:3;door:right:7:3;door:bottom:15:3;window:left:7:3`,
    );
    expect(shape(far)).toEqual(shape(near));
    // Bottom wall: the format measures clockwise, from the right end, so 2 ft from the right.
    expect(far.rooms[0]!.openings[2]).toMatchObject({ wall: 2, offset: 2, width: 3 });
    // An end the wall has not: measured from the near end, with a note.
    const odd = parseReadable(`${room}door:top:bottom-2:3`);
    expect(odd.status === 'ok' && odd.notes).toEqual([
      'statement 3 (door): a top wall has no bottom end; measured from the left',
    ]);
    // Numbered walls of an outline: `end-` measures from corner i + 1.
    const l = parseReadable('ft;room:L:0,0,10,0,10,5,5,5,5,10,0,10;door:1:end-1:2');
    expect(l.status === 'ok' && l.data.rooms).toMatchObject([
      { openings: [{ kind: 'door', wall: 1, offset: 2, width: 2 }] },
    ]);
  });

  it('report a link without a room as damaged, and never throw', () => {
    expect(parseReadable('ft;item:Bed:5x6').status).toBe('damaged');
    expect(parseReadable('').status).toBe('damaged');
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        const r = parseReadable(s);
        expect(['ok', 'damaged']).toContain(r.status);
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            'room',
            'door',
            'window',
            'item',
            'ft',
            'cm',
            ':',
            ';',
            '@',
            ',',
            'x',
            '1',
            '2.5',
            '-',
            'top',
            'L-tr-1x1',
            'round',
            '%',
            '_',
          ),
          { maxLength: 40 },
        ),
        (parts) => {
          const r = parseReadable(parts.join(''));
          expect(['ok', 'damaged']).toContain(r.status);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('round-trip every guide example and every fixture', async () => {
    const plans: [string, Plan][] = [
      ...EXAMPLES.map((e): [string, Plan] => [`guide ${e.id}`, e.plan]),
      ...(await goldenCases()).map((c): [string, Plan] => [c.name, c.plan]),
    ];
    expect(plans.length).toBeGreaterThan(10);
    for (const [name, plan] of plans) {
      close(shape(roundTrip(plan)), shape(plan), name);
    }
  });

  it('round-trip floors of several rooms, outlines, shapes and set-aside pieces', () => {
    const r = loadPlan(
      {
        version: 4,
        name: 'Odd: names; and_more 100%',
        unit: 'cm',
        settings: { unitSystem: 'cm' },
        rooms: [
          {
            id: 'a',
            name: 'Living',
            outline: [
              { x: 0, y: 0 },
              { x: 500, y: 0 },
              { x: 500, y: 250 },
              { x: 300, y: 250 },
              { x: 300, y: 400 },
              { x: 0, y: 400 },
            ],
            openings: [{ id: 'd', kind: 'door', wall: 3, offset: 20, width: 80, type: 'sliding' }],
          },
          {
            id: 'b',
            name: 'Bed',
            outline: [
              { x: 300, y: 250 },
              { x: 500, y: 250 },
              { x: 500, y: 400 },
              { x: 300, y: 400 },
            ],
            openings: [
              { id: 'w', kind: 'window', wall: 2, offset: 30, width: 90 },
              {
                id: 'e',
                kind: 'door',
                wall: 3,
                offset: 10,
                width: 80,
                hinge: 'end',
                swingAngle: 180,
              },
            ],
          },
        ],
        items: [
          {
            id: 'l',
            label: 'L sofa',
            shape: 'l',
            width: 270,
            depth: 210,
            cut: { corner: 'tr', width: 180, depth: 120 },
            placement: { x: 140, y: 120, rotation: 90 },
          },
          {
            id: 't',
            label: 'Table',
            shape: 'ellipse',
            width: 100,
            depth: 100,
            placement: { x: 400, y: 100 },
          },
          { id: 'c', label: 'Chair: spare', width: 50, depth: 50 },
        ],
      },
      'strict',
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    close(shape(roundTrip(r.plan)), shape(r.plan));
    expect(roundTrip(r.plan).name).toBe('Odd: names; and_more 100%');
    expect(toReadableLink(r.plan, SITE)).toMatch(/^https:\/\/room-planner\.andrechek\.com\/#p=cm;/);
  });
});
