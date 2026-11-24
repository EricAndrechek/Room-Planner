/**
 * Shared app types. The document is the v4 `Plan` (core/schema.ts), held and stored in FEET; unit
 * systems only affect display, parsing and the share/export format.
 */
import type { Plan } from './core/schema';

export type { Item, Opening, Plan, Room } from './core/schema';
export type { RoomDims, UnitSystem, Wall } from './core/types';

/** Ids of rooms, openings and pieces (one namespace per plan). */
export type Id = string;

export type DesignMode = 'room-setup' | 'furniture';

/**
 * A saved plan ("My Floor Plans"), as stored in `room-planner-plans`: the plan itself (whose `name`
 * is the plan's name) and the editor state that goes with it.
 */
export interface Project {
  id: string;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
  ui?: { designMode?: DesignMode };
  plan: Plan;
}

/**
 * A saved plan this build cannot open (made by a newer Room Planner): listed, never opened, and
 * written back exactly as it was read.
 */
export interface LockedProject {
  id: string | null;
  name: string;
  version: number;
  updatedAt: string | null;
}

export type EntityType = 'item' | 'door' | 'window';

export interface Selection {
  id: Id;
  type: EntityType;
}

export type SaveStatus = 'unsaved' | 'saving' | 'saved';
