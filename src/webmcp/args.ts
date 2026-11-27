/**
 * The WebMCP tools' arguments (docs/design/plan-format.md, section 8), built from the plan's own
 * schema (core/schema.ts) so a field means and checks the same thing in a tool call as in a plan
 * document. Lengths are in the plan's display unit, as `get_plan` returns them.
 *
 * Objects are strict: a key the tool does not take is an error that names it (usually a typo).
 * The update tools take every field optional, with no defaults (a default would overwrite the
 * piece's current value). `schemas.json` is generated from these by schemas.test.ts, so the
 * browser never runs Zod's JSON Schema generator.
 */
import * as z from 'zod/mini';
import { Item, Opening, Plan } from '../core/schema';

/** `schema` with a description for the generated JSON Schema. */
const d = <T extends z.ZodMiniType>(schema: T, description: string): T => {
  (schema as z.ZodMiniType).register(z.globalRegistry, { description });
  return schema;
};

type Unwrap<T> =
  T extends z.ZodMiniDefault<infer U>
    ? Unwrap<U>
    : T extends z.ZodMiniOptional<infer U>
      ? Unwrap<U>
      : T;

/** A field of the plan's schema without its default and not optional. */
const required = <T extends z.ZodMiniType>(schema: T): Unwrap<T> => {
  let s: z.ZodMiniType = schema;
  for (;;) {
    const def = s._zod.def as { type: string; innerType?: z.ZodMiniType };
    if ((def.type === 'default' || def.type === 'optional') && def.innerType) s = def.innerType;
    else return s as Unwrap<T>;
  }
};

/** A field of the plan's schema, optional and without its default, with its description. */
const optional = <T extends z.ZodMiniType>(schema: T) => {
  const opt = z.optional(required(schema) as Unwrap<T> & z.ZodMiniType);
  const described = z.globalRegistry.get(schema);
  if (described?.description) d(opt, described.description);
  return opt;
};

const I = Item.shape;
const O = Opening.shape;

const Id = d(z.string().check(z.minLength(1), z.maxLength(40)), 'An id from get_plan.');
const RoomId = d(
  z.string().check(z.minLength(1), z.maxLength(40)),
  'A room id from get_plan. Default: the first room.',
);
// Factories: a schema object carries one description, so each described use needs its own.
const coord = () => z.number().check(z.minimum(-100000), z.maximum(100000));
const size = () => z.number().check(z.positive(), z.maximum(10000));
const Rotation = d(
  z.number().check(z.minimum(-3600), z.maximum(3600)),
  'Clockwise degrees (kept between 0 and 360).',
);

const Placement = d(
  z.strictObject({ x: coord(), y: coord(), rotation: z.optional(Rotation) }),
  'Centre of the piece in floor coordinates (x right, y down) and its clockwise rotation.',
);
const PlacementPatch = d(
  z.strictObject({
    x: z.optional(coord()),
    y: z.optional(coord()),
    rotation: z.optional(Rotation),
  }),
  'Move or turn the piece: its centre (x right, y down) and clockwise rotation. Each part optional.',
);

/** The fields of a piece the tools take (not its id or placement). */
const itemFields = {
  label: I.label,
  color: I.color,
  shape: I.shape,
  width: I.width,
  depth: I.depth,
  cut: I.cut,
  locked: I.locked,
  hidden: I.hidden,
  notes: I.notes,
} as const;

export const NoArgs = z.strictObject({});

export const CheckLayoutArgs = z.strictObject({
  minClearance: z.optional(
    d(
      z.number().check(z.minimum(0), z.maximum(10000)),
      'Gaps from 6 in (15 cm) up to this are reported as tight_clearance. Default 24 in (61 cm).',
    ),
  ),
});

export const AddItemArgs = z.strictObject({
  label: required(itemFields.label),
  width: required(itemFields.width),
  depth: required(itemFields.depth),
  color: optional(itemFields.color),
  shape: optional(itemFields.shape),
  cut: optional(itemFields.cut),
  locked: optional(itemFields.locked),
  hidden: optional(itemFields.hidden),
  notes: optional(itemFields.notes),
  placement: z.optional(Placement),
  place: z.optional(
    d(
      z.boolean(),
      'Without a placement: true puts the piece in a free spot of the room (roomId); false or left out sets it aside.',
    ),
  ),
  roomId: z.optional(RoomId),
});

export const UpdateItemArgs = z.strictObject({
  id: Id,
  label: optional(itemFields.label),
  width: optional(itemFields.width),
  depth: optional(itemFields.depth),
  color: optional(itemFields.color),
  shape: optional(itemFields.shape),
  cut: optional(itemFields.cut),
  locked: optional(itemFields.locked),
  hidden: optional(itemFields.hidden),
  notes: optional(itemFields.notes),
  placement: z.optional(PlacementPatch),
});

export const IdArgs = z.strictObject({ id: Id });

export const PlaceItemArgs = z.strictObject({
  id: Id,
  at: z.optional(
    d(
      z.strictObject({ x: coord(), y: coord() }),
      'Where its centre goes (floor coordinates); it is moved the least amount that keeps it inside the room there. Left out: a free spot in roomId.',
    ),
  ),
  roomId: z.optional(RoomId),
});

const openingFields = {
  wall: optional(O.wall),
  offset: optional(O.offset),
  width: optional(O.width),
  type: optional(O.type),
  hinge: optional(O.hinge),
  swingAngle: z.optional(
    d(z.union([z.literal(90), z.literal(180)]), 'Doors only: how far it opens. Default 90.'),
  ),
};

export const AddOpeningArgs = z.strictObject({
  kind: O.kind,
  roomId: z.optional(RoomId),
  ...openingFields,
});

export const UpdateOpeningArgs = z.strictObject({ id: Id, ...openingFields });

export const AddRoomArgs = z.strictObject({
  besideRoomId: z.optional(
    d(
      z.string().check(z.minLength(1), z.maxLength(40)),
      'The new room goes against a free side of this room, sharing a wall. Default: the first room.',
    ),
  ),
  name: z.optional(z.string().check(z.maxLength(80))),
  width: z.optional(d(size(), 'Along x. Default 10 ft (3.05 m).')),
  depth: z.optional(d(size(), 'Along y. Default 10 ft (3.05 m).')),
});

export const UpdateRoomArgs = z.strictObject({
  id: Id,
  name: z.optional(
    d(z.string().check(z.maxLength(80)), 'Empty: the room is called "Room N" again.'),
  ),
  x: z.optional(
    d(coord(), "Moves the room (with its furniture): its bounding box's left edge, floor x."),
  ),
  y: z.optional(
    d(coord(), "Moves the room (with its furniture): its bounding box's top edge, floor y."),
  ),
});

export const ReplacePlanArgs = z.strictObject({
  // Not described here: a description would be registered on the shared Plan schema itself.
  plan: Plan,
});

/** Every tool's arguments, by tool name. */
export const TOOL_ARGS = {
  get_plan: NoArgs,
  check_layout: CheckLayoutArgs,
  add_item: AddItemArgs,
  update_item: UpdateItemArgs,
  set_aside_item: IdArgs,
  place_item: PlaceItemArgs,
  remove_item: IdArgs,
  add_opening: AddOpeningArgs,
  update_opening: UpdateOpeningArgs,
  remove_opening: IdArgs,
  add_room: AddRoomArgs,
  update_room: UpdateRoomArgs,
  remove_room: IdArgs,
  replace_plan: ReplacePlanArgs,
} as const;

export type ToolName = keyof typeof TOOL_ARGS;
