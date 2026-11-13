import { describe, expect, it } from 'vitest';
import originalLinks from './__fixtures__/original-share-links.json';
import originalStorage from './__fixtures__/original-storage.json';
import { INITIAL_DOORS, INITIAL_WINDOWS } from './constants';
import { migrateColor } from './colors';
import { fromShareConfig, normalizeLayout, toShareConfig, type ShareConfig } from './layout';
import {
  base64UrlToBytes,
  buildShareUrl,
  bytesToBase64Url,
  decodeLegacyConfig,
  decodeShareFragment,
  encodeLegacyConfig,
  encodeShareFragment,
  hasShareLink,
  readShareLink,
  stripShareLink,
} from './share';
import { unitValueToFeet } from './units';
import type { Layout } from '../types';

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
  });

  it('reproduces the layout the sharer had (Latin-1 name preserved)', async () => {
    const ftIn = await readShareLink(originalLinks.ftIn.url);
    expect(ftIn!.config.name).toBe('Café Plan');
    // Both links are lossy only at the export's 6-decimal precision.
    sameLayout(fromShareConfig(ftIn!.config), storedLayout(), 5);
    const meters = await readShareLink(originalLinks.meters.url);
    sameLayout(fromShareConfig(meters!.config), storedLayout(), 4);
  });

  it('matches the original JSON export box', () => {
    expect(toShareConfig(storedLayout(), 'Café Plan', 'ft-in')).toEqual(originalLinks.ftIn.json);
    expect(toShareConfig(storedLayout(), 'Café Plan', 'm')).toEqual(originalLinks.meters.json);
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
  });

  it('decodes an early v3 link (multi-door, no unitSystem => feet)', () => {
    const cfg: ShareConfig = {
      roomDims: { width: 12, height: 10 },
      doors: [{ id: 5, width: 3, position: 1, wall: 'top', hinge: 'left', type: 'sliding' }],
      windows: [],
      items: [],
    };
    const layout = fromShareConfig(decodeLegacyConfig(encodeLegacyConfig(cfg))!);
    expect(layout.roomDims).toEqual({ width: 12, height: 10 });
    expect(layout.doors[0]).toMatchObject({ id: 5, width: 3, position: 1, type: 'sliding' });
    expect(layout.windows).toEqual([]);
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

  it('round-trips a layout (compressed)', async () => {
    const config = toShareConfig(layout, 'Café Plan', 'ft-in');
    const fragment = await encodeShareFragment(config);
    expect(fragment.startsWith('s=')).toBe(true);
    expect(fragment).toMatch(/^s=[A-Za-z0-9_-]+$/); // URL-safe, no padding
    const decoded = await decodeShareFragment(`#${fragment}`);
    expect(decoded).toEqual(config);
    sameLayout(fromShareConfig(decoded!), layout, 5);
  });

  it('is much shorter than the legacy link', async () => {
    const config = toShareConfig(layout, 'Café Plan', 'ft-in');
    const url = await buildShareUrl('https://example.com/', config);
    expect(url.length).toBeLessThan(originalLinks.ftIn.url.length * 0.6);
  });

  it('round-trips unicode names and labels', async () => {
    const config = toShareConfig(
      {
        ...layout,
        items: layout.items.map((i, n) => ({
          ...i,
          label: ['Bett 🛏️', 'Schreibtisch', '衣柜', 'Ковёр'][n]!,
        })),
      },
      'Bedroom 🛏️ — 2ᵉ étage',
      'm',
    );
    for (const compress of [true, false]) {
      const url = await buildShareUrl('https://example.com/planner/', config, { compress });
      const link = await readShareLink(url);
      expect(link).toEqual({ config, legacy: false });
    }
  });

  it('uncompressed fallback uses #j=', async () => {
    const config = toShareConfig(layout, 'x', 'ft');
    const fragment = await encodeShareFragment(config, { compress: false });
    expect(fragment.startsWith('j=')).toBe(true);
    expect(await decodeShareFragment(fragment)).toEqual(config);
  });

  it('returns null for unrelated or corrupt fragments', async () => {
    expect(await decodeShareFragment('#section-2')).toBeNull();
    expect(await decodeShareFragment('#s=!!!')).toBeNull();
    expect(await decodeShareFragment('#s=AAAA')).toBeNull();
    expect(await readShareLink('https://example.com/#top')).toBeNull();
  });

  it('prefers the fragment over a legacy query', async () => {
    const a = toShareConfig(layout, 'new', 'ft');
    const b = toShareConfig(layout, 'old', 'ft');
    const url = new URL(await buildShareUrl('https://example.com/', a));
    url.searchParams.set('config', encodeLegacyConfig(b));
    expect((await readShareLink(url.toString()))!.config.name).toBe('new');
  });
});

describe('URL helpers', () => {
  it('detects and strips share payloads', async () => {
    const legacy = 'https://example.com/?config=abc&utm=1';
    expect(hasShareLink(legacy)).toBe(true);
    expect(stripShareLink(legacy)).toBe('https://example.com/?utm=1');
    const fresh = await buildShareUrl(legacy, toShareConfig(storedLayout(), 'n', 'ft'));
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
