/**
 * Shared domain types. All lengths are stored internally in FEET; unit
 * systems only affect display, parsing and the share/export format.
 */

export type UnitSystem = 'ft-in' | 'ft' | 'in' | 'm' | 'cm';

export type DesignMode = 'room-setup' | 'furniture';

export type Wall = 'top' | 'right' | 'bottom' | 'left';

export type DoorType = 'swing-in' | 'swing-out' | 'sliding';

export type Hinge = 'left' | 'right';

/** Entity ids are numbers (Date.now()) in practice, but imported data may contain strings. */
export type Id = number | string;

export interface RoomDims {
  width: number;
  height: number;
}

export interface Door {
  id: Id;
  width: number;
  /** Offset from the start of the wall (left for top/bottom, top for left/right). */
  position: number;
  wall: Wall;
  hinge: Hinge;
  type: DoorType;
  /** Legacy (v2) field kept when importing old single-door configs. */
  open?: 'in' | 'out';
}

export interface RoomWindow {
  id: Id;
  width: number;
  position: number;
  wall: Wall;
}

export interface FurnitureItem {
  id: Id;
  label: string;
  /** Size along the x axis before rotation. */
  width: number;
  /** Size along the y axis before rotation (shown as "Depth"). */
  height: number;
  /** Top-left corner of the un-rotated box. */
  x: number;
  y: number;
  /** Degrees, clockwise (CSS convention). */
  rotation: number;
  /** Hex color, e.g. `#93c5fd`. */
  color: string;
  visible?: boolean;
  locked?: boolean;
}

/** The undoable document: everything drawn on the canvas. */
export interface Layout {
  roomDims: RoomDims;
  doors: Door[];
  windows: RoomWindow[];
  items: FurnitureItem[];
}

export interface ProjectData extends Layout {
  designMode?: DesignMode;
  unitSystem?: UnitSystem;
}

export interface Project {
  id: string;
  name: string;
  data: ProjectData;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
}

export type EntityType = 'item' | 'door' | 'window';

export interface Selection {
  id: Id;
  type: EntityType;
}

export type SaveStatus = 'unsaved' | 'saving' | 'saved';
