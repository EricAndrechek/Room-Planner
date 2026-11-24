import type { DesignMode } from '../types';

export {
  DOOR_TYPES,
  FIT_MIN_ZOOM,
  INITIAL_DOORS,
  INITIAL_ITEMS,
  INITIAL_ROOM,
  INITIAL_WINDOWS,
  MAX_ZOOM,
  MIN_ZOOM,
  UNIT_SYSTEMS,
  WALL_OPTIONS,
  isUnitSystem,
} from '../core/constants';

/** Canvas scale: CSS pixels per foot at 100% zoom. */
export const PIXELS_PER_UNIT = 40;

export const MAX_HISTORY = 50;

export const ZOOM_STEP = 0.25;

/** Viewport width (px) below which the mobile layout is used (Tailwind `md`). */
export const MOBILE_BREAKPOINT = 768;

export const DESIGN_MODES = {
  ROOM_SETUP: 'room-setup',
  FURNITURE: 'furniture',
} as const satisfies Record<string, DesignMode>;

export const isDesignMode = (value: unknown): value is DesignMode =>
  value === DESIGN_MODES.ROOM_SETUP || value === DESIGN_MODES.FURNITURE;
