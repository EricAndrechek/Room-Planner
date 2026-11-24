/**
 * Example plans shown on the guide pages. Each one is an ordinary planner plan (one rectangular
 * room from (0,0), lengths in feet, `y` growing towards the bottom wall), so the page draws it with
 * the export pipeline and links to it with a real share link. They are written the way the
 * planner's fields show a room: doors and windows on a named wall at a position from its left (or
 * top) end, pieces by the top-left corner of their box; `examplePlan` turns that into the plan.
 * examples.test.ts checks that none of them has a warning the planner would show and that the
 * clearances the captions quote are true.
 */
import type { Item, Opening, Plan, UnitSystem, Wall } from '../../types';

export interface Example {
  id: string;
  /** Guide slug this example belongs to. */
  guide: string;
  /** Plan name (the drawing's title and the name of the plan the link creates). */
  name: string;
  /** What to notice, one sentence each; shown under the drawing. */
  notes: string[];
  unitSystem: UnitSystem;
  plan: Plan;
}

/** Inches -> feet (the model's unit). */
const i = (inches: number): number => inches / 12;

const C = {
  blue: '#93c5fd',
  green: '#6ee7b7',
  yellow: '#fcd34d',
  red: '#fecaca',
  indigo: '#a5b4fc',
  cyan: '#67e8f9',
  purple: '#d8b4fe',
  orange: '#fdba74',
  lime: '#bef264',
  pink: '#f9a8d4',
};

interface PieceSpec {
  label: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  color: string;
}
interface OpeningSpec {
  wall: Wall;
  position: number;
  width: number;
  hinge?: 'left' | 'right';
  type?: Opening['type'];
}
interface RoomSpec {
  roomDims: { width: number; height: number };
  doors: OpeningSpec[];
  windows: OpeningSpec[];
  items: PieceSpec[];
}

const item = (
  label: string,
  x: number,
  y: number,
  width: number,
  depth: number,
  color: string,
): PieceSpec => ({ label, x, y, width, depth, color });

const door = (
  wall: Wall,
  position: number,
  width: number,
  hinge: 'left' | 'right' = 'left',
  type: Opening['type'] = 'swing-in',
): OpeningSpec => ({ wall, position, width, hinge, type });

const win = (wall: Wall, position: number, width: number): OpeningSpec => ({
  wall,
  position,
  width,
});

const WALLS: Wall[] = ['top', 'right', 'bottom', 'left'];

/**
 * The plan of a room written as above. A clockwise outline runs right to left along the bottom
 * wall and bottom to top along the left one, so there the offset is measured from the other end
 * and the hinge side swaps (as the 3 -> 4 migration maps them).
 */
const examplePlan = (name: string, unitSystem: UnitSystem, spec: RoomSpec): Plan => {
  const { width: w, height: h } = spec.roomDims;
  const counters = { door: 0, window: 0 };
  const opening = (o: OpeningSpec, kind: 'door' | 'window'): Opening => {
    const wall = WALLS.indexOf(o.wall);
    const len = wall % 2 === 0 ? w : h;
    const reversed = wall >= 2;
    const width = Math.min(o.width, len);
    const position = Math.min(Math.max(o.position, 0), Math.max(0, len - width));
    return {
      id: `${kind}-${++counters[kind]}`,
      kind,
      wall,
      offset: reversed ? Math.max(0, len - position - width) : position,
      width,
      type: o.type ?? 'swing-in',
      hinge: kind === 'door' && (o.hinge === 'right') !== reversed ? 'end' : 'start',
    };
  };
  const piece = (p: PieceSpec, n: number): Item => ({
    id: `item-${n + 1}`,
    label: p.label,
    color: p.color,
    shape: 'rect',
    width: p.width,
    depth: p.depth,
    placement: { x: p.x + p.width / 2, y: p.y + p.depth / 2, rotation: 0 },
  });
  return {
    version: 4,
    name,
    unit: 'ft',
    rooms: [
      {
        id: 'room-1',
        outline: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ],
        openings: [
          ...spec.doors.map((d) => opening(d, 'door')),
          ...spec.windows.map((o) => opening(o, 'window')),
        ],
      },
    ],
    items: spec.items.map(piece),
    settings: { unitSystem },
  };
};

type ExampleSpec = Omit<Example, 'plan'> & { room: RoomSpec };

