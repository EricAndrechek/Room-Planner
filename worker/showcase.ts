/**
 * Plans for the screenshots in the directory listings (the plan viewer in a chat): realistic,
 * well-proportioned, and clean (no errors, no warnings) so that the viewer shows its best.
 * Written the way agents write plans: inches, their own ids. Rotation 0 faces up the page; 90 faces
 * right. Only the carousel test and the showcase unit test use them.
 */

type Opening = {
  id: string;
  kind: 'door' | 'window';
  wall: number;
  offset: number;
  width: number;
  hinge?: 'start' | 'end';
  type?: string;
};

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

const piece = (
  id: string,
  label: string,
  width: number,
  depth: number,
  color: string,
  x: number,
  y: number,
  rotation = 0,
  extra: Record<string, unknown> = {},
) => ({ id, label, width, depth, color, ...extra, placement: { x, y, rotation } });

const door = (id: string, wall: number, offset: number, width = 32, more = {}): Opening => ({
  id,
  kind: 'door',
  wall,
  offset,
  width,
  ...more,
});
const window = (id: string, wall: number, offset: number, width: number): Opening => ({
  id,
  kind: 'window',
  wall,
  offset,
  width,
});

/** An 11' × 12' primary bedroom. */
export const SHOWCASE_BEDROOM = {
  version: 4,
  name: 'Primary bedroom',
  unit: 'in',
  settings: { unitSystem: 'ft-in' },
  rooms: [
    {
      id: 'bedroom',
      name: 'Primary bedroom',
      outline: rect(0, 0, 132, 144),
      openings: [door('door', 2, 30), window('window', 3, 14, 48)],
    },
  ],
  items: [
    piece('bed', 'Queen bed', 60, 80, '#c4b5fd', 66, 40),
    piece('ns-left', 'Nightstand', 30, 18, '#fcd34d', 17, 9),
    piece('ns-right', 'Nightstand', 30, 18, '#fcd34d', 115, 9),
    piece('dresser', 'Dresser', 54, 18, '#d8b4fe', 123, 113, 90),
    piece('desk', 'Desk', 48, 24, '#6ee7b7', 12, 116, 90),
    piece('chair', 'Desk chair', 18, 18, '#fdba74', 35, 116, 270),
  ],
};

/** A 15' × 17' living room. */
export const SHOWCASE_LIVING_ROOM = {
  version: 4,
  name: 'Living room',
  unit: 'in',
  settings: { unitSystem: 'ft-in' },
  rooms: [
    {
      id: 'living',
      name: 'Living room',
      outline: rect(0, 0, 180, 204),
      openings: [
        door('door', 2, 10, 36),
        window('window-left', 3, 70, 60),
        window('window-top', 0, 130, 36),
      ],
    },
  ],
  items: [
    piece('tv', 'TV stand', 64, 18, '#a8a29e', 90, 10),
    piece('sofa', 'Sofa', 88, 36, '#93c5fd', 90, 146),
    piece('coffee', 'Coffee table', 48, 24, '#d6b38a', 90, 100),
    piece('chair-left', 'Armchair', 34, 34, '#fdba74', 20, 100, 90),
    piece('chair-right', 'Armchair', 34, 34, '#fdba74', 160, 100, 270),
    piece('side', 'Side table', 18, 18, '#fcd34d', 36, 156, 0, { shape: 'ellipse' }),
  ],
};

/** A living/dining room and a bedroom side by side, with an armchair set aside. */
export const SHOWCASE_FLAT = {
  version: 4,
  name: 'Two-room flat',
  unit: 'in',
  settings: { unitSystem: 'ft-in' },
  rooms: [
    {
      id: 'living',
      name: 'Living / dining',
      outline: rect(0, 0, 216, 180),
      openings: [
        door('entry', 2, 150),
        door('to-bedroom', 1, 92),
        window('living-window-1', 0, 24, 48),
        window('living-window-2', 0, 120, 48),
        window('living-window-3', 3, 60, 48),
      ],
    },
    {
      id: 'bedroom',
      name: 'Bedroom',
      outline: rect(216, 0, 132, 180),
      openings: [window('bedroom-window', 0, 42, 48), window('bedroom-window-2', 1, 90, 48)],
    },
  ],
  items: [
    piece('sofa', 'L-shaped sofa', 96, 84, '#93c5fd', 50, 44, 0, {
      shape: 'l',
      cut: { corner: 'br', width: 60, depth: 48 },
    }),
    piece('coffee', 'Coffee table', 44, 24, '#d6b38a', 84, 74),
    piece('dining', 'Dining table', 48, 48, '#d6b38a', 130, 118, 0, { shape: 'ellipse' }),
    piece('dc-n', 'Chair', 18, 18, '#fde68a', 130, 84, 180),
    piece('dc-s', 'Chair', 18, 18, '#fde68a', 130, 152, 0),
    piece('dc-w', 'Chair', 18, 18, '#fde68a', 96, 118, 90),
    piece('dc-e', 'Chair', 18, 18, '#fde68a', 164, 118, 270),
    piece('bed', 'Queen bed', 60, 80, '#c4b5fd', 282, 42),
    piece('ns-left', 'Nightstand', 30, 18, '#fcd34d', 233, 9),
    piece('ns-right', 'Nightstand', 30, 18, '#fcd34d', 331, 9),
    piece('dresser', 'Dresser', 54, 18, '#d8b4fe', 339, 126, 90),
    { id: 'armchair', label: 'Armchair', width: 34, depth: 34, color: '#fdba74' },
  ],
};

const SIDE = [55, 77, 99, 121, 143, 165];
const dining = (id: string, x: number, y: number, rotation: number) =>
  piece(id, 'Chair', 18, 20, '#fde68a', x, y, rotation);

/** A 12' × 18' dining room set for twelve: two tables end to end, a chair every ~22 in. */
export const SHOWCASE_HOLIDAY = {
  version: 4,
  name: 'Holiday dinner for 12',
  unit: 'in',
  settings: { unitSystem: 'ft-in' },
  rooms: [
    {
      id: 'dining',
      name: 'Dining room',
      outline: rect(0, 0, 144, 216),
      openings: [
        door('door-kitchen', 2, 20, 36),
        door('door-hall', 3, 8),
        window('window-1', 1, 70, 48),
      ],
    },
  ],
  items: [
    piece('table', 'Dining table', 72, 36, '#d6b38a', 72, 80, 90),
    piece('folding', 'Folding table', 60, 30, '#e7d3b5', 72, 146, 90),
    ...SIDE.map((y, i) => dining(`left-${i + 1}`, y < 121 + 1 ? 44 : 47, y, 90)),
    ...SIDE.map((y, i) => dining(`right-${i + 1}`, y < 121 + 1 ? 100 : 97, y, 270)),
    piece('buffet', 'Buffet', 60, 18, '#a8a29e', 72, 9),
  ],
};

export const SHOWCASE_PLANS: [string, typeof SHOWCASE_BEDROOM][] = [
  ['1-bedroom', SHOWCASE_BEDROOM],
  ['2-living-room', SHOWCASE_LIVING_ROOM as never],
  ['3-flat', SHOWCASE_FLAT as never],
  ['4-holiday-dinner', SHOWCASE_HOLIDAY as never],
];
