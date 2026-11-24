/**
 * Shared app types. The document types live in `core/types.ts` (re-exported here); all lengths
 * are stored internally in FEET; unit systems only affect display, parsing and the share/export
 * format.
 */
import type { Id, Layout, UnitSystem } from './core/types';

export type {
  Door,
  DoorType,
  FurnitureItem,
  Hinge,
  Id,
  Layout,
  RoomDims,
  RoomWindow,
  SwingAngle,
  UnitSystem,
  Wall,
} from './core/types';

export type DesignMode = 'room-setup' | 'furniture';

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
