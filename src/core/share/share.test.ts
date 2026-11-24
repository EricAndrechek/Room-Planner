import { describe, expect, it } from 'vitest';
import originalLinks from '../__fixtures__/original-share-links.json';
import originalStorage from '../__fixtures__/original-storage.json';
import { migrateColor } from '../colors';
import { loadPlan } from '../load';
import {
  fromShareConfig,
  normalizeLayout,
  toShareConfig,
  type ShareConfig,
} from '../testing/v3/layout';
import {
  decodeLegacyConfig,
  decodeShareFragment,
  encodeLegacyConfig,
  readShareLink,
} from '../testing/v3/share';
import { INITIAL_DOORS, INITIAL_WINDOWS } from '../testing/v3/constants';
import type { Layout } from '../testing/v3/types';
import {
  buildShareUrl,
  decodeFragmentPayload,
  encodeShareFragment,
  hasShareLink,
  readSharePayload,
  stripShareLink,
} from './link';
import { buildPlanUrl, encodePlanFragment } from './plan';
import { base64UrlToBytes, bytesToBase64Url } from './codec';
import { unitValueToFeet } from '../units';
import { readSharedPlan } from '../../lib/boot';
import { mainRoom, openingPlace, samePlan, withDoc } from '../../lib/plans';
import type { Plan } from '../schema';

/** The plan the app holds for a v3 layout (what the storage migration makes of it). */
const toPlan = (layout: Layout): Plan => {
  const r = loadPlan(layout, 'strict', { lengthsInFeet: true });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.plan;
};

/** What the app opens for a link's payload (the data a v3 reader would take as a config). */
const opened = (data: unknown) => {
  const r = readSharedPlan(data);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
};

/**
 * Reference: what the ORIGINAL app (src/App.jsx, "1. Load from URL on mount")
 * put into state for a `?config=` link opened in a fresh browser (fresh =>
 * doors/windows fall back to the defaults when the link has none).
 */
const originalImport = (search: string) => {
  const configStr = new URLSearchParams(search).get('config');
  const parsed = JSON.parse(atob(configStr!));
  const sourceUnitSystem = parsed.unitSystem || 'ft';
  const conv = (v: number) => unitValueToFeet(v, sourceUnitSystem);
  let doors = structuredClone(INITIAL_DOORS) as unknown[];
  if (parsed.doors) {
    doors = parsed.doors.map((d: Record<string, number>) => ({
      ...d,
      width: conv(d.width!),
      position: conv(d.position!),
    }));
  } else if (parsed.door) {
    doors = [
      {
        ...parsed.door,
        id: 1,
        type: parsed.door.open === 'in' ? 'swing-in' : 'swing-out',
        width: conv(parsed.door.width),
        position: conv(parsed.door.position),
      },
    ];
  }
  const windows = parsed.windows
    ? parsed.windows.map((w: Record<string, number>) => ({
        ...w,
        width: conv(w.width!),
        position: conv(w.position!),
      }))
    : structuredClone(INITIAL_WINDOWS);
  return {
    roomDims: { width: conv(parsed.roomDims.width), height: conv(parsed.roomDims.height) },
    doors,
    windows,
    items: parsed.items.map((i: Record<string, number | string>) => ({
      ...i,
      x: conv(i.x as number),
      y: conv(i.y as number),
      width: conv(i.width as number),
      height: conv(i.height as number),
      color: migrateColor(i.color),
    })),
  };
};

const storedLayout = (): Layout =>
  normalizeLayout({
    roomDims: JSON.parse(originalStorage.localStorage['room-sim-v3-dims']),
    doors: JSON.parse(originalStorage.localStorage['room-sim-v3-doors']),
    windows: JSON.parse(originalStorage.localStorage['room-sim-v3-windows']),
    items: JSON.parse(originalStorage.localStorage['room-sim-v3-items']),
  });

const sameLayout = (actual: Layout, expected: Layout, digits = 9) => {
  expect(actual.doors.map((d) => d.id)).toEqual(expected.doors.map((d) => d.id));
  const flat = (l: Layout) =>
    JSON.stringify(l, (_k, v) => (typeof v === 'number' ? Number(v.toFixed(digits)) : v));
  expect(JSON.parse(flat(actual))).toEqual(JSON.parse(flat(expected)));
};

