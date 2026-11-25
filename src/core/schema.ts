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

/** `schema` with a description, which the generated JSON Schema carries (for agents). */
const d = <T extends z.ZodMiniType>(schema: T, description: string): T => {
  (schema as z.ZodMiniType).register(z.globalRegistry, { description });
  return schema;
};

const Id = d(
  z.string().check(z.regex(/^[A-Za-z0-9_-]{1,40}$/)),
  'Unique within the plan. Letters, digits, "-" and "_".',
);
const Coord = z.number().check(z.minimum(-100000), z.maximum(100000));
const size = () => z.number().check(z.positive(), z.maximum(10000));
const Point = z.object({ x: Coord, y: Coord });
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

export const Opening = z.looseObject({
  id: Id,
  kind: z.enum(OPENING_KINDS),
  wall: d(z.int().check(z.minimum(0)), 'Wall index. Wall i runs from outline[i] to outline[i+1].'),
  offset: d(
    z.number().check(z.minimum(0)),
    'Distance along the wall from its start corner to the near edge of the opening.',
  ),
  width: d(size(), 'Width along the wall.'),
  type: d(z._default(z.enum(DOOR_TYPES), 'swing-in'), 'Doors only.'),
  hinge: d(
    z._default(z.enum(HINGES), 'start'),
    'Doors only. Seen from inside the room facing the wall, "start" is on the left.',
  ),
  swingAngle: z.optional(z.union([z.literal(90), z.literal(180)])),
});

export const Room = z.looseObject({
  id: Id,
  name: z.optional(z.string().check(z.maxLength(80))),
  outline: d(
    z.array(Point).check(z.minLength(3), z.maxLength(64)),
    'Interior corners in floor coordinates, clockwise as drawn (y grows downward). ' +
      'A rectangle is 4 points starting at its top-left corner; its walls are then ' +
      '0 = top, 1 = right, 2 = bottom, 3 = left.',
  ),
  openings: z._default(z.array(Opening).check(z.maxLength(64)), []),
});

export const Item = z.looseObject({
  id: Id,
  label: z.string().check(z.maxLength(80)),
  color: z._default(Color, '#93c5fd'),
  shape: z._default(z.enum(SHAPES), 'rect'),
  width: d(size(), 'Bounding-box size along x before rotation.'),
  depth: d(size(), 'Bounding-box size along y before rotation.'),
  cut: d(
    z.optional(z.object({ corner: z.enum(CORNERS), width: size(), depth: size() })),
    'Shape "l" only: the rectangle removed from one corner of the bounding box.',
  ),
  placement: d(
    z.optional(
      z.object({
        x: Coord,
        y: Coord,
        rotation: z._default(z.number().check(z.minimum(0), z.lt(360)), 0),
      }),
    ),
    'Centre of the piece in floor coordinates and its clockwise rotation in degrees. ' +
      'Omit it to set the piece aside: kept in the plan, not on the floor.',
  ),
  locked: z.optional(z.boolean()),
  hidden: z.optional(z.boolean()),
  notes: z.optional(z.string().check(z.maxLength(500))),
});

export const Plan = z.looseObject({
  version: z.literal(PLAN_VERSION),
  name: z._default(z.string().check(z.maxLength(100)), 'Untitled'),
  unit: d(z.enum(UNITS), 'Unit of every length in this document.'),
  rooms: z.array(Room).check(z.minLength(1), z.maxLength(50)),
  items: z._default(z.array(Item).check(z.maxLength(500)), []),
  settings: z.optional(z.looseObject({ unitSystem: z.optional(z.enum(UNIT_SYSTEMS)) })),
});
export type Plan = z.infer<typeof Plan>;
/** A plan as written by hand or by an agent: fields with defaults may be left out. */
export type PlanInput = z.input<typeof Plan>;
export type Room = z.infer<typeof Room>;
export type Opening = z.infer<typeof Opening>;
export type Item = z.infer<typeof Item>;
export type Unit = (typeof UNITS)[number];
