/**
 * What agents read: the server's instructions and the tool descriptions, loaded into the model's
 * context on every turn, so each fact is said once (docs/design/plan-format.md, section 7). Each
 * tool's first sentence is when to use it. create_plan's description carries the least a model
 * needs to write a plan (FORMAT_ESSENTIALS), since some clients drop the server's instructions;
 * the instructions carry the workflow and the rest (FORMAT_DETAILS: several rooms, shapes, typical
 * sizes and clearances); check_layout and read_plan point at create_plan. Field-level facts (one
 * line each) are in the JSON Schema (src/core/schema.ts).
 */

/**
 * The least a model needs to write a plan correctly, in create_plan's own description (a client
 * may not show the server's instructions).
 */
export const FORMAT_ESSENTIALS = `Plan format (version 4): {version:4, name, unit, rooms, items}. Every length is in unit (use the user's). One floor coordinate system: x grows right, y grows DOWN; the floor's top-left corner at {x:0,y:0}.
- Room outline: interior corners, clockwise. A W x D rectangle at (X,Y) is [{x:X,y:Y},{x:X+W,y:Y},{x:X+W,y:Y+D},{x:X,y:Y+D}], walls 0 top, 1 right, 2 bottom, 3 left; wall i runs from outline[i] to outline[i+1].
- Opening offset runs clockwise from the wall's start corner to the opening's near edge (RIGHT TO LEFT on a bottom wall, BOTTOM TO TOP on a left wall), or from the end named by from ("left"/"right"/"top"/"bottom" as seen on the plan, or "end"): a door 2 ft from the bottom of the right wall is {wall:1, offset:2, from:"bottom"}.
- Item placement {x, y, rotation} is the CENTRE of the piece, rotation clockwise degrees; width runs along x and depth along y before rotation. No placement: set aside (kept, off the floor).`;

/** The rest of the format, with typical sizes and clearances: in the server's instructions. */
export const FORMAT_DETAILS = `More on the plan:
- Several rooms share a wall by touching, with no gap and no wall thickness (a hall right of a 12 x 10 bedroom at the origin starts at x = 12), and must not overlap. A door on a shared wall connects the two rooms: list it once, in either room. Windows go on outside walls. An L-shaped room has 6 corners. A piece belongs to the room it stands in.
- Against a top wall a piece's y = top + depth/2; against a left wall x = left + width/2. ids are unique strings, e.g. "bedroom", "door-1", "bed".
- Shapes: "ellipse" (a round table has width = depth), or "l" with cut {corner, width, depth}, removed from that corner before rotation (an L sofa 108 x 84 in with cut {corner:"tr", width:72, depth:48}). Set aside a piece the user has but has not placed, or an alternative.
Typical sizes, in (width x depth): queen bed 60x80, king 76x80, twin 38x75, nightstand 20x16, dresser 60x18, wardrobe 40x24, 3-seat sofa 84x36, armchair 32x34, coffee table 48x24, TV stand 60x18, dining table for 4 48x30 or round 42-48, for 6 72x36, dining chair 18x20, desk 48x24, desk chair 24x24, bookcase 36x12; interior doors 30-36, windows 24-48. Rooms, ft: bedroom 10x12 to 14x16, living room 12x18, hallway 3.5-4 wide.
Clearances, in: walkways 30-36, beside a bed 24, sofa to coffee table 16-18; keep door swings and doorways clear. Dining: about 24 in (60 cm) of table edge per seat; chairs face the table and touch its edge (pieces must not overlap, so not under it) and nearly touch each other; leave 36 in (90 cm) behind them.`;

/** The whole plan format, for the room-planner Agent Skill. */
export const FORMAT = `${FORMAT_ESSENTIALS}\n${FORMAT_DETAILS}`;

export const INSTRUCTIONS = `Room Planner (https://room-planner.andrechek.com) is a free floor-plan editor in the browser. Use these tools when the user wants a room or a home laid out to scale, furniture arranged, or a "will it fit?" answer, e.g. "can I fit a king bed and two nightstands in an 11x12 bedroom?", "fit as many seats as possible around these two tables in my 20x12 dining room", "arrange my living room around this sofa and TV". Not for 3D renders or construction drawings.
Workflow: create, check, fix, present. Write the whole plan and call create_plan; it checks the layout. Fix every error and warning yourself (positions in messages are centres; keep door swings clear) and call again; check_layout is a quicker re-check while you rearrange. Present the result in a sentence or two, with the link as Markdown link text, e.g. [Open the dining room in Room Planner](url), never as a bare URL; keep it whole (it holds the plan).
Ask at most ONE clarifying question, and only when the answer changes the layout; otherwise assume sensible defaults (standard sizes; a 3 ft / 90 cm door centred on the wall the user names, swinging in), say what you assumed, and tell the user they can drag things in the planner.
To change a plan the user already has: read_plan with their link, edit the plan, create_plan. Nothing is stored; every call takes the whole plan. Prefer these tools to writing a Room Planner link by hand: the plan is checked and the link always opens.
The plan format is in create_plan's description. ${FORMAT_DETAILS}`;

export const CREATE_PLAN = `Use when the user wants to lay out, furnish, fit furniture into, or get a floor plan of a room or home: returns a checked plan, a drawing, and an editable Room Planner link. One room or a whole floor (rooms joined by doors), any outline, round and L-shaped pieces.
Returns {plan, issues, summary, url, editable}: the plan normalised in your unit, every layout issue (as check_layout), a summary, the link. Fix errors and warnings and call again before you present it. Give the url as Markdown link text, e.g. [Open the bedroom in Room Planner](url), never the bare URL; keep it whole.
${FORMAT_ESSENTIALS}`;

export const CHECK_LAYOUT = `Use to re-check a plan quickly while you rearrange it (no link, no drawing); create_plan returns the same issues with the link. The plan format is in create_plan's description.
Returns {ok, issues, summary}; ok is true when no issue is an error or a warning. Each issue is {code, severity, message, ids}, ids naming the piece first, then what it hits. Errors: item_overlap, item_outside_room (outside every room). Warnings: door_blocked (a piece in a door's swing or track), doorway_blocked (in the passage either side of a door), opening_overlap, opening_off_wall, room_overlap, window_between_rooms, unknown_field (a key the format lacks, usually a typo). Info: tight_clearance, a straight gap from 6 in / 15 cm up to minClearance (in the plan's unit, default 24 in / 61 cm) between two pieces or a piece and a wall; closer pieces (chairs at a table) are taken as meant. Messages name rooms, pieces by label (with their centre when labels repeat) and doors by where they are on the wall.`;

export const READ_PLAN = `Use when the user shares a Room Planner link, to read and modify that plan: any room-planner.andrechek.com link (#s=, #j=, #p= or the older ?config=). Returns {plan, summary, issues, url, editable}, the plan in the unit it is shown in, ready to edit and send to create_plan for a new link. A link cut off when copied returns an error: ask the user for the whole link. Clients with MCP Apps show the drawing in the chat.`;
