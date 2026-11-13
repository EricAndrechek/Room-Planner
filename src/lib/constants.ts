import type {
  DesignMode,
  Door,
  DoorType,
  FurnitureItem,
  RoomDims,
  RoomWindow,
  UnitSystem,
  Wall,
} from '../types';

/** Canvas scale: CSS pixels per foot at 100% zoom. */
export const PIXELS_PER_UNIT = 40;

export const MAX_HISTORY = 50;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 0.25;

/** Viewport width (px) below which the mobile layout is used (Tailwind `md`). */
export const MOBILE_BREAKPOINT = 768;

export const DESIGN_MODES = {
  ROOM_SETUP: 'room-setup',
  FURNITURE: 'furniture',
} as const satisfies Record<string, DesignMode>;

export const INITIAL_ROOM: RoomDims = { width: 12, height: 12 };

export const INITIAL_DOORS: Door[] = [
  { id: 1, width: 3, position: 6, wall: 'bottom', hinge: 'left', type: 'swing-in' },
];

export const INITIAL_WINDOWS: RoomWindow[] = [{ id: 1, width: 4, position: 4, wall: 'top' }];

/**
 * Starter layout for first-time visitors: a 12' x 12' bedroom with the bed
 * headboard under the window, clear of the door swing, nothing overlapping and
 * everything inside the room (asserted in defaults.test.ts).
 */
export const INITIAL_ITEMS: FurnitureItem[] = [
  {
    id: 1,
    label: 'Bed',
    width: 5,
    height: 6.5,
    x: 3.5,
    y: 0,
    rotation: 0,
    color: '#93c5fd',
    visible: true,
  },
  {
    id: 2,
    label: 'Nightstand',
    width: 1.5,
    height: 1.5,
    x: 2,
    y: 0,
    rotation: 0,
    color: '#fcd34d',
    visible: true,
  },
  {
    id: 3,
    label: 'Nightstand',
    width: 1.5,
    height: 1.5,
    x: 8.5,
    y: 0,
    rotation: 0,
    color: '#fcd34d',
    visible: true,
  },
  {
    id: 4,
    label: 'Dresser',
    width: 1.5,
    height: 4,
    x: 0,
    y: 7,
    rotation: 0,
    color: '#d8b4fe',
    visible: true,
  },
  {
    id: 5,
    label: 'Desk',
    width: 2,
    height: 4,
    x: 10,
    y: 6.5,
    rotation: 0,
    color: '#6ee7b7',
    visible: true,
  },
  {
    id: 6,
    label: 'Chair',
    width: 1.5,
    height: 1.5,
    x: 8.3,
    y: 7.1,
    rotation: 0,
    color: '#fdba74',
    visible: true,
  },
];

export const WALL_OPTIONS: Wall[] = ['top', 'right', 'bottom', 'left'];

export const DOOR_TYPES: { value: DoorType; label: string }[] = [
  { value: 'swing-in', label: 'Swing In' },
  { value: 'swing-out', label: 'Swing Out' },
  { value: 'sliding', label: 'Sliding' },
];

export const UNIT_SYSTEMS: { value: UnitSystem; label: string }[] = [
  { value: 'ft-in', label: 'Feet & Inches (6\'3")' },
  { value: 'ft', label: 'Decimal Feet (6.25 ft)' },
  { value: 'in', label: 'Inches (75 in)' },
  { value: 'm', label: 'Meters (1.9 m)' },
  { value: 'cm', label: 'Centimeters (190 cm)' },
];

export const isUnitSystem = (value: unknown): value is UnitSystem =>
  UNIT_SYSTEMS.some((u) => u.value === value);

export const isDesignMode = (value: unknown): value is DesignMode =>
  value === DESIGN_MODES.ROOM_SETUP || value === DESIGN_MODES.FURNITURE;