describe('legacy ?config= links (captured from the original app)', () => {
  it.each([
    ['feet & inches', originalLinks.ftIn.url],
    ['meters', originalLinks.meters.url],
  ])('imports a %s link exactly like the original did', async (_name, href) => {
    const link = await readShareLink(href);
    expect(link?.legacy).toBe(true);
    const layout = fromShareConfig(link!.config);
    expect(layout).toEqual(originalImport(new URL(href).search));
    // The app opens the same plan.
    const payload = await readSharePayload(href);
    if (payload.status !== 'ok') throw new Error(payload.status);
    expect(payload.legacy).toBe(true);
    expect(samePlan(opened(payload.data).plan, toPlan(layout))).toBe(true);
  });

  it('reproduces the layout the sharer had (Latin-1 name preserved)', async () => {
    const ftIn = await readShareLink(originalLinks.ftIn.url);
    expect(ftIn!.config.name).toBe('Café Plan');
    // Both links are lossy only at the export's 6-decimal precision.
    sameLayout(fromShareConfig(ftIn!.config), storedLayout(), 5);
    const meters = await readShareLink(originalLinks.meters.url);
    sameLayout(fromShareConfig(meters!.config), storedLayout(), 4);
    // And the app opens them as the plan it holds for the sharer's layout, with the name.
    const stored = toPlan(storedLayout());
    expect(opened(ftIn!.config).name).toBe('Café Plan');
    expect(samePlan(opened(ftIn!.config).plan, stored)).toBe(true);
    expect(samePlan(opened(meters!.config).plan, stored)).toBe(true);
  });

  it('the original JSON export box still opens, as the same plan', () => {
    // The old export box had no replacement format of its own; its text must still be accepted.
    const stored = toPlan(storedLayout());
    expect(opened(originalLinks.ftIn.json)).toMatchObject({ name: 'Café Plan', named: true });
    expect(samePlan(opened(originalLinks.ftIn.json).plan, stored)).toBe(true);
    expect(samePlan(opened(originalLinks.meters.json).plan, stored)).toBe(true);
  });

  it('decodes a v2 link with the single `door` field and Tailwind colors', async () => {
    // Exactly what commit 650f35d's getShareUrl produced: { roomDims, door, items } in feet.
    const v2: ShareConfig = {
      roomDims: { width: 10, height: 9 },
      door: { width: 2.5, position: 3, wall: 'left', hinge: 'right', open: 'in' },
      items: [
        {
          id: 1,
          label: 'Bed',
          width: 6,
          height: 4,
          x: 2,
          y: 2,
          rotation: 0,
          color: 'bg-blue-200 border-blue-400',
          visible: true,
        },
        {
          id: 2,
          label: 'Desk',
          width: 4,
          height: 2,
          x: 9,
          y: 2,
          rotation: 30,
          color: 'bg-fuchsia-200 border-fuchsia-400',
          visible: true,
        },
      ],
    };
    const href = `https://example.com/?config=${encodeURIComponent(encodeLegacyConfig(v2))}`;
    const link = await readShareLink(href);
    const layout = fromShareConfig(link!.config);
    expect(layout).toEqual(originalImport(new URL(href).search));
    expect(layout.doors).toEqual([
      {
        width: 2.5,
        position: 3,
        wall: 'left',
        hinge: 'right',
        open: 'in',
        id: 1,
        type: 'swing-in',
      },
    ]);
    expect(layout.items.map((i) => i.color)).toEqual(['#93c5fd', '#f9a8d4']);
    expect(layout.windows).toEqual(INITIAL_WINDOWS);

    const out = fromShareConfig({ ...v2, door: { ...v2.door!, open: 'out' } });
    expect(out.doors[0]!.type).toBe('swing-out');

    // The app opens it the same way.
    const { plan } = opened(link!.config);
    expect(samePlan(plan, toPlan(layout))).toBe(true);
    const room = mainRoom(plan);
    const doors = room.openings.filter((o) => o.kind === 'door');
    expect(doors).toHaveLength(1);
    expect(openingPlace(room, doors[0]!)).toEqual({
      wall: 3, // left
      position: 3,
      width: 2.5,
      hinge: 'right',
    });
    expect(doors[0]!.type).toBe('swing-in');
    expect(plan.items.map((i) => i.color)).toEqual(['#93c5fd', '#f9a8d4']);
    expect(room.openings.filter((o) => o.kind === 'window')).toHaveLength(INITIAL_WINDOWS.length);
    expect(
      mainRoom(opened({ ...v2, door: { ...v2.door!, open: 'out' } }).plan).openings[0]!.type,
    ).toBe('swing-out');
  });

  it('decodes an early v3 link (multi-door, no unitSystem => feet)', () => {
    const cfg: ShareConfig = {
      roomDims: { width: 12, height: 10 },
      doors: [{ id: 5, width: 3, position: 1, wall: 'top', hinge: 'left', type: 'sliding' }],
      windows: [],
      items: [],
    };
    const config = decodeLegacyConfig(encodeLegacyConfig(cfg))!;
    const layout = fromShareConfig(config);
    expect(layout.roomDims).toEqual({ width: 12, height: 10 });
    expect(layout.doors[0]).toMatchObject({ id: 5, width: 3, position: 1, type: 'sliding' });
    expect(layout.windows).toEqual([]);

    const room = mainRoom(opened(config).plan);
    expect(room.openings).toHaveLength(1);
    expect(room.openings[0]).toMatchObject({ kind: 'door', width: 3, type: 'sliding' });
    expect(openingPlace(room, room.openings[0]!)).toMatchObject({
      wall: 0, // top
      position: 1,
      width: 3,
    });
  });

  it('tolerates an unescaped + that arrived as a space', () => {
    const cfg: ShareConfig = { roomDims: { width: 1, height: 1 }, items: [{ label: '>>>?' }] };
    const encoded = encodeLegacyConfig(cfg);
    expect(encoded).toContain('+');
    expect(decodeLegacyConfig(encoded.replace(/\+/g, ' '))).toEqual(cfg);
  });

  it('rejects garbage', () => {
    expect(decodeLegacyConfig('not base64!')).toBeNull();
    expect(decodeLegacyConfig(btoa('{"foo":1}'))).toBeNull();
    expect(decodeLegacyConfig(btoa('[1,2]'))).toBeNull();
    // The app does not open a document that is not a layout either.
    expect(readSharedPlan({ foo: 1 }).ok).toBe(false);
    expect(readSharedPlan([1, 2]).ok).toBe(false);
  });

  it('the original encoder could not handle emoji (bug this replaces)', () => {
    expect(originalLinks.emojiName.url.endsWith('?config=')).toBe(true);
    expect(() =>
      encodeLegacyConfig({ name: 'Bedroom 🛏️', roomDims: { width: 1, height: 1 }, items: [] }),
    ).toThrow();
  });
});

