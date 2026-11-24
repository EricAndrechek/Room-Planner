import { describe, expect, it } from 'vitest';
import { buildShareUrl, encodeLegacyConfig } from '../src/core/share/link';
import { checkPlan, createPlan, readPlan, readPlanInput, summarize, unknownFields } from './tools';

const ORIGIN = 'https://room-planner.andrechek.com';

const room = (w: number, d: number, openings: unknown[] = []) => ({
  id: 'room-1',
  outline: [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ],
  openings,
});

describe('reading an agent plan', () => {
  it('reports keys the format does not have, with their paths', () => {
    expect(
      unknownFields({
        version: 4,
        unit: 'ft',
        colour: 'x',
        rooms: [{ id: 'r', outline: [{ x: 0, y: 0, z: 1 }], openings: [{ id: 'd', side: 1 }] }],
        items: [{ id: 'i', placement: { x: 1, y: 1, angle: 90 } }],
        settings: { unitSystem: 'ft', grid: true },
      }),
    ).toEqual([
      'plan.colour',
      'plan.rooms.0.outline.0.z',
      'plan.rooms.0.openings.0.side',
      'plan.items.0.placement.angle',
      'plan.settings.grid',
    ]);
  });

  it('explains a missing plan, a newer version and an invalid one', () => {
    const missing = readPlanInput(undefined);
    expect(!missing.ok && missing.outcome.text).toMatch(/Missing argument "plan"/);
    const newer = readPlanInput({ version: 7 });
    expect(!newer.ok && newer.outcome.text).toMatch(/version 7.*up to 4/);
    const bad = readPlanInput({
      version: 4,
      unit: 'ft',
      rooms: [room(10, 10, [{ id: 'd', kind: 'door', wall: 9, offset: 0, width: 3 }])],
    });
    expect(!bad.ok && bad.outcome.text).toMatch(/^The plan is not valid/);
    expect(!bad.ok && bad.outcome.text).toContain('plan.rooms.0.openings.0.wall');
  });

  it('answers in the unit the agent wrote, with messages in it', async () => {
    const r = await createPlan(
      {
        plan: {
          version: 4,
          name: 'Study',
          unit: 'cm',
          rooms: [room(300, 250)],
          items: [
            { id: 'a', label: 'Desk', width: 120, depth: 60, placement: { x: 60, y: 30 } },
            { id: 'b', label: 'Shelf', width: 80, depth: 30, placement: { x: 140, y: 15 } },
          ],
        },
      },
      ORIGIN,
    );
    const s = r.structured as { plan: { unit: string; items: { width: number }[] } };
    expect(s.plan.unit).toBe('cm');
    expect(s.plan.items[0]!.width).toBe(120);
    expect(r.text).toContain('300 cm × 250 cm (7.5 m²)');
    expect(r.text).toContain('Desk overlaps Shelf by 20 cm');
  });
});

describe('summary', () => {
  it('describes rooms of any shape, hidden pieces and the inventory', () => {
    const input = readPlanInput({
      version: 4,
      name: 'Flat',
      unit: 'ft',
      rooms: [
        {
          id: 'living',
          name: 'Living room',
          outline: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 5 },
            { x: 5, y: 5 },
            { x: 5, y: 10 },
            { x: 0, y: 10 },
          ],
        },
        room(4, 4),
      ],
      items: [
        { id: 'a', label: 'Sofa', width: 7, depth: 3, placement: { x: 3.5, y: 1.5 } },
        { id: 'b', label: 'Lamp', width: 1, depth: 1, placement: { x: 1, y: 8 }, hidden: true },
        { id: 'c', label: 'Rug', width: 5, depth: 8 },
      ],
    });
    if (!input.ok) throw new Error(input.outcome.text);
    expect(summarize(input.plan)).toBe(
      `"Flat": 2 rooms. Living room has 6 corners and 75 sq ft, with 0 doors and 0 windows. ` +
        `room-1 is 4' × 4' (16 sq ft) with 0 doors and 0 windows. 1 piece placed. Hidden: Lamp. In the inventory: Rug.`,
    );
  });
});

describe('check_layout', () => {
  it('rejects a bad minClearance', () => {
    const r = checkPlan({
      plan: { version: 4, unit: 'ft', rooms: [room(10, 10)] },
      minClearance: -1,
    });
    expect(r.isError).toBe(true);
  });

  it('is ok with only info issues', () => {
    const r = checkPlan({
      plan: {
        version: 4,
        unit: 'in',
        rooms: [room(120, 120)],
        items: [{ id: 'a', label: 'Chair', width: 20, depth: 20, placement: { x: 20, y: 60 } }],
      },
    });
    const s = r.structured as { ok: boolean; issues: { code: string }[] };
    expect(s.issues.map((i) => i.code)).toEqual(['tight_clearance']);
    expect(s.ok).toBe(true);
  });
});

describe('read_plan', () => {
  const config = {
    name: 'Old link',
    unitSystem: 'in',
    roomDims: { width: 120, height: 144 },
    doors: [],
    windows: [],
    items: [
      { id: 1, label: 'Bed', width: 60, height: 80, x: 0, y: 0, rotation: 0, color: '#93c5fd' },
    ],
  };

  it('reads #s= links and old ?config= links, on any host, and links back to this site', async () => {
    const s = await readPlan(
      { url: await buildShareUrl('https://roomplanner.andrechek.com/', config) },
      ORIGIN,
    );
    const plan = (s.structured as { plan: { unit: string; items: { placement: unknown }[] } }).plan;
    expect(plan.unit).toBe('in');
    expect(plan.items[0]!.placement).toEqual({ x: 30, y: 40, rotation: 0 });
    expect((s.structured as { url: string }).url.startsWith(`${ORIGIN}/#s=`)).toBe(true);
    const legacy = await readPlan(
      {
        url: `https://evil.example/?config=${encodeURIComponent(encodeLegacyConfig(config as never))}`,
      },
      ORIGIN,
    );
    expect(legacy.isError).toBeFalsy();
    expect((legacy.structured as { url: string }).url.startsWith(`${ORIGIN}/?config=`)).toBe(true);
  });

  it('explains what is wrong with a link', async () => {
    expect((await readPlan({}, ORIGIN)).text).toMatch(/Missing argument "url"/);
    expect((await readPlan({ url: 'not a url' }, ORIGIN)).text).toMatch(/not a URL/);
    expect((await readPlan({ url: `${ORIGIN}/help/` }, ORIGIN)).text).toMatch(/no plan in it/);
    expect((await readPlan({ url: `${ORIGIN}/#s=AAAA` }, ORIGIN)).text).toMatch(/damaged/);
  });
});
