/**
 * What agents read: the server's instructions and the tool descriptions. They carry what a model
 * needs to write a plan cold (docs/design/plan-format.md, section 7): units, the coordinate
 * system, the rectangle recipe and its wall numbers, that `placement` is the centre, and a few
 * typical sizes and clearances. No catalogue.
 */

const FORMAT = `Plan format (version 4):
- Lengths: every length is in plan.unit: "in", "cm", "m" or "ft". Use the unit the user speaks. Answers come back in the same unit.
- Coordinates: x grows to the right, y grows DOWN (as on a screen). Put the room's top-left corner at {x:0,y:0}.
- Room: outline = interior corners, clockwise as drawn. A W x D rectangle is [{x:0,y:0},{x:W,y:0},{x:W,y:D},{x:0,y:D}]; its walls are then 0 = top, 1 = right, 2 = bottom, 3 = left (wall i runs from outline[i] to outline[i+1]).
- Door or window: in room.openings, {id, kind:"door"|"window", wall, offset, width}. offset runs along the wall from its start corner to the opening's near edge, clockwise: left to right on the top wall, top to bottom on the right wall, RIGHT TO LEFT on the bottom wall, BOTTOM TO TOP on the left wall. Doors: type "swing-in" (default), "swing-out", "double-in", "double-out", "sliding", "pocket", "bifold" or "opening"; hinge "start" (default) or "end", where "start" is on the left seen from inside the room facing the wall.
- Furniture: plan.items, {id, label, width, depth, placement:{x, y, rotation}}. width is along x and depth along y before rotation; placement is the CENTRE of the piece and rotation is clockwise degrees (90 swaps the footprint). A piece against the top wall has y = depth/2; against the left wall, x = width/2. Optional: color "#rrggbb", locked, hidden, notes.
- ids: unique strings in the whole plan, e.g. "room-1", "door-1", "bed".
Typical sizes, inches (width x depth): queen bed 60x80, king 76x80, twin 38x75, nightstand 20x16, dresser 60x18, wardrobe 40x24, 3-seat sofa 84x36, armchair 32x34, coffee table 48x24, TV stand 60x18, dining table for 4 48x30 (for 6 72x36), dining chair 18x20, desk 48x24, desk chair 24x24, bookcase 36x12. Interior doors 30-36 wide; windows 24-48.
Clearances, inches: 30-36 for walkways, 24 beside a bed, 16-18 between a sofa and a coffee table, 36 behind dining chairs; keep door swings clear.`;

export const INSTRUCTIONS = `Room Planner (https://room-planner.andrechek.com) is a free floor-plan editor in the browser. These tools let you lay out a room for the user: write the plan as JSON, check it, and give the user a link that opens it in the editor, where they can drag, rotate, measure, export and share.
Workflow: write the plan; call check_layout and fix what it reports (repeat as needed); then call create_plan once and give the user its url exactly as returned (the whole plan is in the link). To change a plan the user already has, call read_plan with their link, edit the JSON, and call create_plan again.
Nothing is stored: every call takes the whole plan. The plan format is in the create_plan and check_layout descriptions.`;

export const CREATE_PLAN = `Make a Room Planner plan and the link that opens it in the editor (https://room-planner.andrechek.com), where the user can see it to scale, drag and rotate the furniture, export and share. In clients with MCP Apps the drawing is shown in the chat, with the problems marked.
Returns {plan, issues, summary, url, editable}: the plan normalised (defaults and ids filled) in your unit, every layout issue (as check_layout), one paragraph describing it, and the url. Give the user the url exactly as returned, whole and unchanged; it holds the entire plan.
Every plan the format allows is accepted, checked and drawn: several rooms, any outline, L-shaped and round pieces, pieces in the inventory. The edit link comes when Room Planner's editor can open the plan (today: one rectangular room whose pieces are all rectangles with a placement); otherwise url is null, editable is false and notEditable says why.

${FORMAT}`;

export const CHECK_LAYOUT = `Check a Room Planner plan for layout problems, without making a link. Cheap: call it as often as you like while arranging, then call create_plan once.
Reports, each as {code, severity, message, ids}: item_overlap and item_outside_room (errors); door_blocked (a piece in a door's swing or track), doorway_blocked, opening_overlap, opening_off_wall, room_overlap and unknown_field (warnings, unknown_field for a key the format does not have, usually a typo); tight_clearance (info: a gap above zero but below minClearance, default 24 in / 61 cm). ids name the piece first, then what it collides with. Returns {ok, issues, summary}; ok is true when nothing is an error or a warning.
minClearance is in the plan's unit.

${FORMAT}`;

export const READ_PLAN = `Read the plan in a Room Planner link that the user gives you: any link from room-planner.andrechek.com (#s=, #j= or the older ?config= form). Returns {plan, summary, issues, url, editable}, the plan in the unit it is displayed in, ready to edit and send to create_plan for a new link. In clients with MCP Apps the drawing is shown in the chat.
A link that was cut off when it was copied returns an error; ask the user for the whole link.`;
