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

export const INITIAL_ITEMS: FurnitureItem[] = [
  { id: 1, label: 'Bed', width: 6, height: 4, x: 2, y: 2, rotation: 0, color: '#93c5fd', visible: true },
  { id: 2, label: 'Desk', width: 4, height: 2, x: 9, y: 2, rotation: 0, color: '#6ee7b7', visible: true },
  { id: 3, label: 'Wardrobe', width: 3, height: 2, x: 2, y: 8, rotation: 0, color: '#fcd34d', visible: true },
  { id: 4, label: 'Rug', width: 5, height: 8, x: 6, y: 5, rotation: 0, color: '#fecaca', visible: true },
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
