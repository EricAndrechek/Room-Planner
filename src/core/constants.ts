/**
 * Enumerations (walls, door types, unit systems) with their labels, plus the zoom limits the
 * viewport helpers in `geometry` clamp to. App-only constants (canvas scale, history depth,
 * breakpoints, design modes) are in `lib/constants.ts`; the starter room is `starterPlan` in
 * `lib/plans.ts`.
 */
import type { DoorType } from './geometry/doors';
import type { UnitSystem, Wall } from './types';

/** Furthest the zoom buttons and pinch go out; "fit" may go further for a very large room. */
export const MIN_ZOOM = 0.1;
/** Floor for fitting the whole room in view (a 500 ft room on a phone needs about 0.017). */
export const FIT_MIN_ZOOM = 0.01;
export const MAX_ZOOM = 3;

export const WALL_OPTIONS: Wall[] = ['top', 'right', 'bottom', 'left'];

/** Door types, in the order the door card lists them, with their labels. */
export const DOOR_TYPES: { value: DoorType; label: string }[] = [
  { value: 'swing-in', label: 'Swing in' },
  { value: 'swing-out', label: 'Swing out' },
  { value: 'double-in', label: 'Double (French), in' },
  { value: 'double-out', label: 'Double (French), out' },
  { value: 'sliding', label: 'Sliding (bypass / barn)' },
  { value: 'pocket', label: 'Pocket (slides into wall)' },
  { value: 'bifold', label: 'Bi-fold' },
  { value: 'opening', label: 'Opening (no door)' },
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
