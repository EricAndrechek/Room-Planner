/**
 * Version 3 -> 4 (docs/design/plan-format.md, section 4, "The 3 -> 4 step").
 *
 * Version 3 is every layout written before v4: `{ roomDims, doors, windows, items }`, as stored
 * (lengths in feet, with `unitSystem` only a display preference) or as shared (lengths in
 * `unitSystem`, decimal feet when it is missing). The step first applies the same defaults the v3
 * app applied to whatever it read (missing lists are the starter room's, a missing number its
 * default, an entry that is not an object is dropped), then maps:
 *
 * - `roomDims` -> `rooms[0]`, a clockwise rectangle from (0,0); its extra fields stay on the room;
 * - doors, then windows -> `rooms[0].openings`; wall `top/right/bottom/left` -> `0/1/2/3`;
 *   `position` -> `offset` (the same on top and right; on bottom and left, where the clockwise
 *   wall runs the other way, `length - position - width`), and `hinge` likewise (`left/right` ->
 *   `start/end`, swapped on bottom and left). An opening is first put where the v3 app drew it:
 *   no wider than its wall and on it (v3 stored it as entered and clamped it when drawing);
 * - items: the top-left corner -> `placement`, the centre; `height` -> `depth`; `visible: false`
 *   -> `hidden: true`; colours to hex;
 * - ids: `room-1`, `door-<id>`, `window-<id>`, `item-<id>`;
 * - `unitSystem` -> `unit` (`ft` for `ft-in`, `ft` or none) and `settings.unitSystem`;
 *   `designMode` is UI state and leaves the document.
 *
 * Unknown fields stay on their entity. The step is frozen: it describes version 3, so it never
 * follows later changes to the app's defaults.
 */
import { migrateColor } from '../colors';
import { isJson, type Json } from './types';

export interface V3Options {
  /** The lengths are feet whatever `unitSystem` says (stored data), not in `unitSystem` (links). */
  lengthsInFeet?: boolean;
}

type V3Wall = 'top' | 'right' | 'bottom' | 'left';
const WALLS: V3Wall[] = ['top', 'right', 'bottom', 'left'];
const V3_DOOR_TYPES = [
  'swing-in',
  'swing-out',
  'double-in',
  'double-out',
  'sliding',
  'pocket',
  'bifold',
  'opening',
];
const UNIT_SYSTEMS = ['ft-in', 'ft', 'in', 'm', 'cm'];

// The v3 starter room, used where a v3 document has no list of its own.
const STARTER_DOORS: Json[] = [
  { id: 1, width: 3, position: 6, wall: 'bottom', hinge: 'left', type: 'swing-in' },
];
const STARTER_WINDOWS: Json[] = [{ id: 1, width: 4, position: 4, wall: 'top' }];
// prettier-ignore
const STARTER_ITEMS: Json[] = [
  { id: 1, label: 'Bed', width: 5, height: 6.5, x: 3.5, y: 0, rotation: 0, color: '#93c5fd', visible: true },
  { id: 2, label: 'Nightstand', width: 1.5, height: 1.5, x: 2, y: 0, rotation: 0, color: '#fcd34d', visible: true },
  { id: 3, label: 'Nightstand', width: 1.5, height: 1.5, x: 8.5, y: 0, rotation: 0, color: '#fcd34d', visible: true },
  { id: 4, label: 'Dresser', width: 1.5, height: 4, x: 0, y: 7, rotation: 0, color: '#d8b4fe', visible: true },
  { id: 5, label: 'Desk', width: 2, height: 4, x: 10, y: 6.5, rotation: 0, color: '#6ee7b7', visible: true },
  { id: 6, label: 'Chair', width: 1.5, height: 1.5, x: 8.3, y: 7.1, rotation: 0, color: '#fdba74', visible: true },
];
const STARTER_ROOM = { width: 12, height: 12 };

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const idOf = (v: unknown, fallback: string | number): string | number =>
  typeof v === 'number' || typeof v === 'string' ? v : fallback;

const omit = (o: Json, keys: string[]): Json => {
  const out: Json = {};
  for (const [k, v] of Object.entries(o)) if (!keys.includes(k)) out[k] = v;
  return out;
};

