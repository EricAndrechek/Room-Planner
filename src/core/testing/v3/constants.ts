/**
 * Test reference, frozen: the v3 app's starter room (core/constants.ts before the app held plans).
 * Never edited: tests compare today's plans with what the v3 code read.
 */
import type { Door, FurnitureItem, RoomDims, RoomWindow, Wall } from './types';

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

export const DOOR_TYPE_VALUES = [
  'swing-in',
  'swing-out',
  'double-in',
  'double-out',
  'sliding',
  'pocket',
  'bifold',
  'opening',
] as const;
