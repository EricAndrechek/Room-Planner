# Plan format v4 and agent interfaces

Status: implemented. PRs 1 to 3, 5, 7a, 7b, 8 and 9 have shipped (the last four as the Floor plans
release); PRs 4 and 10 are the Agents release (PR #40), and 6 was folded into 4 (section 10).
The design measurements were taken on 2026-11-24 against `main` at
`6aed18d` (Node 22.23.5, Apple silicon). The spike scripts are not committed; section 12 lists them.

This document fixes the next plan format and the architecture around it, so that the phased PRs in
section 10 can be implemented without re-deriving decisions. Every question has one answer and the
reason for it.

## 1. Summary of decisions

| Question                  | Decision                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Schema library            | Zod 4, written with the `zod/mini` API. One file, `src/core/schema.ts`. Adds 8.0 KB gzip to the planner chunk.                         |
| Canonical document        | JSON object `Plan` with `version: 4`. One floor, many rooms, all coordinates in one floor space.                                       |
| Rooms                     | A polygon outline, clockwise. A rectangle is a 4-point outline. No separate rectangle type.                                            |
| Walls                     | Derived: wall `i` runs from `outline[i]` to `outline[i+1]`. Never stored.                                                              |
| Openings                  | Nested in their room: `{ wall: index, offset, width }`. Vertex edits go through core operations that re-anchor them.                   |
| Doors between rooms       | Not stored. A door connects two rooms when it lies on a wall segment both rooms share. Derived geometrically.                          |
| Items                     | Top level, floor coordinates, centre + rotation. Shape is `rect`, `l` or `ellipse`. No `placement` means the item is in the inventory. |
| Lengths                   | The document names its own `unit`. The app always holds and stores feet. Agents may send `in`, `cm`, `m` or `ft`.                      |
| Geometry                  | Own code, no clipping library: every shape becomes convex parts, tested with the SAT already in `geometry.ts`. 1.2 KB gzip.            |
| Migrations                | One entry point, `loadPlan`, used by every load path. Steps `2→3→4`, pure, tested with fixtures of every historical format.            |
| Storage                   | New keys for v4. The v3 keys are never rewritten, so they are the raw pre-migration backup and a rollback still works.                 |
| Newer document, older app | Never loaded, never overwritten. The app shows "update Room Planner". Ships in the first schema PR.                                    |
| Share links               | Still `#s=` + deflate + base64url. The JSON inside becomes a positional array. 43% shorter than the canonical JSON.                    |
| Core package              | `src/core/`, a folder with an import boundary enforced by ESLint. Not a workspace package.                                             |
| MCP server                | `/mcp` on the existing Worker, official SDK `createMcpHandler`, stateless. Three tools that take or return a whole plan.               |
| MCP image                 | No server-side image. An MCP Apps view (`ui://`) draws the plan's SVG in the chat client. PNG would need Workers Paid (declined).      |
| WebMCP                    | Fourteen tools registered from a lazy chunk when `document.modelContext` (or `navigator.modelContext`) exists. Each is one undo step.  |

The one owner decision, Workers Paid for PNG images, was taken: the account stays on Workers Free,
and the MCP server shows plans through an MCP Apps view instead (section 7, "The plan viewer").

## 2. Schema library

### Measurements

The v4 schema in section 3 was written in each library and imported on the planner's boot path.
The planner was built once per library. Sizes are the `PlannerApp` chunk.

| Library                   | Chunk raw | Chunk gzip | Added gzip |
| ------------------------- | --------: | ---------: | ---------: |
| none (today)              | 157,866 B |   46,499 B |          0 |
| valibot 1.5.0             | 168,544 B |   49,255 B |    +2.8 KB |
| zod 4.6.7 via `zod/mini`  | 184,288 B |   54,529 B |    +8.0 KB |
| zod 4.6.7 (classic API)   | 245,897 B |   71,194 B |   +24.7 KB |
| typebox 1.4.7 (`Value.*`) | 298,911 B |   83,215 B |   +36.7 KB |

JSON Schema output for the full `Plan`:

| Library               | Generator                              | Dialect  | Size    | Notes                                                                                             |
| --------------------- | -------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------- |
| zod, classic and mini | built in, `z.toJSONSchema`             | 2020-12  | 3,831 B | All 14 descriptions and 8 defaults kept. Mini and classic output is identical.                    |
| valibot               | separate `@valibot/to-json-schema` 1.8 | draft-07 | 3,635 B | Threw on the `finite` action until `errorMode: 'ignore'` was set. Enums as `enum`.                |
| typebox               | the schema is the JSON Schema          | none set | 4,240 B | Enums come out as `anyOf` of `const`, which is longer and weaker for language models than `enum`. |

Validation cost, warm, per document: under 0.5 ms for the 40-item apartment in zod and valibot,
about 1.4 ms in typebox. The first call costs 2 to 7 ms once. None of this matters at load time.

### Decision: Zod 4 with the `zod/mini` API

- The JSON Schema generator is part of the library and understands every construct we use. Valibot's
  is a second package that already failed on one of our validators.
- The official MCP server SDK (`@modelcontextprotocol/server` 2.4.0) depends on `zod ^4.2`. The
  spike registered a tool with the `zod/mini` schema unchanged and the SDK produced the tool's JSON
  Schema from it. The Worker carries Zod regardless of what the app uses.
- 8.0 KB gzip is 17% of the planner chunk and 5.2 KB more than valibot. That is the price of one
  schema for the app, the Worker and WebMCP with no adapter.
- The classic Zod API costs three times as much for the same schema. The schema file must import
  from `zod/mini` only. An ESLint `no-restricted-imports` rule on `zod` and `zod/v4` enforces this.
- TypeBox is the largest and its fast path compiles code with `new Function`, which the site's CSP
  and Workers both forbid.

`z.toJSONSchema` is never imported by the planner chunk. The Worker calls it at start-up, and
WebMCP reads schemas generated at build time (section 8).

## 3. The v4 document model

### Schema

This is the single source of truth. TypeScript types are inferred from it (`z.infer`), so
`src/types.ts` loses `Layout`, `Door`, `RoomWindow` and `FurnitureItem` when the app moves to v4.

```ts
// src/core/schema.ts
import * as z from 'zod/mini';

export const PLAN_VERSION = 4;

const d = <T extends z.ZodMiniType>(schema: T, description: string): T =>
  schema.register(z.globalRegistry, { description }) as T;

const Id = d(
  z.string().check(z.regex(/^[A-Za-z0-9_-]{1,40}$/)),
  'Unique within the plan. Letters, digits, "-" and "_".',
);
const Coord = z.number().check(z.minimum(-100000), z.maximum(100000));
const size = () => z.number().check(z.positive(), z.maximum(10000));
const Point = z.object({ x: Coord, y: Coord });
const Color = z.string().check(z.regex(/^#[0-9a-fA-F]{6}$/));

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
  kind: z.enum(['door', 'window']),
  wall: d(z.int().check(z.minimum(0)), 'Wall index. Wall i runs from outline[i] to outline[i+1].'),
  offset: d(
    z.number().check(z.minimum(0)),
    'Distance along the wall from its start corner to the near edge of the opening.',
  ),
  width: d(size(), 'Width along the wall.'),
  type: d(z._default(z.enum(DOOR_TYPES), 'swing-in'), 'Doors only.'),
  hinge: d(
    z._default(z.enum(['start', 'end']), 'start'),
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
  shape: z._default(z.enum(['rect', 'l', 'ellipse']), 'rect'),
  width: d(size(), 'Bounding-box size along x before rotation.'),
  depth: d(size(), 'Bounding-box size along y before rotation.'),
  cut: d(
    z.optional(
      z.object({ corner: z.enum(['tl', 'tr', 'br', 'bl']), width: size(), depth: size() }),
    ),
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
  unit: d(z.enum(['ft', 'in', 'm', 'cm']), 'Unit of every length in this document.'),
  rooms: z.array(Room).check(z.minLength(1), z.maxLength(50)),
  items: z._default(z.array(Item).check(z.maxLength(500)), []),
  settings: z.optional(
    z.looseObject({ unitSystem: z.optional(z.enum(['ft-in', 'ft', 'in', 'm', 'cm'])) }),
  ),
});
export type Plan = z.infer<typeof Plan>;
```

Rules the JSON Schema cannot express live in one function, `checkIntegrity(plan)`, which returns
issues with paths. It runs after the schema on every load path:

- ids are unique across the whole document (one namespace for rooms, openings and items);
- `opening.wall` is below `outline.length` and `offset + width` fits the wall;
- `cut` is present exactly when `shape` is `l`, and is smaller than the bounding box;
- an outline is a simple polygon with a non-zero area, listed clockwise (PR 2: a counter-clockwise
  outline would turn every wall's inward side outward, so strict mode rejects it; lenient mode
  reverses it, as below);
- "fits the wall" allows an overhang of `FIT_TOLERANCE` (0.001 in the document's unit), so the
  share form's 4-decimal rounding never makes a valid plan invalid.

### Why it looks like this

**One floor, no `floors` array.** The feature list asks for one connected floor plan. A later
`rooms → floors[0].rooms` step is mechanical if storeys are ever wanted.

**Rooms are polygons only.** A rectangle is `[(0,0), (w,0), (w,h), (0,h)]`. One representation
means one code path for geometry, rendering and validation. `isRectangle(room)` (4 axis-aligned
corners) lets the UI keep today's Width and Length fields for the common case.

**Walls are derived, openings store an index.** The alternatives were wall or vertex ids (a graph
model that agents would have to build by hand) and absolute door coordinates (ambiguous at corners,
and still invalid after a wall moves). An index is the simplest thing an agent can write. Its
weakness is vertex edits, so vertices change only through three core operations, which re-anchor
openings:

- `insertVertex(room, wall, t)` splits wall `k`. Openings on `k` go to `k` or `k+1` by position.
  Openings on later walls shift by one. An opening the new vertex would cut stays whole on the
  longer side.
- `removeVertex(room, i)` merges two walls. Openings keep their floor position projected onto the
  merged wall, clamped to it.
- `moveVertex(room, i, to)` keeps each opening's offset from the corner that did not move, clamped
  to the new length.

A property test asserts that after any sequence of these, every opening lies on a wall of its room,
and that an opening whose wall did not change did not move.

**Openings are nested in their room.** They cannot dangle, deleting a room deletes them, and the
shape matches how people and agents describe a room.

**Doors between rooms are derived.** Rooms abut with zero wall thickness: a shared wall is two
collinear edges of different rooms that overlap (tolerance `GEOMETRY_EPSILON`). An opening that
lies on a shared segment connects the two rooms. Nothing is stored, so nothing can disagree. The
door belongs to the room that lists it, and `swing-in` and `swing-out` are relative to that room.
Because clearance zones are computed in floor coordinates, a door that swings out into the next
room is checked against that room's furniture with no extra code.

**Items use floor coordinates, and which room they are in is derived.** Room-relative coordinates
would need an origin for a polygon room and a transform in every geometry function. One coordinate
space makes cross-room snapping, collision and dragging a piece from room to room trivial. An
item's room is the room that contains its centre. Moving a room moves the items whose centre is
inside it, in the same undo step. For a single room at the origin, floor coordinates are today's
room coordinates.

**`placement` is the centre, not the top-left corner.** Today `x, y` is the corner of the unrotated
box, so a sofa turned 90° and pushed against the left wall has a negative `x`. An agent cannot be
expected to produce that. The centre is unambiguous at any rotation and for any shape. Core keeps a
helper `itemBox(item)` that returns today's `{x, y, width, height, rotation}` box, so the snapping
code does not change.

**The inventory is the absence of `placement`.** No second list, no flag. Taking a piece out of a
room deletes `placement`; putting it in a room sets it. `hidden` stays a separate flag because it
keeps the position.

**Shapes are flat fields, not a union.** `shape` plus an optional `cut` gives a JSON Schema with
no `oneOf`, which every model API accepts. An L is its bounding box minus a corner rectangle, and
`cut.corner` makes mirrored sectionals direct instead of a rotate-and-swap trick. `ellipse` covers
round and oval.

**`height` becomes `depth`.** The UI already calls it Depth, and agents think "84 wide, 36 deep".

**Points are `{x, y}` objects.** Tuples need `prefixItems`, which several model APIs reject.

**The document names its unit.** Agents and people who paste JSON think in inches or centimetres.
`unit` is required so the choice is explicit. `toFeet(plan)` is the last step of loading and
returns the same type with `unit: 'ft'`; it does nothing when the plan is already in feet. A plan
in another unit with no `settings.unitSystem` gets that unit as its display preference, so it
keeps showing in the unit it was written in. The app
only ever holds, stores and shares feet, so no conversion happens on its own data and no core
function needs to know about units. `fromFeet(plan, unit)` converts back for JSON export and MCP
output, with today's rounding (6 decimals for feet and metres, 4 for inches and centimetres).
`settings.unitSystem` is the display preference; when absent it follows `unit` (`ft` shows as
`ft-in`).

**Ids are strings.** Migrated ids are `room-1`, `door-<old id>`, `window-<old id>` and
`item-<old id>`, which is deterministic and removes the collisions between today's door 1, window 1
and item 1. New ids are `<kind>-<n>` with `n` one above the highest in use.

**`designMode` leaves the document.** It is UI state and moves to the storage record.

**Objects are loose.** Unknown keys survive a load and save. This is what makes additive changes
safe when an older build opens a newer document of the same version.

### Geometry

All of it stays our own code, in `src/core/geometry/`. `polygon-clipping` was measured as the
alternative: 9.8 KB gzip against 1.2 KB for the approach below, and it answers a harder question
than we ask.

| Need                    | Approach                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item outline            | `itemParts(item)`: convex polygons in floor coordinates. `rect` is 1 part, `l` is 2 rectangles, `ellipse` is one 32-sided polygon.                                                                                              |
| Item overlaps item      | Bounding-box reject, then today's SAT with `GEOMETRY_EPSILON` on each pair of parts. Flush pieces still do not collide.                                                                                                         |
| Item inside a room      | Each part: every vertex inside or on the outline, no edge properly crossing an outline edge, no concave room corner strictly inside the part. The item must be inside one room.                                                 |
| Wall frame              | `wallFrame(room, i)`: `origin = outline[i]`, `along` = unit vector to `outline[i+1]`, `inward` = its right-hand normal. This replaces the four hard-coded `WALL_FRAMES`.                                                        |
| Door shape and blocking | `doorGeometry(opening, frame)` is today's function with the frame passed in. Clearance and doorway polygons come out in floor coordinates and are tested against item parts.                                                    |
| Drawing frame           | `drawingFrame(room, i)` (PR 3): the same wall running left to right (top to bottom when vertical). Openings are drawn and spots scanned in it; for a rectangle it is exactly the v3 frame, which keeps drawings byte-identical. |
| Snapping                | Unchanged for axis-aligned walls and item bounds. Angled walls add their angle to the rotation snap targets. No edge snapping to angled walls in the first version.                                                             |
| New piece placement     | `findFurnitureSpot` scans the room's bounding box and keeps candidates that pass "inside a room".                                                                                                                               |
| Room shrinks or changes | `moveInside` keeps today's behaviour for rectangles. For other outlines it moves a piece to the nearest free spot, or leaves it with the "outside room" warning if there is none.                                               |
| Rooms overlap           | Same part-against-outline test on the two outlines. Reported as a warning.                                                                                                                                                      |

Measured cost of a full check (every item against every item and against the rooms): 11 µs for the
sample plan, 104 µs for 25 pieces, 387 µs for the 40-item apartment. The worst case tried, 40
ellipses stacked on one spot, took 12 ms; a drag only tests the moved piece against the rest, which
is 1/40 of that. Nine spot checks passed, among them a chair in the notch of a sectional, a round
table beside a corner, and a rotated piece against an angled wall.

## 4. Migration chain

### Version numbers

`version` is one integer. It goes up only when an older reader could misread or fail to draw the
document: a field renamed, removed or given a new meaning, or a new enum value such as a fourth
shape. Adding an optional field with a default does not change it. A field is never repurposed.

| Version | What it is                                                             | How it is recognised                          |
| ------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| 2       | First release: one `door` with `open: 'in' \| 'out'`, Tailwind colours | object with `door` and no `doors`             |
| 3       | Everything else written before v4                                      | object with `roomDims` and no `version`       |
| 4       | This document                                                          | object with `version: 4`, or array starting 4 |

### One entry point

```ts
// src/core/load.ts
type LoadResult =
  | { ok: true; plan: Plan; from: number; repairs: string[] }
  | { ok: false; reason: 'newer'; version: number }
  | { ok: false; reason: 'invalid'; issues: Issue[] };

export function loadPlan(
  input: unknown,
  mode: 'lenient' | 'strict',
  options?: { lengthsInFeet?: boolean },
): LoadResult;
```

Steps, in order:

1. Detect the version. If it is above `PLAN_VERSION`, return `newer` and stop.
2. Expand the compact share form (section 5) if the input is an array.
3. Run the steps `MIGRATIONS[v]` up to the current version. Each is a small pure function from JSON
   to JSON in its own file, `src/core/migrate/v2.ts`, `v3.ts`.
4. Lenient mode only: `repair`. It drops an entity that cannot be fixed, clamps an opening onto its
   wall, renames duplicate ids, reverses a counter-clockwise outline, and records each action in
   `repairs`. This is today's `normalize*` behaviour, kept so one bad field never costs a plan.
5. Validate with the schema, then `checkIntegrity`.
6. `toFeet`.

`lengthsInFeet` (added in PR 2) tells the 3 → 4 step that a version 3 input is stored data: its
lengths are feet and its `unitSystem` is only the display preference. A link or the JSON box has
the same shape with lengths in `unitSystem`, and nothing in the document tells the two apart. The
v3 plans-file import has always read lengths as feet, so it passes the option too.

Lenient mode is for storage, share links and JSON import. Strict mode is for MCP and WebMCP, where
the caller should get the error and fix it.

Every path calls `loadPlan`: boot from storage (the working plan and each saved plan), `#s=` and
`#j=` links, `?config=` links, the JSON box in the Share dialog, the plans file import, MCP tool
input, WebMCP tool input, and the guide examples at build time.

### Every historical input, with its fixture

| Input                                                         | Written by                            | Fixture                                                |
| ------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------ |
| Storage `room-sim-v2-{dims,door,items}`                       | `650f35d`                             | exists: `v2-storage.json`                              |
| Storage `room-sim-v3-*`, Tailwind colours, no units in plans  | `3bd206d`                             | exists: `early-v3-storage.json`                        |
| Storage `room-sim-v3-*`, hex colours, `locked`, units in plan | `2c81c9d` to `2cae5c5`                | exists: `original-storage.json`                        |
| Storage as above plus `room-planner-schema: 1`, new doors     | 2.0 (`ece4748`) and doors (`aeda08b`) | `doors-storage.json` (captured from production)        |
| Link `?config=` `{roomDims, door, items}`                     | `650f35d`                             | `v2-config-link.json`, from the v2 storage fixture     |
| Link `?config=` `{roomDims, doors, windows, items}`, feet     | `3bd206d`                             | `early-v3-config-link.json`                            |
| Link `?config=` with `name` and `unitSystem`                  | `2c81c9d` to `2cae5c5`                | exists: `original-share-links.json` (ft-in and metres) |
| Link `#s=` and `#j=`, same JSON as UTF-8                      | 2.0                                   | `fragment-links.json`: one of each, non-Latin name, cm |
| Share dialog JSON box                                         | all                                   | same JSON as the link fixtures                         |
| Plans file `{version: 1, exportedAt, projects}`               | `3bd206d` onwards                     | `plans-file.json`                                      |
| Bare layout object in a plans file                            | `3bd206d` onwards                     | `bare-layout-file.json`                                |

The legacy-domain bridge (`24fc2a4`, removed in `1a26cc4`) never wrote a format of its own. The
fixtures already in `src/lib/__fixtures__/` move to `src/core/__fixtures__/` unchanged.

### The 3 → 4 step

| v3                                               | v4                                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `roomDims {width, height}`                       | `rooms[0] = { id: 'room-1', outline: [(0,0), (w,0), (w,h), (0,h)] }`                                                               |
| `doors[]`, `windows[]`                           | `rooms[0].openings[]` with `kind`, doors first                                                                                     |
| `wall: top / right / bottom / left`              | `wall: 0 / 1 / 2 / 3`                                                                                                              |
| `position` (from the left or the top)            | `offset`. Same value on top and right. On bottom and left, `length - position - width`. First clamped onto the wall as v3 drew it. |
| `hinge: left / right`                            | `start / end`. Same on top and right, swapped on bottom and left.                                                                  |
| `type`, `swingAngle`                             | unchanged                                                                                                                          |
| item `x, y` (corner), `width`, `height`          | `placement {x: x + width/2, y: y + height/2, rotation}`, `width`, `depth`                                                          |
| `visible: false`                                 | `hidden: true`                                                                                                                     |
| `locked`, `label`, `color`                       | unchanged (colours already hex after the 2 → 3 step)                                                                               |
| `unitSystem`, numbers in that unit (links, JSON) | `unit` = `ft` for `ft-in`, `ft` or missing, otherwise the same; numbers copied as they are                                         |
| storage: feet, units in a separate key           | `unit: 'ft'`, `settings.unitSystem` from the key or the plan                                                                       |
| project `designMode`                             | storage record `ui.designMode`                                                                                                     |
| unknown extra fields                             | kept on the same entity                                                                                                            |

Bottom and left reverse because a clockwise outline runs right to left along the bottom and bottom
to top along the left.

### Guarantees and how they are tested

- **Idempotent.** A step runs only on its own version, and the result carries the next version.
  Test: `loadPlan(loadPlan(x).plan)` equals `loadPlan(x).plan` for every fixture.
- **Lossless.** Test: for every fixture, the SVG drawn from the migrated plan is byte-identical to
  the SVG today's code draws from the original, and the same warnings are reported. That is the
  definition that matters to a user. Unknown fields are asserted to survive.
- **Property tests** (`fast-check`, a new dev dependency): arbitrary valid v3 layouts go through
  3 → 4 and satisfy the schema, the integrity check and the SVG equality above; arbitrary valid
  plans round-trip through the compact share form and through `fromFeet` then `toFeet`; lenient
  loading of arbitrary JSON never throws.
- **Fixtures are frozen.** A fixture file is never edited after it is committed. New formats add
  files.

### Storage, backup and rollback

The v4 app reads and writes new keys:

| Key                    | Content                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `room-planner-plans`   | `[{ id, createdAt, updatedAt, ui: { designMode }, plan }]`           |
| `room-planner-working` | the plan being edited                                                |
| `room-planner-ui`      | `{ currentPlanId, designMode, legacy: { migratedAt, fingerprint } }` |
| `room-planner-schema`  | `2`                                                                  |

The first boot of the v4 app migrates `room-planner-projects` and `room-sim-v3-*` into these keys
and then never touches the old keys again. Consequences:

- The old keys are the raw pre-migration backup. No extra copy is made, and nothing can
  corrupt them.
- A rollback to a v3 build finds its own keys exactly as it left them.
- If a v3 build runs again after the migration (rollback, or a stale tab) and the user edits there,
  the next v4 boot sees that `room-planner-projects` no longer matches `legacy.fingerprint`. It
  imports every legacy plan whose `updatedAt` is later than `legacy.migratedAt` as a new plan named
  "<name> (recovered)" and updates the fingerprint. No edit is lost in either direction.
- If writing the new keys fails (quota), the app keeps working in memory, shows the existing
  storage notice, and the old keys still hold everything.

Later in-place migrations (4 → 5) are per document. Before the first write that would replace a
stored plan of an older version, the raw string of `room-planner-plans` and `room-planner-working`
is copied to `room-planner-backup` as `{ at, raw }`. One generation is kept. If the copy fails, the
app does not overwrite; it runs in memory and asks the user to export.

### An older app opens a newer document

`loadPlan` returns `{ ok: false, reason: 'newer' }` and each caller follows the same rule: do not
load it, do not write over it, say what to do.

| Where               | Behaviour                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Share link          | The URL is left as it is and no plan is created. A dialog says the plan needs a newer Room Planner, with an Update button (service worker update, then reload). |
| Saved plan          | Listed as "needs update" and cannot be opened. Its record is written back byte for byte whenever the list is saved.                                             |
| Working plan        | The app starts on the update dialog and writes nothing to `room-planner-working`.                                                                               |
| JSON or file import | The existing error line says the file needs a newer version.                                                                                                    |
| MCP, WebMCP         | A validation error that names the highest supported version.                                                                                                    |

After the update and reload, the link is still in the URL and opens normally.

What PR 2 ships (the app still holds v3 layouts, so for this build "newer" means any version above
3, `APP_PLAN_VERSION` in `lib/planVersion.ts`; PR 5 raises it to `PLAN_VERSION`): the share-link
dialog for `#s=`, `#j=` and `?config=`, the JSON box and the plans-file import, all decided by
`core/version.ts` from the document's shape, so the schema does not load with the app. The dialog
is a lazy chunk on the native `<dialog>`. A link that cannot be decoded (bad base64 or deflate data,
not JSON, not a plan, or empty) opens the user's own plan with "This link is damaged". The saved and
working plan rows need the v4 keys: the v3 keys can never hold a newer document, because the v4 app
never writes them, so those rows ship with the keys in PR 5.

Builds that are already deployed cannot be changed. Given a v4 link, today's `isShareConfig` fails
(there is no `roomDims`), so the link is ignored and nothing is touched. That is safe but silent.
The update dialog therefore ships in the first schema PR (PR 2), several PRs before the app starts
writing v4 links (PR 5), so that most installed copies know how to ask for an update by then.

## 5. Share links and QR

### Measurements

Each plan was encoded eight ways. Bytes are after compression. URL is the full link on
`https://room-planner.andrechek.com/`. QR is the QR version at error correction L; the Share dialog
shows a code up to version 25 (about 1,270 characters).

| Encoding                           | Sample plan, 6 items | 25-piece room      | 4 rooms, 40 items | L-shaped room, 8 items |
| ---------------------------------- | -------------------- | ------------------ | ----------------- | ---------------------- |
| A. Today: v3 JSON + deflate        | 480 chars, QR 15     | 1,318 chars, QR 26 | not expressible   | not expressible        |
| B. v4 JSON as stored + deflate     | 585, QR 16           | 1,424, QR 27       | 2,026, QR 33      | 856, QR 20             |
| C. B without defaults, 4 decimals  | 532, QR 16           | 1,328, QR 26       | 1,888, QR 32      | 784, QR 19             |
| D. C with one-letter keys          | 449, QR 14           | 1,209, QR 25       | 1,753, QR 31      | 689, QR 18             |
| **E. Positional arrays + deflate** | **261, QR 10**       | **929, QR 21**     | **1,157, QR 24**  | **406, QR 13**         |
| E2. E with every id written out    | 318, QR 11           | 966, QR 22         | 1,398, QR 27      | 490, QR 15             |
| F. Hand-written binary, no deflate | 292, QR 11           | 949, QR 22         | 1,608, QR 29      | 432, QR 14             |
| F2. Hand-written binary + deflate  | 262, QR 10           | 778, QR 19         | 1,282, QR 26      | 413, QR 13             |
| G. MessagePack of D + deflate      | 461, QR 15           | 1,466, QR 28       | 2,088, QR 34      | 792, QR 19             |

Two things stand out. Deflate removes most of the cost of long keys, so shortening keys (D) buys
little. And the binary format is no better than positional JSON once both are compressed: it wins
on the 25-piece room and loses on the apartment, where deflate finds more repetition in text.

### Decision: positional arrays inside the existing `#s=` scheme

The link stays `#s=<base64url(deflate-raw(utf8(JSON)))>`, with `#j=` as the uncompressed fallback.
Only the JSON changes: an array instead of an object. It is still JSON, readable in a debugger, and
decoded with `JSON.parse`. Against writing the canonical JSON (B) it is 43% shorter on the
apartment and 55% shorter on the sample plan. Against today's links it is 46% and 30% shorter for
the two plans both can express.

It earns its place for three reasons. The apartment fits in a QR code (version 24) where the
canonical JSON does not (version 33). The 25-piece room fits where today it does not. And an MCP
client's language model has to copy the link into its answer, where every character is a chance to
corrupt it.

The form, with trailing defaults trimmed from every tuple:

```text
[4, name, unit, unitSystem | 0, rooms, items]
room    = [[x0, y0, x1, y1, ...], openings, name?, id?]
opening = [kind, wall, offset, width, type?, hinge?, swing180?, id?]     kind, type: enum index
item    = [label, width, depth, color, [x, y, rotation?] | 0, shape?, [corner, w, d] | 0, flags?, notes?, id?]
```

- `color` is an index into the ten presets, or six hex digits.
- `flags` is `locked` (1) plus `hidden` (2).
- An id is written only when it differs from the positional default (`room-1`, `door-2`, `item-7`
  by order). The decoder regenerates the defaults.
- Lengths are rounded to 4 decimals of a foot (0.03 mm) and rotation to 2 decimals. Today's links
  already round to 6.
- Unknown loose fields are not carried. A link holds the fields this version knows.
- A later optional field is appended to the end of its tuple, so older links stay valid and the
  trimmed default costs nothing.

`compact(plan)` and `expand(array)` are two hand-written functions of about 80 lines each in
`src/core/share/compact.ts`. A property test asserts `expand(compact(p))` equals `p` after the same
rounding. "Is this link already one of my plans" compares `compact` output, so rounding cannot
create duplicates.

### Old links

Decoding accepts, forever: an array (compact, version in element 0), an object with `version`, and
an object without one (versions 2 and 3), from `#s=`, `#j=` and `?config=`. The `?config=` decoder
keeps its Latin-1 behaviour and its "+ arrived as a space" tolerance. All of them end in
`loadPlan`. The fixture table in section 4 covers each.

### Links assistants write (Agents release)

Most chat users never add a connector, so an assistant must be able to hand over a plan without
tools. Every plan link is opened by `readSharePayload` (`src/core/share/link.ts`), as a new saved
plan with the link removed from the address bar, and reported as `share_link_opened` with its
`source`: `share` (`#s=`/`#j=`), `legacy` (`?config=`), `compact` (`#p=`) or `plan_param`
(`#plan=`). Nothing is stored on a server (the owner's decision: no short links). `llms.txt`,
`/agents/#plan-links` and the MCP instructions tier the ways, and every assistant is told to show
a link as Markdown link text, never the raw URL:

1. **Tools** (MCP, WebMCP): preferred; the plan is checked and the link always opens.
2. **Code** (ChatGPT data analysis, Claude's analysis tool, Gemini code execution): the canonical
   v4 JSON, raw deflate, base64url without padding, after `#s=`. `#s=` already reads any JSON a
   plan loader accepts, so nothing in the app changed for this. `/plan.schema.json` publishes the
   format (`z.toJSONSchema(Plan, { io: 'input' })`, the MCP tools' schema), and `llms.txt` has a
   six-line Python and a five-line JavaScript snippet; a unit test runs both.
   `src/lib/agentExample.json` holds a three-room plan and its link, written by a test with the
   documented algorithm, validated against the published schema and opened in e2e. Any size and
   shape: the 1 KB three-room plan is a 608-character link.
3. **Neither**: the readable form after `#p=` (below), for small plans.

`#plan=<JSON>` (or `?plan=`) is a silent fallback, not documented for assistants: raw or
percent-encoded JSON in the MCP tools' format, read tolerantly (typographic quotes, trailing
punctuation, a stray `%`, a `#` from a colour that ends `?plan=`, no `version`, a room as
`{width, depth}`), capped at 16 KB of JSON (`src/core/share/planParam.ts`).

### Readable links (`#p=`)

A compact text a model writes straight into a link (`src/core/share/readable.ts`). It uses only
characters chat apps, Markdown and browsers leave alone: letters, digits and `- . _ ~ , ; : @`
(not the brackets and `!` that URLs also allow, since a `)` ends a Markdown link).

```
#p=ft;room:Bedroom:12x11;door:bottom:8:3;window:top:4:4;item:Queen_bed:5x6.7@6,3.35;item:Nightstand:1.7x1.3@2.65,0.65;item:Dresser:5x1.5@4.5,10.25
```

| Statement                              | Meaning                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ft`, `in`, `m`, `cm` (or `unit:cm`)   | The unit of every length; default `ft`.                                                                                                                                                                                                                                                                                                                                                         |
| `name:<plan name>`                     | The plan's name; default the only room's name.                                                                                                                                                                                                                                                                                                                                                  |
| `room:<name>:<W>x<L>[@x,y]`            | A rectangle, top-left corner at x,y. Without `@`: the first at 0,0, each next one right of the one before, top-aligned (so they share a wall).                                                                                                                                                                                                                                                  |
| `room:<name>:x1,y1,x2,y2,...[@x,y]`    | An outline, corners clockwise, shifted by `@`.                                                                                                                                                                                                                                                                                                                                                  |
| `door:<wall>:<offset>:<width>[:...]`   | On the room before it. Rectangles: `top`/`right`/`bottom`/`left`, offset from the wall's left or top end (`end-2`, or `right-2`/`bottom-2`: from the other end). Otherwise the wall index, offset clockwise from its start corner (`end-2`: from corner i+1). Options: `in`, `out`, `double`, `double-out`, `sliding`, `pocket`, `bifold`, `opening`; `right` (hinge, seen from inside); `180`. |
| `window:<wall>:<offset>:<width>`       | As a door.                                                                                                                                                                                                                                                                                                                                                                                      |
| `item:<label>:<W>x<D>[@x,y[,r]][:...]` | A piece, centre at x,y, r clockwise degrees; no `@`: set aside. Options: `round`, `L-<tl/tr/br/bl>-<w>x<d>` (the cut), `color-<rrggbb>`.                                                                                                                                                                                                                                                        |

- `;` separates statements and `:` fields; `_` in a name is a space (`%5F` is an underscore, and
  any other character is percent-encoded by the writer).
- Offsets on named walls run from the left or top end, unlike the format's clockwise offsets,
  because that is how people and models describe them ("1 ft from the left").
- Forgiving: keywords are case-insensitive, spaces around fields, empty statements and a trailing
  `;` are ignored, `×`, `X` and `*` work as the `x` of a size, an unknown statement is skipped with
  a note, and a door before any room is skipped. The key is read as `#p=` or `#P=`. A text with no
  readable room is a damaged link. The reader never throws (property-tested), returns a v4
  document, and leaves ids, outline direction and the rest to `loadPlan(..., 'lenient')`.
- Pieces without a colour get the presets in turn, so a plan written by hand is not all blue.
- A writer, `toReadable(plan)`, round-trips every guide example and every fixture (ids, notes and
  the locked and hidden flags are not part of the syntax). The bedroom above is 143 characters after `#p=`;
  the two-room flat in `llms.txt` 283.

### QR

Nothing changes in `qr.ts`. Codes get smaller for the same plan (the sample goes from version 15 to
10), and plans of about 40 pieces now get a code at all. Beyond version 25 the dialog offers the
link without a code, as today. An upper-case base-32 payload in QR alphanumeric mode was measured:
it saves two more versions, which does not justify a second link format.

## 6. Core package

### Decision: `src/core/`, not a workspace package

The Worker, the Astro build and Vitest all bundle TypeScript source through the same toolchain, so
a folder is importable by all three with no build step, no second `package.json` and no lockfile
change. A workspace package would add those without adding isolation that a lint rule cannot give.
If the core is ever published, moving a folder that already has a clean boundary is a small job.

The boundary is an ESLint rule on `src/core/**`: no import of `react`, `astro`, `lucide-react`,
`../components`, `../hooks`, or anything outside `src/core`, and no use of `window`, `document` or
`localStorage`. Core depends on `zod/mini` and nothing else.

```text
src/core/
  schema.ts            Plan schema, inferred types, PLAN_VERSION
  load.ts              loadPlan, checkIntegrity, repair
  units.ts             toFeet, fromFeet, parsing and display (today's lib/units.ts)
  colors.ts
  migrate/             v2.ts, v3.ts, index.ts
  geometry/            index.ts (polygons, SAT), shapes.ts (itemParts), walls.ts (wallFrame), doors.ts (doorGeometry)
  check.ts             checkLayout(plan, { minClearance, codes }) -> Issue[]   (every code in section 7)
  placement.ts         findFurnitureSpot, findOpeningSpot, moveInside
  snapping.ts
  ops.ts               pure edits: addItem, moveItem, toInventory, insertVertex, moveRoom, ...
  adapter/             PR 3 to PR 5 only: index.ts (planFromLayout, the v3 checks and placement),
                       scene.ts (the v3 export, apart so the export stays a lazy chunk)
  openings.ts          PR 3 to PR 5 only: doors and windows in v3 terms, over geometry/doors.ts
  share/               codec.ts (base64url, deflate), compact.ts, link.ts
  render/              scene.ts, scene/rooms.ts, scene/items.ts, svg.ts, fontMetrics.ts
  __fixtures__/
```

What stays outside: `storage.ts`, `projects.ts`, `boot.ts`, `pwa.ts`, `analytics.ts`, `qr.ts`,
`export/exportPlan.ts` and `export/planPdf.ts` (browser APIs), and the React style helpers now at
the bottom of `openings.ts` (`doorStyles`, `windowStyles`, `doorSvg`), which move to
`src/components/planner/openingStyles.ts`.

How PR 3 built it, for PR 5 to finish: the app keeps its v3 imports. `core/openings.ts` and
`core/adapter/` keep the v3 function names and signatures over the plan core, so components
changed only where an import moved (`moveInside`, `piecesOutside`, `findFurnitureSpot` from
`core/adapter`, the export from `core/adapter/scene`). `planFromLayout` gives entities positional
ids (`door-0`, `item-0`) so answers map back by index even when v3 ids collide. The scene emits the
data attributes it always did (`wall="bottom"` on a rectangle, the wall's index otherwise; `hinge`
named in the drawing frame). An edit that would leave an outline whose walls are closer than
`GEOMETRY_EPSILON` to touching is refused, so rounding never turns a valid outline into a crossed
one. The scene draws any outline (a rectangle exactly as before; other outlines as a path, the wall
band as its stroke) and L and round pieces as paths; PR 7a and 7b own their final look. These
checks and the plan geometry add 2.9 KB gzip to the planner's boot chunks; the schema stays out.

`ops.ts` is new and matters for WebMCP: every edit the UI makes becomes a pure function
`(plan, args) => plan`. The hooks call them through `history.apply`, and the WebMCP tools call the
same functions.

How each consumer uses it:

- **App:** `import { loadPlan } from '../core/load'`. Storage and boot call `loadPlan`; components
  import types from `core/schema`.
- **Worker:** `worker/index.ts` imports `../src/core/...` by relative path. Wrangler bundles it. A
  `worker/tsconfig.json` with the Workers types and no DOM library type-checks the Worker and, by
  inclusion, proves core compiles without the DOM.
- **Guides build:** `src/lib/guides/examples.ts` defines each example as a `Plan` and
  `guides/render.ts` calls `core/render` and `core/share`. The examples test runs `checkLayout`
  and still requires zero issues.

## 7. MCP server

### Shape

One Worker serves the site's static assets and `/mcp`. The endpoint is stateless Streamable HTTP
with no authentication, no storage and no session. It uses `createMcpHandler` from
`@modelcontextprotocol/server` 2.4.0, which the spike confirmed does the following with one
server factory:

- answers clients on the 2026-07-28 protocol (no handshake, one JSON response per POST);
- answers 2025-era clients statelessly (`initialize`, then each call as its own POST);
- returns 405 for GET and DELETE;
- turns a schema failure into a tool error that names the path, for example
  `plan.unit: Invalid option: expected one of "ft"|"in"|"m"|"cm"`.

Measured: the spike's Worker bundle with the SDK and the schema was 326 KB (87 KB gzip). The PR 4
Worker, with the drawing code and the viewer, is 415 KB minified (120 KB gzip). A `tools/list` or a
`check_layout` call on the 40-item apartment costs about 1 ms of CPU.

As built (PR 4), the code is in `worker/`: `index.ts` (the entry: `/mcp*` to `http.ts`, anything
else to the assets), `http.ts` (CORS, rate limit, 404/405/413/429, the server card), `mcp.ts` (the
server factory), `tools.ts` (what each tool computes, with no SDK, so unit and e2e tests call it
directly), `link.ts` (edit links), `descriptions.ts`, `warm.ts` (start-up warm-up, see "CPU per
request") and `viewer/` (the plan viewer). Tool input schemas
are `z.toJSONSchema(Plan, { io: 'input' })`, handed to the SDK as a Standard Schema whose `validate`
only checks for an object: the handler reads the plan with `loadPlan(..., 'strict')`, so every
problem comes back at once, one line per path (`plan.rooms.0.openings.1.wall: ...`).

Cloudflare's `agents` package wraps the same SDK function and adds nothing a stateless server
needs, so it is not used.

### Whole documents, not incremental operations

The server keeps nothing between calls, so an "add item" tool would need the whole plan as input
anyway. Every tool therefore takes or returns a whole `Plan`. To change a plan, the agent edits the
JSON and calls again. This also keeps the tool list short, which is what makes agents pick the
right tool.

Helper tools were considered again for floors of several rooms (Agents release) and left out.
`suggest_placement` (a free spot for a piece) would reuse the app's `findFurnitureSpot`, but that
picks the free spot nearest the middle of the room, while an agent places a bed against a wall
for a reason; and its grid search took 5 ms (warm, in Node) on a full 24 x 20 ft room, on top of
the 6 ms median the SDK spends on every request, against Workers Free's 10 ms. `add_room_beside` is two additions for a model (a hall right of a 12 ft room starts at
x = 12), which the description states. `check_layout` already names each piece and room in a
problem with distances, which is what an agent needs to fix it.

### Tools

All three are read-only in the MCP sense (`readOnlyHint: true`): they compute and return.

| Tool           | Input                                   | Output (`structuredContent`)                               | Use                                                        |
| -------------- | --------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| `create_plan`  | `{ plan: Plan }`                        | `{ plan, issues, summary, url, editable }`, and the viewer | Turn rooms and items into a checked plan and an edit link. |
| `check_layout` | `{ plan: Plan, minClearance?: number }` | `{ ok, issues, summary }`                                  | Cheap loop while arranging: no link, no drawing.           |
| `read_plan`    | `{ url: string }`                       | `{ plan, summary, issues, url, editable }`, and the viewer | Start from a plan the user already has (any link format).  |

The design's fourth tool, `render_plan` (a PNG), is not built: `create_plan` and `read_plan` show
the drawing through the plan viewer below, so a separate "show" tool would only lengthen the list.

Details that implementers need:

- `plan` in an input is the `Plan` schema itself. `plan.version` is required. The server's
  JSON Schema is `z.toJSONSchema(schema, { io: 'input' })`, so fields with defaults are optional
  for the agent.
- `plan` in an output is normalised (ids and defaults filled, outline clockwise) and converted back
  to the unit the agent sent, so the agent can edit and resend it.
- Every plan the format allows is accepted, checked, drawn and linked: several rooms, any outline,
  L and round pieces, pieces set aside (see "Edit links").
- `url` is the edit link and `editable` is always `true` (kept for clients written while some
  plans had no link). The link is also the last line of the text content, alone on its line, as
  Markdown link text (`[Open <plan> in Room Planner](url)`) after a line telling the model to pass
  it on that way and never as a bare URL, so a client that shows only text still shows it whole and
  a model does not paste a 900-character address into its reply.
- `Issue` is `{ code, severity: 'error' | 'warning' | 'info', message, ids: string[] }`. Codes:
  `item_overlap`, `item_outside_room`, `door_blocked`, `doorway_blocked`, `opening_overlap`,
  `opening_off_wall`, `room_overlap`, `window_between_rooms`, `tight_clearance`, `unknown_field`.
  Messages name rooms ("the door between Bedroom and Hall"); a door between rooms is checked on
  both sides (its swing into the next room, a doorway in each). `message` is a full
  sentence with names and distances in the plan's unit ("Sofa overlaps Coffee Table by 4 in").
- `tight_clearance` is `info`: a gap from 6 in (`TUCKED`) up to `minClearance` (default 24 in)
  between two pieces or a piece and a wall. Closer than 6 in is taken as meant (chairs side by side
  or at a table, a dresser just off the wall). Messages name a piece that shares its label with its
  centre ("Chair at (11, 6)") and a door on a rectangle's wall with its span seen from above
  ("7'–10' from the top"). The text content groups issues that say the same (`groupIssues`), errors
  first; `issues` stays one entry per issue. It reuses `measureClearances`. `ok` is true when no issue is an
  error or a warning.
- `summary` is one paragraph: each room (by the name the app shows, "Room 2" when it has none)
  with its size, area and openings, the doors between rooms, counts, and what is hidden or set
  aside.
- Tool descriptions carry what an agent needs to write a plan cold: the coordinate system (one
  floor coordinate space for every room), the rectangle recipe and its wall numbers (wall i runs
  from `outline[i]` to `outline[i+1]`), how rooms join (they touch, with no wall thickness, and a
  door on a shared wall, listed once, connects them), the direction of `offset` on each wall, that
  `placement` is the centre, the furniture shapes (`ellipse`, `l` with its `cut`), that leaving out
  `placement` sets a piece aside, and a short list of common sizes and clearances. There is no catalogue. The
  format is in both `create_plan` and `check_layout`, since an agent may read only the tool it
  calls first; the server's `instructions` give the workflow.
- The loose schema accepts unknown keys. For agents that is usually a typo, so the MCP layer
  reports each as `unknown_field` (a warning, with its path) instead of rejecting or silently
  keeping it.
- Limits: request body 256 KB (413 above it); the schema's own caps (50 rooms, 500 items, 64
  corners per room).
- Plans are never logged. The SDK's error callback logs the error's name only, since a message can
  quote the request.

### Edit links

A server link is the compact v4 form (`#s=`), the one the app writes (`buildPlanUrl`,
`worker/link.ts`). It carries the whole plan: room names, item notes and ids included.

The editor opens every valid plan since the Floor plans release (PRs 7a, 7b, 8 and 9). The server
still passes each plan through the editor's own `editablePlan` (`src/lib/plans.ts`), which turns
each room to start at its top-left corner and moves the floor to the origin (no drawing changes),
so the link opens exactly as the editor stores it. Until then the server answered plans the editor
could not open with `url: null` and a reason; that path is gone. A property test round-trips random
rectangular plans through a server link and `readPlanLink`, a unit test does the same for an L
room, two rooms and a rectangle away from the origin, and e2e tests open a one-room and a two-room
server link in the app and compare what the editor stored.

Link source attribution (`share_link_opened` with `source: 'mcp'`): TODO, now that PR 5 has
merged: append `&src=mcp` in `planLink` and read it in `boot.ts`.

### The plan viewer (MCP Apps)

The account stays on Workers Free (10 ms of CPU per request); a PNG takes 30 to 65 ms (measured
below), and the owner declined Workers Paid. So the server never rasterises. It implements the MCP
Apps extension (SEP-1865, protocol `2026-01-26`; Claude web and desktop, ChatGPT, VS Code and Goose
render it): the user's browser draws the plan.

- **Resource:** `ui://room-planner/plan-viewer.html`, `text/html;profile=mcp-app`,
  `_meta.ui.prefersBorder: true`, no `csp` (it fetches nothing, so the host's no-network default is
  right). One self-contained file of about 32 KB: the template `worker/viewer/viewer.html` (markup
  and CSS) with `worker/viewer/app.ts` bundled in by `scripts/build-viewer.mjs` (esbuild; run by
  `pnpm build`, by Wrangler's custom build before `dev`, `deploy` and `preview`, and by Vitest).
  The output, `worker/viewer/dist/viewer.html`, is not committed. The script speaks the
  postMessage JSON-RPC by hand (`ui/initialize`, `ui/notifications/initialized`, `tool-input`,
  `tool-result`, `host-context-changed`, `size-changed`, `ui/open-link`, and replies to
  `ui/resource-teardown` and `ping`) instead of using the ext-apps `App` class, whose browser
  bundle is 129 KB gzip.
- **Linked from** `create_plan` and `read_plan` by `_meta.ui.resourceUri` (plus the deprecated
  flat `ui/resourceUri` key that the SDK's own helper also writes). `check_layout` has no view: it
  is the agent's inner loop.
- **The view draws the plan.** It reads `structuredContent` (`plan`, `issues`, `summary`, `url`)
  and draws `plan` with the export's own code (`toFeet`, `buildPlanScene` with the opt-in `data-id`
  attribute on rooms, openings and pieces, `sceneToSvg`: 20 KB minified, 8 KB gzip). The first
  version made the SVG on the server and sent it in the result's `_meta`; on the preview that put
  `create_plan` at a median of 12 ms of CPU (7 to 42), over Free's 10 ms, against about 6 ms for a
  `tools/list`. Drawing in the browser takes that work off the server and keeps any markup out of
  the model's context.
- **What it shows:** the drawing with its dimensions, area and scale bar, as a white sheet in
  either theme; on a floor of several rooms, each room's name and area and the shared walls, as in
  the export; pieces set aside listed under the drawing; pieces with errors outlined red, pieces
  and doors with warnings amber, rooms an issue names (overlapping rooms, a window between rooms)
  tinted; the errors
  and warnings as a list (choosing one points at its entities and dims the rest), tight gaps under
  a closed disclosure; and **Open in Room Planner**, which asks the host to open the link
  (`ui/open-link`; the sandbox blocks `window.open`). Light and dark follow `hostContext.theme` and
  the host's CSS variables, with fallbacks for every one; safe-area insets are honoured. Axe finds
  no serious issue in either theme.
- **Without MCP Apps:** clients ignore the view, and the text content carries the summary, the
  issues and the link, last and alone on its line; `structuredContent` has the data. A host that
  passes no `structuredContent` to the view gets the text shown in it. An SVG as an embedded
  resource was considered for plain clients and left out: it would cost server CPU and put about
  10 KB of markup in the model's context on every call.

A PNG stays possible: `@resvg/resvg-wasm` 2.6.2 was measured on the export's SVG (the 4-room drawing
is four of today's room drawings in a grid, 104 text labels):

| Plan              | 800 px wide | 1200 px wide | 1600 px wide | PNG at 1200 px |
| ----------------- | ----------: | -----------: | -----------: | -------------: |
| Sample plan       |    32–38 ms |     39–43 ms |     58–67 ms |          68 KB |
| 25-piece room     |    25–29 ms |     40–43 ms |     57–66 ms |         108 KB |
| 4 rooms, 40 items |    36–37 ms |     59–65 ms |    96–103 ms |         157 KB |

Starting the wasm module costs another 28 to 55 ms once per isolate; the wasm file is 2.48 MB
(947 KB gzip); text needs Inter `.woff2` passed in. That needs Workers Paid (30 s of CPU by
default). Revisit it only if usage shows that clients people actually use lack MCP Apps.

### CPU per request

Workers Free allows 10 ms of CPU per request, with "some built-in flexibility" per isolate for
infrequent overruns (Cloudflare's limits page); consistent overruns end in error 1102. The spike's
"about 1 ms" was measured in Node on a warm process. On the PR 4 preview (Workers Logs
`cpuTimeMs`, 15 to 16 calls of each, 2026-11-24, the 4-piece bedroom of the tests):

| Call                    | Median | Range   |
| ----------------------- | -----: | ------- |
| `tools/list`            |   6 ms | 2–15 ms |
| `resources/read` (view) |   6 ms | 2–16 ms |
| `check_layout`          |   5 ms | 3–16 ms |
| `read_plan`             |   9 ms | 4–27 ms |
| `create_plan`           |  10 ms | 3–35 ms |

Re-measured for the Agents release (2026-11-25, the same way, 9 to 11 calls of each over the
2025-era protocol, on a two-room floor with an L-shaped living room, a door between the rooms, an
L sofa, a round table, a piece set aside and seven issues):

| Call                    | Median | Range   |
| ----------------------- | -----: | ------- |
| `tools/list`            | 3.5 ms | 2–7 ms  |
| `resources/read` (view) | 3.5 ms | 2–6 ms  |
| `check_layout`          |   6 ms | 5–23 ms |
| `create_plan`           |   8 ms | 5–16 ms |
| `read_plan`             |  10 ms | 6–15 ms |

Every invocation ended `ok`. `read_plan` costs most: it decompresses the link, checks the plan and
compresses a fresh link.

A second run the same day, with the REST API deployed (10 to 12 calls of each, same floor; MCP
over the 2025-era protocol):

| Call                   |  Median | Range   |
| ---------------------- | ------: | ------- |
| MCP `tools/list`       |    4 ms | 3–12 ms |
| MCP `check_layout`     |   10 ms | 5–29 ms |
| MCP `create_plan`      |   12 ms | 3–21 ms |
| MCP `read_plan`        |    9 ms | 5–19 ms |
| `POST /api/plan/check` |  6.5 ms | 4–16 ms |
| `POST /api/plan/link`  |    5 ms | 3–13 ms |
| `GET /api/plan?s=`     | 11.5 ms | 5–22 ms |

All 74 logged invocations ended `ok` (no `exceededCpu`). The MCP numbers vary from run to run by
a few milliseconds (cold isolates); the REST routes skip the SDK's per-request work, which is
most of the difference. Medians at or above 10 ms are within Workers Free's tolerance for
occasional overruns; watch `exceededCpu` after launch.

Most of it is the SDK's own per-request work (a fresh server, message validation), which a
static `resources/read` shows; the spread is cold isolates. Two changes brought `create_plan` down
from a median of 12 ms (7 to 42): the view draws the plan instead of the server, and `warm.ts`
runs one of each lazily initialised piece (Zod's parsers for the SDK's message schemas, the plan's
JSON Schema, the tool code) in global scope, which runs once per isolate under its own 1 s start-up
limit (`wrangler check startup`: about 210 ms locally). Asynchronous work is not allowed there, so
a whole request cannot be replayed. None of about 200 MCP invocations on the preview ended in
`exceededCpu`. Watch that outcome in the Worker's metrics after launch; if it shows up regularly,
the options are Workers Paid or trimming the SDK's per-request work.

### REST API

For agents that make HTTP requests but have no MCP client (agentic tools, custom agents, ChatGPT
Custom GPT Actions), `worker/api.ts` maps three routes to the tools' own functions in `tools.ts`,
with no logic of its own:

| Route                                                    | Function     | Answer                                   |
| -------------------------------------------------------- | ------------ | ---------------------------------------- |
| `POST /api/plan/check` (plan, or `{plan, minClearance}`) | `checkPlan`  | `{ok, issues, summary}`                  |
| `POST /api/plan/link` (plan, or `{plan}`)                | `createPlan` | `{plan, issues, summary, url, editable}` |
| `GET /api/plan?url=` (or `?s=`, `?p=`)                   | `readPlan`   | as `/link`, or Markdown (see below)      |

Errors are `application/problem+json` (RFC 9457) with `error_kind` from the tools' vocabulary: 400
when the request cannot be read (not JSON: `bad_json`; no plan, a bad argument or URL), 422 when
it was read but the plan is invalid (`errors`, one `plan.path: message` line each) or the link is
damaged or too new, 405 with `Allow`, 413 over 256 KB, and 429 from the shared per-IP limit. CORS
is `*`. `/openapi.json` (OpenAPI 3.1; operationIds `checkLayout`, `createPlanLink`,
`readPlanLink`) and `/plan.schema.json` are built by Astro from the Zod schema
(`src/lib/openapi.ts`), static, so they never invoke the Worker; a unit test validates the
OpenAPI document. Analytics: `api_called` with `{op, ok, error_kind, rooms, items, unit,
transport: 'rest'}` and the MCP events' common properties and privacy rules. ChatGPT's and
Claude.ai's code sandboxes usually have no internet, so `llms.txt` points them at the offline
`#s=` way instead (section 5).

Their web browsing does reach the site, though, and an assistant that wrote a link without tools
has nothing else to check it with (ChatGPT, asked for a Thanksgiving layout, wrote a working `#p=`
link with two chairs overlapping and the entrance blocked, and called it "a proposed fit, not a
verified clearance check"). So `GET /api/plan` answers Markdown to `Accept: text/markdown` and to
the fetchers of assistants that browse (the md-router's `LLM_BOT_UA` plus `Perplexity-User` and a
few more), unless they ask for JSON: the summary, what the link said that the planner could not
use, the issues by severity (grouped), what to do next, and the link as Markdown link text once
nothing is an error or a warning. It carries `Vary: Accept, User-Agent` and `X-Robots-Tag:
noindex`. Every guide (llms.txt, the Agent Skill, `/agents/#check`) tells an assistant that can
open pages to check a link there, fix what it lists and check again before handing it over.

### Rate limiting and abuse

- One Workers rate-limit binding (`ratelimits` in `wrangler.jsonc`), keyed by client IP because
  there is no other identity: `MCP_LIMIT` at 120 per 60 s for every request to `/mcp` and
  `/mcp/*` except CORS preflights. 120, not 60: a 2025-era client spends three requests
  (`initialize`, `notifications/initialized`, `tools/list`) before its first call, and an agent
  loops on `check_layout`. Cloudflare's guidance prefers a key other than IP; with no accounts
  there is none, and the counters are per location and approximate, which is acceptable.
  Branch previews do not inherit bindings, so the `previews` block repeats it on its own
  namespace.
- **The binding did not limit on this account.** With the binding present on the preview
  (`RateLimit-Policy` set), 200 sequential and then 250 parallel requests from one address in about
  50 s were all answered. So `http.ts` also keeps a fixed-window counter per client in the
  isolate's memory (120 per 60 s, at most 10,000 clients, old windows dropped). It is approximate:
  over one keep-alive connection (what MCP clients use) 160 pings got 429 from about the 113th on
  the preview, but requests on fresh connections spread over many isolates and were not limited.
  It costs nothing and stops a single client hammering the endpoint. The binding stays in front of it, so if Cloudflare enforces it later (or
  on production), both apply.
- Over the limit: HTTP 429 with `Retry-After` and a JSON-RPC error that says to wait.
- The zone has Bot Fight Mode off and no AI-bot blocking (checked read-only). Keep it that way: on
  a Free zone Bot Fight Mode cannot be skipped for one path and would challenge MCP clients.

### HTTP details

- **CORS:** `Access-Control-Allow-Origin: *`, methods `POST, OPTIONS` (`GET, HEAD, OPTIONS` on the
  server card), `Access-Control-Allow-Headers: *` and `Access-Control-Expose-Headers: *`. The
  wildcard is honoured because no credentials are ever sent, and it covers the 2026-07-28
  `Mcp-Param-*` headers, which a fixed list cannot. `OPTIONS` returns 204. The endpoint has no
  cookies and no credentials, so any origin is safe, and "any origin, or none" is the Origin
  validation policy.
- **Response headers:** `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. `_headers`
  does not apply to Worker responses, so the site's CSP is neither needed nor sent here.
- **Routing:** `wrangler.jsonc` gains `main: "worker/index.ts"`, an `ASSETS` binding,
  `assets.run_worker_first: ["/mcp", "/mcp/*"]`, `minify` and `upload_source_maps`. Every other
  request is served from assets without running the Worker, so the site stays free and unmetered;
  with `not_found_handling: "404-page"` an unknown path gets the 404 page from the assets layer
  too. Should one reach the Worker anyway, it returns `env.ASSETS.fetch(request)`. `/mcp/`
  (trailing slash) is the endpoint too; any other `/mcp/*` path is a JSON 404, and methods other
  than POST (and OPTIONS) on `/mcp` are 405 with `Allow`. The entry module exports only the
  handler: workerd rejects other named exports. An e2e test covers the 404 page, `/mcp` and the
  home page on the preview URL.
- **Service worker:** `/mcp` is already outside it (`navigateFallbackAllowlist` is `/` only and
  nothing is cached at runtime). PR 4 adds `/^\/mcp/` and `/^\/\.well-known\//` to
  `navigateFallbackDenylist` as a guard, and a PWA e2e test that a fetch to `/mcp` from the
  installed app reaches the network.
- **Deploys:** still one Worker named `room-planner`, so the Workers Builds warning in
  `docs/DEPLOY.md` about a second Worker does not apply. Branch previews get a working `/mcp`.
- **Logging:** the Worker never logs a request body or a plan. Observability keeps Cloudflare's
  request metadata only.

### Discovery

- `GET /mcp/server-card` returns the MCP Server Card (SEP-2127, media type
  `application/mcp-server-card+json`, `$schema` the v1 card schema): name, title, description (at
  most 100 characters), version, website, repository, icon, and the remote
  `{ type: "streamable-http", url: "https://room-planner.andrechek.com/mcp",
supportedProtocolVersions }`, which lists 2026-07-28 and the 2025-era revisions.
- `/.well-known/ai-catalog.json` (and the same document at `/.well-known/ard.json`) is a static
  asset built from `scripts/discovery.mjs`, whose first entry points at the card, served as
  `application/ai-catalog+json` with `Access-Control-Allow-Origin: *`. A static copy of the card is
  at `/.well-known/mcp/server-card.json`. The full list of discovery files is in docs/DEPLOY.md,
  "Discovery for agents".
- `llms.txt` gains an "For AI agents" section with the endpoint and one line per tool.
- A page `/agents/` explains how to add the server to a client and repeats the privacy statement.
- The official MCP Registry gets a `server.json` (repository root) named
  `com.andrechek.room-planner/mcp`, a name the owner approved, proven over HTTP: the registry
  fetches the public key at `/.well-known/mcp-registry-auth` on `room-planner.andrechek.com` and
  grants exactly `com.andrechek.room-planner/*` (no DNS change). The record is a static
  `text/plain` asset, so it never invokes the Worker, and the service worker neither precaches nor
  answers it. `server.json` is the one source of the server's identity: name,
  version (its own, starting at 1.0.0, not the site's), title, a description within the
  registry's 100 characters, `websiteUrl` (`/agents/`), `repository`, icons (the brand SVG, and
  PNGs at 192 and 512 px, absolute https URLs with `mimeType` and `sizes`; the indigo tile reads
  on light and dark, so no `theme`), and the remote. The Worker's `initialize` serverInfo and the
  server card read the same fields, and a unit test checks all three agree.
- **Publishing is automatic** (`.github/workflows/mcp-registry.yml`): a merge that bumps
  `server.json`'s `version` is validated, skipped if the registry has that version, held until
  production's server card serves it and production serves exactly the committed proof record,
  then published with `mcp-publisher login http` and the `MCP_REGISTRY_PRIVATE_KEY` secret (the
  first publish needs no manual login either). `mcp-publisher` is pinned (v1.8.8) and
  checksum-verified. Pull requests run `mcp-publisher validate` and check offline that the secret
  is the private half of the committed record (skipped on forks, which get no secrets). Key
  rotation is in docs/DEPLOY.md. The fallback that needs no secret is GitHub OIDC under
  `io.github.EricAndrechek/room-planner` (the registry grants `io.github.<owner>/*` with the
  owner's own capitals, case-sensitively), a separate entry.

### Privacy statement

For `/agents/`, the help page and the FAQ (the server card's description is capped at 100
characters):

> The MCP server processes each plan in memory to answer the request and then discards it. It
> stores no plans, has no accounts, and does not log plans. For usage analytics it sends PostHog
> the tool name, the plan's size and issue counts, the client app's name, the request's headers
> (such as the user agent and language, never credentials), its IP address and Cloudflare's
> location and network data for it, like the website's own analytics; never plan content, names
> or links. A plan link it returns holds the whole plan in the part of the URL after `#`, which
> browsers do not send to any server.

`llms.txt` and the FAQ said plans are never uploaded. PR 4 changes that to: never uploaded by the
app; sent to the MCP server only when an AI assistant is asked to use it (footer, home page, FAQ,
help and llms.txt; the statement above is `MCP_PRIVACY` in `src/lib/site.ts`).

### Analytics

The Worker reports usage to the site's PostHog project (`worker/analytics.ts`), so the owner can
see whether and how the server is used. No other server-side analytics exist beyond Cloudflare's
own Worker metrics.

- **Events:** `mcp_initialize` (2025-era `initialize`, or `server/discover`), `mcp_tool_called`
  (`tool`, `ok`, `error_kind` from a fixed list (`invalid_plan`, `unsupported_plan`,
  `damaged_link`, ...), `issues_error` / `issues_warning` / `issues_info`, `issue_codes`,
  `rooms`, `items`, `unit`, `duration_ms`), `mcp_resource_read` (`uri`), `mcp_rate_limited`. Every
  event carries `client_name` / `client_version` (from `clientInfo`: on `initialize`, and on every
  2026-07-28 request; 2025-era tool calls do not name their client), `client_kind`, `protocol`,
  `ua_family` (a coarse class such as `claude`, `openai`, `node`; never the raw user agent),
  `country` (from `request.cf`), `environment` (`production`, or `preview` on workers.dev, which
  the project's test-account filter already excludes) and `$lib_version` (the server version).
  `tools/list` and `ping` send nothing.
- **Request context:** the request's headers as `h_*` properties (`h_user_agent`,
  `h_accept_language`, `h_origin`, `h_mcp_protocol_version`, ...), values cut to 512 characters,
  except a denylist: `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, and any
  header whose name contains `token`, `secret`, `key`, `auth`, `session`, `signature` or
  `password`. Cloudflare's `request.cf` adds `cf_city`, `cf_region`, `cf_region_code`,
  `cf_postal_code`, `cf_country`, `cf_continent`, `cf_latitude`, `cf_longitude`, `cf_timezone`,
  `cf_asn`, `cf_as_organization`, `cf_colo`, `cf_http_protocol` and `cf_tls_version`. A Worker's
  own fetch to PostHog carries none of the caller's headers, so they travel as properties.
- **Location:** the caller's IP (`CF-Connecting-IP`) also goes to PostHog as `$ip`, so its GeoIP
  fills city, region and country, as for the website's analytics (the owner's choice).
  `client_kind` is `hosted` for clients that call from their vendor's servers (Claude's
  connectors on the web and desktop, ChatGPT), whose location is the vendor's datacentre, and
  `local` otherwise (Claude Code, Cursor, VS Code, the Inspector). The network is the strongest
  signal (`cf_as_organization` of a cloud or AI provider means hosted), then the client's name and
  user agent. The dashboard splits location by it.
- **Never sent:** plan content, names, labels, coordinates, links, or the denied headers.
  `$process_person_profile: false`: no person profiles.
- **Identity:** a host-provided anonymous id when there is one, hashed and prefixed by its source:
  ChatGPT's `_meta["openai/subject"]` (`chatgpt_…`), else its `_meta["openai/session"]`
  (`chatgptsession_…`), else an `Mcp-Session-Id` header (`mcpsession_…`; this stateless server
  issues none, but a proxy might). Otherwise a hash of IP, user agent and client name, with
  `id_source: 'fallback'`. All users of a hosted client share its egress addresses, so without a
  host id they cannot be told apart: count calls, not people (the dashboard says so).
- **Never in the way:** the body is parsed once (and handed to the SDK as `parsedBody`); events are
  built and posted in one batch to `us.i.posthog.com/batch/` inside `ctx.waitUntil`, after the
  response body has finished (a 2025-era answer is a stream that ends when the tool does). A
  failing or slow PostHog costs only the events; a unit test proves it. Local development sends
  nothing.
- **Dashboards:** "Room Planner MCP" in PostHog (calls per day by tool and by client, error rate,
  issues per plan, location by client kind), and an MCP row on "Room Planner overview". No
  alerts.
- **Later:** link attribution (`&src=mcp` on server-made links and the viewer's button, read by the
  app into `share_link_opened` as its `source`) needs `boot.ts`, which PR 5 owns. TODO after PR 5
  merges: append it in `planLink` and read it in boot. WebMCP (PR 10) runs in the page, so its
  analytics will be client-side, through `src/lib/analytics.ts`.

### Versioning the tool API

- The endpoint is `/mcp` permanently. Tool names and output fields are only added, never renamed or
  removed.
- The input schema always shows the current plan version. Older versions keep working because tool
  input goes through `loadPlan`: an agent that cached the v4 schema keeps sending `version: 4`
  after v5 exists and gets a migrated plan back.
- `serverInfo.version` is the site's package version. The server card repeats it.

## 8. WebMCP

Built in the Agents release (PR 10, with the MCP server in one PR).

### Status of the API

Checked 2026-11-25 against the spec draft of 24 November 2026
(<https://webmachinelearning.github.io/webmcp/>), Chrome's WebMCP docs
(<https://developer.chrome.com/docs/ai/webmcp>) and chromestatus (feature 5117755740913664):

- `document.modelContext` (secure contexts) is the API. `navigator.modelContext` was the earlier
  name and is deprecated.
- `registerTool(tool, { signal, exposedTo })` returns a promise; aborting the signal is the only
  way to unregister (no `unregisterTool`, `provideContext` or `clearContext` any more).
- A tool is `{ name, title, description, inputSchema, outputSchema, execute(input, { signal }),
annotations }`, with the annotations `readOnlyHint`, `untrustedContentHint`, `consequentialHint`
  and `debugging`. `execute`'s value is serialised to JSON for the agent.
- A rejected `execute` reaches the agent as a bare `OperationError`: "tool execution errors are not
  exposed to the web". Chrome's guidance is to return actionable error text instead.
- Chrome: a dev trial behind `chrome://flags/#enable-webmcp-testing` since 146, an origin trial
  from 149 through 156, and no shipping milestone yet. No other browser has signalled support.

### Design

- **Loading.** `src/webmcp/useWebMcp.ts` is the only WebMCP code in the planner chunk (about
  0.6 KB gzip): `Planner.tsx` calls it, and when `document.modelContext ?? navigator.modelContext`
  exists it imports `register.ts`, a lazy chunk (9.8 KB gzip, the schemas included), registers the
  tools once the planner has mounted and aborts them on unmount. A refused registration is ignored.
  The service worker precaches every script, so browsers without the API fetch the chunk once
  per deploy in the background, which keeps it available offline where the API exists.
- **Older builds.** For `navigator.modelContext`, `registerTool` may return nothing or a handle,
  `unregisterTool(name)` or `provideContext({ tools })` may exist, and input may arrive as a JSON
  string; all are handled, from the older drafts (not checked against an old Chrome).
- **Edits.** `src/webmcp/tools.ts` maps each tool to the app's own edits (`src/lib/edits.ts`,
  `src/core/ops.ts`) against a small host (the planner, or a fake in tests): the working plan, one
  `history.apply` per call (one undo step), an announcement through the live region ("Assistant:
  Sofa added", spoken in place of the automatic description of that change), and a visible
  selection of what changed (the piece, door, window or room; the Set aside list for a piece set
  aside). An edit is applied only when the plan it makes passes the schema and the integrity
  checks; a call that changes nothing returns `changed: false` and adds no undo step.
- **Arguments** are in the plan's display unit (`ft` for feet and inches), as on the MCP server,
  and are checked with the plan's own schema (`src/webmcp/args.ts`). Errors come back as
  `{ error }` naming the field, never as a rejection, so the agent can fix the call.
- **Schemas.** `src/webmcp/schemas.json` holds each tool's input JSON Schema, generated from the
  Zod schemas with `z.toJSONSchema(..., { io: 'input' })`; the chunk imports the JSON, so the
  generator never reaches the browser. A unit test fails when it is stale; regenerate it with
  `UPDATE_WEBMCP_SCHEMAS=1 pnpm test src/webmcp`.

| Tool             | App action                                                             | Hints                                    |
| ---------------- | ---------------------------------------------------------------------- | ---------------------------------------- |
| `get_plan`       | the working plan in the display unit, a summary and the issues         | read-only, untrusted content (user text) |
| `check_layout`   | `checkLayout`, the same issues the plan shows                          | read-only                                |
| `add_item`       | add furniture at a point, in a free spot (`place: true`), or set aside |                                          |
| `update_item`    | label, size, colour, shape and cut, notes, lock, hide, move, turn      |                                          |
| `set_aside_item` | take a piece off the plan                                              |                                          |
| `place_item`     | put a piece set aside back, at a point or in a free spot               |                                          |
| `remove_item`    | delete a piece                                                         |                                          |
| `add_opening`    | a door or window on a room's wall (a free spot when none is given)     |                                          |
| `update_opening` | wall, offset, width; for doors type, hinge and swing                   |                                          |
| `remove_opening` | delete a door or window                                                |                                          |
| `add_room`       | a rectangular room against a free side of another room                 |                                          |
| `update_room`    | rename, or move with its contents (refused if it would overlap a room) |                                          |
| `remove_room`    | delete a room; its furniture is set aside                              |                                          |
| `replace_plan`   | replace the whole plan, after the app's confirm dialog                 | consequential                            |

- **Confirmation.** `replace_plan` sets `consequentialHint` and opens the app's own dialog
  ("Replace this plan with the assistant's version?", "Keep my plan" focused). The call resolves
  when the user answers; declining returns `{ error }`. It keeps the plan's name and display unit,
  and Undo brings the old plan back.
- **Rooms.** Outlines are edited only through `replace_plan`: rooms are added as rectangles beside
  another room, renamed, moved or removed.
- **Analytics.** `webmcp_tool_called` with `{ tool, ok, error_kind }` (`bad_argument`,
  `not_found`, `not_allowed`, `invalid_plan`, `declined`, `cancelled`, `failed`), and
  `webmcp_available` once per page load with `{ api, tools }` (a count). Never plan content.
- **Testing.** Unit tests call each tool against a fake host and register them with a fake
  `modelContext` (both names, abort, refusals, undo). `e2e/webmcp.spec.ts` injects a fake
  `document.modelContext`, adds a piece (selected, announced, removed by Undo) and replaces the
  plan (confirmed, undone; declined).

## 9. UX implications

This section scopes the UI work; it is not a visual design. The phone bottom sheet from issue #32
is assumed to exist: on a phone, every panel below lives in the sheet with the plan visible above.

**The two steps stay.** "Room Setup" becomes "Rooms" and "Furniture" keeps its name. Nothing moves
for a user with one rectangular room: Width and Length are still the first two fields.

**Drawing a room that is not a rectangle.**

- The Rooms step gets a Shape control: Rectangle, L-shape, or Custom. L-shape asks for the overall
  width and length and the size of the cut-out corner, which is four fields and covers most real
  cases with no drawing.
- Custom shows a corner handle at every vertex and a "+" handle at the middle of every wall. Drag a
  corner to move it; tap "+" to add a corner; select a corner and press Delete (or its remove
  button) to remove it. Corners snap to 90° and 45° relative to their neighbours and to whole units.
- Every wall has a row in the panel with its length and angle as fields. Typing a length moves the
  wall's far corner along the wall's direction. This is the keyboard and screen-reader path, and
  the precise path on a phone, where dragging a corner under a finger is coarse.
- Corner handles are focusable. Arrow keys move the focused corner by the nudge step, with the same
  fine and coarse modifiers as furniture, and the live region announces the two adjacent wall
  lengths.
- An outline that crosses itself is refused while dragging: the corner stops at the last valid
  position, and the announcement says why.
- Doors and windows choose their wall from the list ("Wall 3, 9 ft") instead of Top / Right /
  Bottom / Left. Rectangles keep the four names.

**Furniture shapes.** The furniture card gets a Shape control: Rectangle, L-shape, Round. L-shape
adds the two cut fields and a Flip button that moves the cut to the next corner. Round has Width
and Depth; equal values give a circle. Resizing, rotating, snapping and colour work as they do now.

**Inventory.** A collapsible "Not placed" tray at the bottom of the Furniture list, with a count.
Each placed piece's card gets "Take out of room"; each tray piece gets "Place", which puts it in
the free spot nearest the middle of the room in view. On desktop a piece can also be dragged
between the canvas and the tray. Pieces in the tray keep their size, colour and name, appear in
exports as a list under the drawing, and never warn. Deleting stays a separate action. The shipped UI
calls this "Set aside": a toggle "In the room · Set aside (n)" at the top of the Items step, and a
piece goes back onto the plan by dragging it there or tapping Place and then the plan.

**Several rooms.**

- "Add room" in the Rooms step places a new rectangle against the right side of the plan.
- In the Rooms step a room can be selected and dragged by its floor. Its walls snap flush to other
  rooms' walls and its corners to their corners. Its furniture moves with it. Arrow keys nudge the
  selected room.
- A door on a wall segment that two rooms share is drawn once and belongs to both. Its card names
  both rooms ("Bedroom to Hallway").
- The Rooms panel lists rooms; selecting one shows its fields. The Furniture list groups pieces
  under room names. Each room has a name field, shown at the top of the room on the canvas.
- "Fit" fits the whole floor. Choosing a room in the list zooms to it. This matters on a phone.
- Deleting a room moves its furniture to the inventory, in one undo step.

**Exports** draw the whole floor on one page, with room names and each room's area, then the
inventory list.

## 10. Phased plan

Each PR is shippable on its own and leaves nothing half-visible. Effort is for one agent with
review: S is under a day, M is one to two days, L is three to five.

Status (2026-11-25): PRs 1, 2, 3, 5, 7a, 7b, 8 and 9 are merged. PR 4 (the MCP server, with 6
folded in) and PR 10 (WebMCP) ship together as the Agents release, PR #40, with the MCP server
brought up to the whole format (every valid plan gets an edit link) and a fix for installed apps
that stayed on old builds (a waiting service worker takes over at the next start, before the
planner mounts).

| PR  | Scope                                                                                                                                                                                             | Visible to users                        | Depends on | Effort | Risk   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------- | ------ | ------ |
| 1   | Core extraction: move the pure modules into `src/core/`, split React style helpers out of `openings.ts`, split `scene.ts` into rooms and items files, ESLint boundary. No behaviour change.       | nothing                                 | none       | M      | low    |
| 2   | Schema and migrations, unused by the app: `schema.ts`, `migrate/`, `load.ts`, `toFeet`, compact share codec, every fixture, property tests. The "needs a newer version" dialog on all read paths. | nothing (the dialog cannot trigger yet) | 1          | M      | low    |
| 3   | Core on `Plan`: `wallFrame`, `itemParts`, `checkLayout`, `ops.ts`, placement and scene take a `Plan`. The app keeps its v3 state and calls core through `planFromLayout`. Golden SVG tests.       | nothing                                 | 2          | L      | medium |
| 4   | MCP server: Worker, `create_plan`, `check_layout`, `read_plan`, the MCP Apps plan viewer, rate limit, CORS, server card, `/agents/` page, llms.txt, privacy text, PWA denylist.                   | new `/agents/` page                     | 3          | M      | medium |
| 5   | App state on v4: history holds a `Plan`, new storage keys with the legacy recovery, links and JSON written in v4, guide examples as plans. Removes `planFromLayout` and the old types.            | nothing (shorter links)                 | 3          | L      | high   |
| 6   | Folded into PR 4: the plan viewer (MCP Apps) instead of a PNG `render_plan`. A PNG (resvg, Workers Paid) only if clients without MCP Apps turn out to matter.                                     | no                                      | 4          | -      | -      |
| 7a  | Furniture shapes: L and round in the card, the canvas, the export.                                                                                                                                | yes                                     | 5          | M      | medium |
| 7b  | Room shapes: Shape control, L-shape fields, custom outline editing, wall list, openings on any wall.                                                                                              | yes                                     | 5          | L      | high   |
| 8   | Inventory: tray, take out, place, export list.                                                                                                                                                    | yes                                     | 5          | M      | low    |
| 9   | Several rooms: add, move, snap together, shared walls and doors, grouped lists, whole-floor export and fit.                                                                                       | yes                                     | 7b, 8      | L      | high   |
| 10  | WebMCP: lazy chunk, fourteen tools, confirm dialog, generated schemas.                                                                                                                            | only in Chrome with the feature         | 9          | M      | low    |

### Test strategy per PR

| PR  | Tests                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The existing unit and e2e suites pass with no edits except import paths. The planner chunk size is within 1%.                                                                                                                   |
| 2   | Fixture tests for every row of the table in section 4, the property tests listed there, a chunk-size check (the schema stays out of the planner chunk, which grows only by the read-path checks: +0.46 KB gzip).                |
| 3   | SVG export byte-identical to `main` for every fixture and guide example. Warnings identical. The existing snapping, openings and placement tests pass through the adapter.                                                      |
| 4   | Worker unit tests through the handler with both protocol eras. e2e on the preview URL: 404 page, `/mcp` call, CORS preflight, 429. A server-made link opened in the app; the viewer under a test host. CSP and PWA e2e passing. |
| 5   | Storage migration e2e from each storage fixture. Rollback and recovery test. Old and new links open. Two-tab test. A newer-version plan in storage survives a save untouched.                                                   |
| 6   | Only if a PNG is ever added: PNG decodes, has the expected size and is not blank. CPU time logged in a preview deploy.                                                                                                          |
| 7–9 | Geometry unit and property tests per shape, e2e for each new control on desktop and phone projects, axe checks, keyboard-only e2e for outline editing.                                                                          |
| 10  | Fake `modelContext` unit tests and one e2e, as in section 8.                                                                                                                                                                    |

### What can run in parallel

- **PR 4 and PR 5** after PR 3. PR 4 owns `worker/**`, `wrangler.jsonc`, `public/_headers`,
  `pwa-options.mjs`, `src/pages/agents.astro`, `src/pages/llms.txt.ts`, and the privacy wording in
  `help.astro` and `faq.astro`. PR 5 owns `src/hooks/**`, `src/components/**`, `src/lib/storage.ts`,
  `boot.ts`, `projects.ts`, `src/lib/guides/**` and `src/types.ts`. Neither edits `src/core/**`
  except to fix a bug, in its own commit.
- **PR 7a, PR 7b and PR 8** after PR 5. 7a owns `FurnitureCard.tsx`, `FurniturePiece.tsx`,
  `FurniturePanel.tsx`, `core/geometry/shapes.ts` and `core/render/scene/items.ts`. 7b owns
  `RoomSetupPanel.tsx`, `RoomCanvas.tsx`, `Openings.tsx`, `useOpenings.ts`, `core/geometry/walls.ts`
  and `core/render/scene/rooms.ts`. PR 8 also needs `FurniturePanel.tsx`, so it starts when 7a has
  merged, or takes the tray as a new component file and adds one line to the panel.
- **PR 6** is folded into PR 4.
- PRs 1, 2 and 3 are strictly in order. PR 9 and PR 10 are last and in order.

The phone bottom sheet (issue #32) touches `Sidebar.tsx`, `Planner.tsx` and the mobile e2e specs.
PR 5 also edits `Planner.tsx`; whichever merges second rebases. PRs 1 to 4 do not conflict with it.

## 11. Risks and open questions

Each has a recommendation. The first was the owner's decision and is settled.

1. **Workers Paid for PNG images (decided: no).** The account is on Free; a PNG needs 30 to 65 ms
   of CPU and Free allows 10 ms. The owner declined Workers Paid, so the MCP server shows plans
   through the MCP Apps viewer (section 7) and gives every client the link. Revisit a PNG only if
   usage shows that clients people use lack MCP Apps.
2. **Free-plan limits without the image tool.** Tool calls measured about 1 ms of CPU, well inside
   10 ms. Free also caps Worker invocations at 100,000 per day; requests for missing pages count,
   site assets do not. Recommendation: accept, and watch the invocation count after PR 4.
3. **PR 5 is the risky one.** It changes what is in every user's storage. Recommendation: the old
   keys are never written (section 4), the PR ships alone, and its storage tests run against every
   storage fixture on all three browser engines before merge.
4. **Stale installed copies and v4 links.** A copy older than PR 2 ignores a v4 link without
   saying anything. Recommendation: keep at least two weeks between PR 2 reaching production and
   PR 5, and do not change the hash key (a new key would be ignored just the same).
5. **Language models miscopy long links.** Recommendation: the compact form, the link alone on the
   last line of the text, and the link in `structuredContent`. A damaged link already fails to
   decode and opens the user's own plan; PR 2 adds a "this link is damaged" message.
6. **Wall thickness between rooms.** Rooms abut with no thickness, so a floor is a little narrower
   than the building. Recommendation: accept. Because shared walls are derived, treating a gap of
   up to a foot as a shared wall later needs no format change.
7. **A piece across a doorway between rooms** (a rug) reports "outside room". Recommendation:
   accept for the first version; it is today's rule.
8. **Ellipse precision.** A 32-sided polygon is up to 0.5% inside the true curve (0.1 in on a
   4 ft table). Recommendation: accept; it only affects warnings, and drawing uses true ellipses.
9. **`hidden` and the inventory overlap in purpose.** Recommendation: keep both in the format,
   and decide in PR 8 whether the eye button stays in the UI.
10. **Zod's classic API imported by mistake** would add 17 KB gzip. Recommendation: the lint rule
    in section 2 and the chunk-size check in PR 2.
11. **WebMCP is still in origin trial** and has already been renamed once. Recommendation: it stays
    last, behind feature detection, in its own chunk; re-check the API when PR 10 starts.
12. **The MCP spec moves.** 2026-07-28 removed sessions and the handshake. Recommendation: stay on
    the official SDK's `createMcpHandler`, which serves both eras, and pin its version.
13. **Registry listing** depends on a signing key the owner holds (a repository secret).
    Recommendation: the workflow publishes on merge and checks the key on every PR; if the key is
    lost, rotate it (docs/DEPLOY.md) or fall back to GitHub OIDC; nothing in the plan waits for
    it.

## 12. Spikes

The scripts are kept outside the repository, on the machine that produced this document, in a
`spikes/` folder. They are not committed.

| Folder      | What it measures                                                                                                        | Run                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `bundle/`   | Planner chunk size per schema library (`build-variants.sh`); JSON Schema output and validation cost (`spike/bench.ts`). | `./build-variants.sh`, `node --experimental-strip-types spike/bench.ts` |
| `links/`    | The four sample plans (`samples.mjs`), the eight encodings (`encodings.mjs`), lengths and QR versions (`measure.mjs`).  | `node measure.mjs`                                                      |
| `render/`   | SVG to PNG with resvg-wasm: wasm size, start-up, CPU per image, font formats (`png.mjs`).                               | `node png.mjs`                                                          |
| `mcp/`      | A stateless Worker with the official SDK and the shared schema: bundle size, both protocol eras, CPU per call.          | `node run.mjs`                                                          |
| `geometry/` | Convex-part SAT and room containment: nine correctness checks, cost per check, size against `polygon-clipping`.         | `node bench.mjs`                                                        |

The Workers plan and the zone's bot settings were read with the `cf` CLI
(`cf accounts subscriptions get`, `cf bot-management get`); nothing was changed.
