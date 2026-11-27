/**
 * The plan document, version 4: the single source of truth for its shape (docs/design/plan-format.md,
 * section 3). TypeScript types are inferred from it. Written with the `zod/mini` API only: the
 * classic API costs three times as much in the bundle (an ESLint rule forbids importing it).
 *
 * Rules a JSON Schema cannot express (unique ids, openings that fit their wall, simple outlines)
 * are checked by `checkIntegrity` in load.ts.
 */
import * as z from 'zod/mini';

export const PLAN_VERSION = 4;

/**
 * `schema` with a description, which the generated JSON Schema carries (for agents). Every
 * property has one (worker/mcp.test.ts walks the tools' schemas): a short field-level fact. The
 * prose (coordinates, wall numbering, workflow) is in the tool text, worker/descriptions.ts.
 */
const d = <T extends z.ZodMiniType>(schema: T, description: string): T => {
  (schema as z.ZodMiniType).register(z.globalRegistry, { description });
  return schema;
};

const Id = d(z.string().check(z.regex(/^[A-Za-z0-9_-]{1,40}$/)), 'Unique in the plan.');
const coord = () => z.number().check(z.minimum(-100000), z.maximum(100000));
const size = () => z.number().check(z.positive(), z.maximum(10000));
const Point = z.object({
  x: d(coord(), 'Floor x (grows right).'),
  y: d(coord(), 'Floor y (grows DOWN).'),
});
const Color = z.string().check(z.regex(/^#[0-9a-fA-F]{6}$/));

export const OPENING_KINDS = ['door', 'window'] as const;
export const HINGES = ['start', 'end'] as const;
export const SHAPES = ['rect', 'l', 'ellipse'] as const;
export const CORNERS = ['tl', 'tr', 'br', 'bl'] as const;
export const UNITS = ['ft', 'in', 'm', 'cm'] as const;
export const UNIT_SYSTEMS = ['ft-in', 'ft', 'in', 'm', 'cm'] as const;

export const DOOR_TYPES = [
  'swing-in',
  'swing-out',
  'double-in',
  'double-out',
  'sliding',
  'pocket',
  'bifold',
  'opening',
] as const;

/**
 * Which end of its wall an opening's offset is measured from, as an agent may write it. Input
 * only: `loadPlan` measures every offset from the start corner and drops the field.
 */
export const OFFSET_FROM = ['start', 'end', 'left', 'right', 'top', 'bottom'] as const;

export const Opening = z.looseObject({
  id: Id,
  kind: d(z.enum(OPENING_KINDS), 'Door or window.'),
  wall: d(z.int().check(z.minimum(0)), 'Wall i runs from outline[i] to outline[i+1].'),
  offset: d(
    z.number().check(z.minimum(0)),
    "From the wall's start corner to the opening's near edge.",
  ),
  width: d(size(), 'Width along the wall.'),
  from: d(
    z.optional(z.enum(OFFSET_FROM)),
    'Input only: the end offset is measured from. Default "start".',
  ),
  type: d(
    z._default(z.enum(DOOR_TYPES), 'swing-in'),
    'Doors only. "swing-in": into the room that lists it.',
  ),
  hinge: d(
    z._default(z.enum(HINGES), 'start'),
    'Doors only. "start": on the left, from inside facing the wall.',
  ),
  swingAngle: d(
    z.optional(z.union([z.literal(90), z.literal(180)])),
    'Doors only: how far it opens, degrees.',
  ),
});

export const Room = z.looseObject({
  id: Id,
  name: d(z.optional(z.string().check(z.maxLength(80))), 'E.g. "Bedroom".'),
  outline: d(
    z.array(Point).check(z.minLength(3), z.maxLength(64)),
    'Interior corners, clockwise. Rectangle from top-left: walls 0 top, 1 right, 2 bottom, 3 left.',
  ),
  openings: d(z._default(z.array(Opening).check(z.maxLength(64)), []), 'Doors and windows.'),
});

export const Item = z.looseObject({
  id: Id,
  label: d(z.string().check(z.maxLength(80)), 'E.g. "Queen bed".'),
  color: d(z._default(Color, '#93c5fd'), 'Fill, "#rrggbb".'),
  shape: d(z._default(z.enum(SHAPES), 'rect'), '"ellipse": round or oval; "l" needs cut.'),
  width: d(size(), 'Along x, before rotation.'),
  depth: d(size(), 'Along y, before rotation.'),
  cut: d(
    z.optional(
      z.object({
        corner: d(z.enum(CORNERS), 'Corner removed.'),
        width: d(size(), 'Removed part, along x.'),
        depth: d(size(), 'Removed part, along y.'),
      }),
    ),
    'Shape "l" only: the rectangle removed from one corner.',
  ),
  placement: d(
    z.optional(
      z.object({
        x: d(coord(), 'Floor x of the CENTRE.'),
        y: d(coord(), 'Floor y of the CENTRE.'),
        rotation: d(z._default(z.number().check(z.minimum(0), z.lt(360)), 0), 'Clockwise degrees.'),
      }),
    ),
    'Omit to set the piece aside: off the floor, not checked.',
  ),
  locked: d(z.optional(z.boolean()), 'Not movable in the planner.'),
  hidden: d(z.optional(z.boolean()), 'Not drawn or checked.'),
  notes: d(z.optional(z.string().check(z.maxLength(500))), "The user's notes."),
});

export const Plan = z.looseObject({
  version: d(z.literal(PLAN_VERSION), 'Always 4.'),
  name: d(z._default(z.string().check(z.maxLength(100)), 'Untitled'), 'Plan name.'),
  unit: d(z.enum(UNITS), 'Unit of every length.'),
  rooms: d(
    z.array(Room).check(z.minLength(1), z.maxLength(50)),
    'One floor: rooms touch to share a wall, never overlap.',
  ),
  items: d(z._default(z.array(Item).check(z.maxLength(500)), []), 'Furniture.'),
  settings: d(
    z.optional(
      z.looseObject({
        unitSystem: d(
          z.optional(z.enum(UNIT_SYSTEMS)),
          'Display unit. Default: unit ("ft" as "ft-in").',
        ),
      }),
    ),
    'Display preferences.',
  ),
});
export type Plan = z.infer<typeof Plan>;
/** A plan as written by hand or by an agent: fields with defaults may be left out. */
export type PlanInput = z.input<typeof Plan>;
export type Room = z.infer<typeof Room>;
export type Opening = z.infer<typeof Opening>;
export type Item = z.infer<typeof Item>;
export type Unit = (typeof UNITS)[number];