const list = (raw: unknown, fallback: Json[]): Json[] =>
  Array.isArray(raw) ? raw.filter(isJson) : structuredClone(fallback);

const normalizeDegrees = (deg: number): number => ((deg % 360) + 360) % 360;

export function migrateV3(doc: Json, { lengthsInFeet = false }: V3Options = {}): Json {
  const dims = isJson(doc.roomDims) ? doc.roomDims : {};
  const w = num(dims.width, STARTER_ROOM.width);
  const h = num(dims.height, STARTER_ROOM.height);
  const wallLength = (wall: V3Wall) => (wall === 'top' || wall === 'bottom' ? w : h);
  // Bottom and left run backwards along a clockwise outline.
  const reversed = (wall: V3Wall) => wall === 'bottom' || wall === 'left';

  const opening = (
    raw: Json,
    index: number,
    kind: 'door' | 'window',
    defaultWall: V3Wall,
  ): Json => {
    const wall = WALLS.includes(raw.wall as V3Wall) ? (raw.wall as V3Wall) : defaultWall;
    // Where the v3 app drew it: no wider than its wall, and kept on it.
    const len = wallLength(wall);
    const width = Math.min(num(raw.width, 3), len);
    const position = Math.min(Math.max(num(raw.position, 0), 0), Math.max(0, len - width));
    const out: Json = {
      ...omit(raw, ['id', 'width', 'position', 'wall', 'hinge', 'type', 'swingAngle', 'open']),
      id: `${kind}-${idOf(raw.id, index + 1)}`,
      kind,
      wall: WALLS.indexOf(wall),
      offset: reversed(wall) ? Math.max(0, len - position - width) : position,
      width,
    };
    if (kind === 'door') {
      out.type = V3_DOOR_TYPES.includes(raw.type as string) ? raw.type : 'swing-in';
      const right = raw.hinge === 'right';
      out.hinge = right !== reversed(wall) ? 'end' : 'start';
      if (raw.swingAngle === 90 || raw.swingAngle === 180) out.swingAngle = raw.swingAngle;
    }
    return out;
  };

  const item = (raw: Json, index: number): Json => {
    const width = num(raw.width, 3);
    const depth = num(raw.height, 2);
    const out: Json = {
      ...omit(raw, [
        'id',
        'label',
        'width',
        'height',
        'x',
        'y',
        'rotation',
        'color',
        'visible',
        'locked',
      ]),
      id:
        typeof raw.id === 'number' || typeof raw.id === 'string'
          ? `item-${raw.id}`
          : `item-${index + 1}`,
      label: typeof raw.label === 'string' ? raw.label : String(raw.label ?? 'Item'),
      color: migrateColor(raw.color),
      width,
      depth,
      placement: {
        x: num(raw.x, 0) + width / 2,
        y: num(raw.y, 0) + depth / 2,
        rotation: normalizeDegrees(num(raw.rotation, 0)),
      },
    };
    if (typeof raw.locked === 'boolean') out.locked = raw.locked;
    if (raw.visible === false) out.hidden = true;
    return out;
  };

  const unitSystem = UNIT_SYSTEMS.includes(doc.unitSystem as string)
    ? (doc.unitSystem as string)
    : undefined;
  const unit =
    lengthsInFeet || !unitSystem || unitSystem === 'ft-in' ? 'ft' : (unitSystem as string);

  const out: Json = {
    ...omit(doc, ['roomDims', 'doors', 'windows', 'items', 'unitSystem', 'designMode', 'name']),
    version: 4,
    ...(typeof doc.name === 'string' ? { name: doc.name } : {}),
    unit,
    rooms: [
      {
        ...omit(dims, ['width', 'height']),
        id: 'room-1',
        outline: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ],
        openings: [
          ...list(doc.doors, STARTER_DOORS).map((d, i) => opening(d, i, 'door', 'bottom')),
          ...list(doc.windows, STARTER_WINDOWS).map((o, i) => opening(o, i, 'window', 'top')),
        ],
      },
    ],
    items: list(doc.items, STARTER_ITEMS).map(item),
  };
  if (unitSystem) {
    const settings = isJson(doc.settings) ? doc.settings : {};
    out.settings = { ...settings, unitSystem };
  }
  return out;
}