const SPECS: ExampleSpec[] = [
  // --- Bedroom ---------------------------------------------------------------------------
  {
    id: 'queen-bedroom-10x12',
    guide: 'bedroom-layout',
    name: 'Queen bed in a 10 × 12 ft bedroom',
    notes: [
      'The headboard is centered on the wall opposite the door, leaving 30 in (76 cm) on each side of the bed.',
      'The dresser faces the foot of the bed with 46 in (117 cm) in between, enough to open drawers and walk past.',
      'The door swings into the corner, clear of every piece.',
    ],
    unitSystem: 'ft-in',
    room: {
      roomDims: { width: 10, height: 12 },
      doors: [door('bottom', 7, i(32), 'right')],
      windows: [win('top', 3, 4)],
      items: [
        item('Queen bed', 2.5, 0, i(60), i(80), C.blue),
        item('Nightstand', 2.5 - i(20), 0, i(20), i(16), C.yellow),
        item('Nightstand', 7.5, 0, i(20), i(16), C.yellow),
        item('Dresser', 0.5, 10.5, i(60), i(18), C.purple),
      ],
    },
  },
  {
    id: 'king-bedroom-13x14',
    guide: 'bedroom-layout',
    name: 'King bed in a 13 × 14 ft primary bedroom',
    notes: [
      'A king bed with 24 in (61 cm) nightstands still leaves 40 in (102 cm) between each side of the bed and the wall.',
      'A bench at the foot of the bed and a long dresser on the opposite wall keep 50 in (127 cm) of open floor between them.',
    ],
    unitSystem: 'ft-in',
    room: {
      roomDims: { width: 13, height: 14 },
      doors: [door('bottom', 9.5, i(32), 'right')],
      windows: [win('left', 4, 4), win('right', 4, 4)],
      items: [
        item('King bed', 13 / 2 - i(38), 0, i(76), i(80), C.blue),
        item('Nightstand', 13 / 2 - i(38) - 2, 0, i(24), i(18), C.yellow),
        item('Nightstand', 13 / 2 + i(38), 0, i(24), i(18), C.yellow),
        item('Bench', 13 / 2 - i(27), i(80), i(54), i(18), C.pink),
        item('Dresser', 1, 14 - i(20), i(66), i(20), C.purple),
      ],
    },
  },
  {
    id: 'twin-beds-12x12',
    guide: 'bedroom-layout',
    name: 'Two twin beds in a 12 × 12 ft shared bedroom',
    notes: [
      'Each bed sits against a side wall, freeing 68 in (173 cm) of floor between them for play or dressing.',
      'A shared nightstand goes between the headboards, under the window.',
    ],
    unitSystem: 'ft-in',
    room: {
      roomDims: { width: 12, height: 12 },
      doors: [door('bottom', 8, i(32), 'right')],
      windows: [win('top', 4.5, 3)],
      items: [
        item('Twin bed', 0, 0, i(38), i(75), C.blue),
        item('Twin bed', 12 - i(38), 0, i(38), i(75), C.green),
        item('Nightstand', 5, 0, i(24), i(16), C.yellow),
        item('Dresser', 0.5, 10.5, i(48), i(18), C.purple),
      ],
    },
  },

  // --- Living room -----------------------------------------------------------------------
  {
    id: 'living-tv-13x15',
    guide: 'living-room-layout',
    name: 'Sofa facing a TV wall in a 13 × 15 ft living room',
    notes: [
      'The coffee table is 15 in (38 cm) from the sofa: close enough to reach, far enough for knees.',
      'Floating the sofa off the back wall leaves a 30 in (76 cm) walkway behind it, from the door to the rest of the room.',
      'The armchair is 15 in (38 cm) from the end of the coffee table, so both seats can use it.',
    ],
    unitSystem: 'ft-in',
    room: {
      roomDims: { width: 13, height: 15 },
      doors: [door('left', 11.5, 3, 'right')],
      windows: [win('right', 4, 5)],
      items: [
        item('TV console', 6.75 - 2.5, 0, i(60), i(18), C.cyan),
        item('Sofa', 3.25, 9.5, i(84), i(36), C.indigo),
        item('Coffee table', 6.75 - 2, 9.5 - i(15) - 2, i(48), i(24), C.yellow),
        item('Armchair', 6.75 + 2 + i(15), 5.5, i(32), i(32), C.pink),
      ],
    },
  },
  {
    id: 'living-l-14x16',
    guide: 'living-room-layout',
    name: 'Sofa and loveseat in an L, 14 × 16 ft living room',
    notes: [
      'The sofa and loveseat meet at a corner around the coffee table, each 15 in (38 cm) from it.',
      'The TV is on the wall the sofa faces, about 9 ft 6 in (2.9 m) away.',
      'The wide opening into the room stays clear: no piece sits in the doorway.',
    ],
    unitSystem: 'ft-in',
    room: {
      roomDims: { width: 14, height: 16 },
      doors: [door('bottom', 9, 4, 'left', 'opening')],
      windows: [win('top', 8, 4)],
      items: [
        item('Sofa', 0, 4, i(36), i(84), C.indigo),
        item('Loveseat', 3 + i(15), 11, i(60), i(36), C.purple),
        item('Coffee table', 3 + i(15), 11 - i(15) - 2, i(48), i(24), C.yellow),
        item('TV console', 14 - i(18), 4.5, i(18), i(72), C.cyan),
        item('Bookcase', 4, 0, i(36), i(12), C.lime),
      ],
    },
  },

  // --- Studio & dorm ---------------------------------------------------------------------
  {
    id: 'studio-15x20',
    guide: 'studio-and-dorm-layout',
    name: 'Studio apartment, 15 × 20 ft',
    notes: [
      'Three zones in one room: the bed in a corner, a sofa facing the TV, and a table for two by the kitchen.',
      'The sofa’s back divides the living area from the dining area, with 32 in (81 cm) behind it to walk through.',
      'A pocket door to the bathroom needs no swing space, so the dining chairs can sit close to it.',
    ],
    unitSystem: 'ft-in',
    room: {
      roomDims: { width: 15, height: 20 },
      doors: [door('bottom', 1, 3, 'left'), door('right', 11, i(30), 'left', 'pocket')],
      windows: [win('top', 1, 3), win('right', 3, 4)],
      items: [
        item('Full bed', 0, 0, i(54), i(75), C.blue),
        item('Nightstand', i(54), 0, i(18), i(16), C.yellow),
        item('Dresser', 0, 7.25, i(18), i(36), C.purple),
        item('TV console', 8.5, 0, i(48), i(16), C.cyan),
        item('Coffee table', 9, 6.5 - i(15) - i(20), i(36), i(20), C.yellow),
        item('Sofa', 7.5, 6.5, i(72), i(34), C.indigo),
        item('Table', 5.5, 12, i(30), i(30), C.red),
        item('Chair', 5.5 - i(21), 12.5, i(18), i(18), C.orange),
        item('Chair', 8 + i(3), 12.5, i(18), i(18), C.orange),
        item('Kitchen counter', 7, 20 - i(25), i(96), i(25), C.lime),
      ],
    },
  },
  {
    id: 'dorm-double-12x15',
    guide: 'studio-and-dorm-layout',
    name: 'Dorm double, 12 × 15 ft',
    notes: [
      'Twin XL beds along the side walls, with both dressers between the headboards.',
      'Each desk faces a side wall at the foot of a bed, and the chairs leave 54 in (137 cm) of floor between them.',
      'The door swings into the middle of the room, which stays clear.',
    ],
    unitSystem: 'ft-in',
    room: {
      roomDims: { width: 12, height: 15 },
      doors: [door('bottom', 6 - i(16), i(32), 'left')],
      windows: [win('top', 4, 4)],
      items: [
        item('Twin XL bed', 0, 0, i(38), i(80), C.blue),
        item('Twin XL bed', 12 - i(38), 0, i(38), i(80), C.green),
        item('Dresser', 3.5, 0, i(30), i(20), C.purple),
        item('Dresser', 6, 0, i(30), i(20), C.purple),
        item('Desk', 0, 7.25, i(24), i(42), C.yellow),
        item('Desk chair', 2 + i(3), 8.25, i(18), i(18), C.orange),
        item('Desk', 10, 7.25, i(24), i(42), C.yellow),
        item('Desk chair', 10 - i(3) - 1.5, 8.25, i(18), i(18), C.orange),
      ],
    },
  },

  // --- Home office -----------------------------------------------------------------------
  {
    id: 'office-9x10',
    guide: 'home-office-layout',
    name: 'Home office in a 9 × 10 ft spare room',
    notes: [
      'The desk is perpendicular to the window, so daylight comes from the side instead of behind the screen or into your eyes.',
      'There is 36 in (91 cm) or more behind the desk for the chair to roll back.',
      'A reading chair fills the corner by the window, clear of the door swing.',
    ],
    unitSystem: 'ft-in',
    room: {
      roomDims: { width: 9, height: 10 },
      doors: [door('bottom', 5.5, i(32), 'right')],
      windows: [win('left', 3, 4)],
      items: [
        item('Desk', 2, 0, i(60), i(30), C.green),
        item('Desk chair', 3.5, 2.5, i(24), i(24), C.orange),
        item('File cabinet', 7.25, 0, i(15), i(25), C.purple),
        item('Bookcase', 8, 3.5, i(12), i(36), C.lime),
        item('Reading chair', 0.5, 10 - 0.5 - i(32), i(32), i(32), C.pink),
      ],
    },
  },
  {
    id: 'office-guest-11x12',
    guide: 'home-office-layout',
    name: 'L-shaped desk and sofa bed, 11 × 12 ft office and guest room',
    notes: [
      'Two desks meet in a corner to make an L: one for the computer, one for paperwork.',
      'The sofa bed sits on the opposite wall, so guests and the desk chair do not compete for space.',
    ],
    unitSystem: 'ft-in',
    room: {
      roomDims: { width: 11, height: 12 },
      doors: [door('bottom', 5, i(32), 'right')],
      windows: [win('top', 6, 4)],
      items: [
        item('Desk', 0, 0, i(60), i(30), C.green),
        item('Desk (return)', 0, i(30), i(24), i(48), C.green),
        item('Desk chair', 2.25, 2.75, i(24), i(24), C.orange),
        item('Sofa bed', 11 - i(36), 3, i(36), i(80), C.indigo),
        item('Bookcase', 1, 11, i(36), i(12), C.lime),
      ],
    },
  },
];

export const EXAMPLES: Example[] = SPECS.map(({ room, ...e }) => ({
  ...e,
  plan: examplePlan(e.name, e.unitSystem, room),
}));

export const examplesFor = (guide: string): Example[] => EXAMPLES.filter((e) => e.guide === guide);