describe('new #s= fragment links', () => {
  const layout = storedLayout();
  /** The plan with a name and display units: what the app shares. */
  const shared = (name: string, units: Parameters<typeof withDoc>[2], l: Layout = layout) =>
    withDoc(toPlan(l), name, units);

  it('round-trips a plan (compressed)', async () => {
    const plan = shared('Café Plan', 'ft-in');
    const fragment = await encodePlanFragment(plan);
    expect(fragment.startsWith('s=')).toBe(true);
    expect(fragment).toMatch(/^s=[A-Za-z0-9_-]+$/); // URL-safe, no padding
    const decoded = await decodeFragmentPayload(`#${fragment}`);
    if (decoded.status !== 'ok') throw new Error(decoded.status);
    const back = opened(decoded.data);
    expect(back.name).toBe('Café Plan');
    expect(samePlan(back.plan, plan)).toBe(true);
  });

  it('still reads a v3 layout in a fragment (links made before the plan format)', async () => {
    const config = toShareConfig(layout, 'Café Plan', 'ft-in');
    const fragment = await encodeShareFragment(config);
    expect(fragment.startsWith('s=')).toBe(true);
    const decoded = await decodeShareFragment(`#${fragment}`);
    expect(decoded).toEqual(config);
    sameLayout(fromShareConfig(decoded!), layout, 5);
    const back = opened(decoded);
    expect(back.name).toBe('Café Plan');
    expect(samePlan(back.plan, toPlan(layout))).toBe(true);
  });

  it('is much shorter than the legacy link', async () => {
    const url = await buildPlanUrl('https://example.com/', shared('Café Plan', 'ft-in'));
    expect(url.length).toBeLessThan(originalLinks.ftIn.url.length * 0.6);
  });

  it('round-trips unicode names and labels', async () => {
    const plan = withDoc(
      {
        ...toPlan(layout),
        items: toPlan(layout).items.map((i, n) => ({
          ...i,
          label: ['Bett 🛏️', 'Schreibtisch', '衣柜', 'Ковёр'][n]!,
        })),
      },
      'Bedroom 🛏️ — 2ᵉ étage',
      'm',
    );
    for (const compress of [true, false]) {
      const url = await buildPlanUrl('https://example.com/planner/', plan, { compress });
      const payload = await readSharePayload(url);
      if (payload.status !== 'ok') throw new Error(payload.status);
      expect(payload.legacy).toBe(false);
      const back = opened(payload.data);
      expect(back.name).toBe('Bedroom 🛏️ — 2ᵉ étage');
      expect(back.plan.items.map((i) => i.label)).toEqual(plan.items.map((i) => i.label));
      expect(samePlan(back.plan, plan)).toBe(true);
    }
  });

  it('round-trips every door type and opening angle; old links keep working', async () => {
    const types = [
      'swing-in',
      'swing-out',
      'double-in',
      'double-out',
      'sliding',
      'pocket',
      'bifold',
      'opening',
    ] as const;
    const doors = types.map((type, i) => ({
      id: i + 1,
      width: 3,
      position: 0.5,
      wall: (['top', 'right', 'bottom', 'left'] as const)[i % 4]!,
      hinge: 'right' as const,
      type,
      ...(type.startsWith('swing') || type.startsWith('double')
        ? { swingAngle: 180 as const }
        : {}),
    }));
    const plan = shared('Doors', 'cm', { ...layout, doors });
    const payload = await readSharePayload(await buildPlanUrl('https://example.com/', plan));
    if (payload.status !== 'ok') throw new Error(payload.status);
    const room = mainRoom(opened(payload.data).plan);
    const back = room.openings.filter((o) => o.kind === 'door');
    expect(back.map((d) => [d.type, d.swingAngle, openingPlace(room, d).hinge])).toEqual(
      doors.map((d) => [d.type, d.swingAngle, d.hinge]),
    );
    // A link from before door types/angles existed: unchanged, with no angle (= 90deg).
    const config = toShareConfig({ ...layout, doors }, 'Doors', 'cm');
    const oldRoom = mainRoom(
      opened({
        ...config,
        doors: [
          { id: 1, width: 91.44, position: 30, wall: 'bottom', hinge: 'left', type: 'swing-out' },
        ],
      }).plan,
    );
    const old = oldRoom.openings.find((o) => o.kind === 'door')!;
    expect(old.type).toBe('swing-out');
    expect('swingAngle' in old).toBe(false);
    // Unknown types and angles fall back to the defaults.
    const oddRoom = mainRoom(
      opened({
        ...config,
        doors: [
          { id: 1, width: 91.44, position: 30, wall: 'bottom', type: 'revolving', swingAngle: 135 },
        ],
      }).plan,
    );
    const odd = oddRoom.openings.find((o) => o.kind === 'door')!;
    expect(odd.type).toBe('swing-in');
    expect('swingAngle' in odd).toBe(false);
  });

  it('uncompressed fallback uses #j=', async () => {
    const plan = shared('x', 'ft');
    const fragment = await encodePlanFragment(plan, { compress: false });
    expect(fragment.startsWith('j=')).toBe(true);
    const decoded = await decodeFragmentPayload(fragment);
    if (decoded.status !== 'ok') throw new Error(decoded.status);
    expect(samePlan(opened(decoded.data).plan, plan)).toBe(true);
    // Old links in that form decode too.
    const config = toShareConfig(layout, 'x', 'ft');
    expect(
      await decodeShareFragment(await encodeShareFragment(config, { compress: false })),
    ).toEqual(config);
  });

  it('returns null for unrelated or corrupt fragments', async () => {
    expect(await decodeShareFragment('#section-2')).toBeNull();
    expect(await decodeShareFragment('#s=!!!')).toBeNull();
    expect(await decodeShareFragment('#s=AAAA')).toBeNull();
    expect(await readShareLink('https://example.com/#top')).toBeNull();
    expect((await readSharePayload('https://example.com/#top')).status).toBe('none');
    expect((await readSharePayload('https://example.com/#s=!!!')).status).toBe('damaged');
  });

  it('prefers the fragment over a legacy query', async () => {
    const old = encodeLegacyConfig(toShareConfig(layout, 'old', 'ft'));
    const withLegacy = (href: string) => {
      const url = new URL(href);
      url.searchParams.set('config', old);
      return url.toString();
    };
    const url = withLegacy(await buildPlanUrl('https://example.com/', shared('new', 'ft')));
    const payload = await readSharePayload(url);
    if (payload.status !== 'ok') throw new Error(payload.status);
    expect(opened(payload.data).name).toBe('new');
    // Links in the v3 form, read as before.
    const v3Url = withLegacy(
      await buildShareUrl('https://example.com/', toShareConfig(layout, 'new', 'ft')),
    );
    expect((await readShareLink(v3Url))!.config.name).toBe('new');
  });
});

describe('URL helpers', () => {
  it('detects and strips share payloads', async () => {
    const legacy = 'https://example.com/?config=abc&utm=1';
    expect(hasShareLink(legacy)).toBe(true);
    expect(stripShareLink(legacy)).toBe('https://example.com/?utm=1');
    const fresh = await buildPlanUrl(legacy, withDoc(toPlan(storedLayout()), 'n', 'ft'));
    expect(fresh.startsWith('https://example.com/?utm=1#s=')).toBe(true);
    expect(hasShareLink(fresh)).toBe(true);
    expect(stripShareLink(fresh)).toBe('https://example.com/?utm=1');
    expect(hasShareLink('https://example.com/#about')).toBe(false);
    expect(stripShareLink('https://example.com/#about')).toBe('https://example.com/#about');
  });

  it('base64url helpers round-trip all byte values', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(base64UrlToBytes(bytesToBase64Url(bytes)))).toEqual(Array.from(bytes));
  });
});
