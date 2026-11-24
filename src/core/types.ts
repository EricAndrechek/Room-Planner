/**
 * Small shared types of core outside the plan document (whose types are inferred from the schema
 * in schema.ts): display unit systems, and the four walls of a rectangular room with its size,
 * which the rectangle helpers and the editor use.
 */

export type UnitSystem = 'ft-in' | 'ft' | 'in' | 'm' | 'cm';

/** The walls of a rectangular room, by name (walls 0 to 3 of its outline). */
export type Wall = 'top' | 'right' | 'bottom' | 'left';

/** A rectangular room's interior size, in feet: `width` along x, `height` (its length) along y. */
export interface RoomDims {
  width: number;
  height: number;
}

/** An entity id: the plan's ids are strings; snapping takes any stable key. */
export type Id = number | string;
