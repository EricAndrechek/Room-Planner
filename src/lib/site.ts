/** Site-wide metadata used by the Astro pages (no personal names: the brand is "Room Planner"). */
export const SITE_NAME = 'Room Planner';
export const SITE_ALT_NAME = 'RoomPlanner';
export const DEFAULT_TITLE = 'Room Planner — Free Online Room Layout & Furniture Planner';
export const DEFAULT_DESCRIPTION =
  'Plan your room layout for free in your browser. Set room dimensions, add doors, windows and furniture, drag and rotate pieces, and share your floor plan with a link. No sign-up — your data stays on your device.';
export const THEME_COLOR = '#4f46e5';
export const OG_IMAGE = {
  path: 'og-image.png',
  width: 1200,
  height: 630,
  alt: 'Room Planner — drag-and-drop floor plan editor',
};

/**
 * What the planner does, in plain words. One list for the home page's static text, the
 * WebApplication `featureList` (JSON-LD), llms.txt and the FAQ, so they always agree.
 */
export const FEATURES = [
  'Room dimensions in feet and inches, decimal feet, inches, meters or centimeters',
  'Whole floor plans: several connected rooms, with doors between them',
  'Doors on any wall: swing in or out, double (French), sliding, pocket, bi-fold or an open doorway',
  'Windows on any wall',
  'Drag, resize, rotate, duplicate and lock furniture, with exact sizes and positions',
  'Set pieces aside and drop them back exactly where you want them',
  'Snapping to walls and other pieces, with clear-distance labels',
  'Warnings for overlapping pieces, pieces outside the room and furniture that blocks a door',
  'Several floor plans, saved automatically in your browser',
  'Share links that carry the whole layout',
  'Export as a PNG image or PDF (A4 or Letter), or print',
  'Works offline and installs as an app (PWA)',
  'An MCP server, so AI assistants can lay out a room and hand you a link to edit it',
  'Undo and redo, keyboard shortcuts, and a touch-friendly phone layout',
] as const;

/** The MCP server's endpoint, relative to the site (worker/http.ts). */
export const MCP_PATH = 'mcp';

/**
 * What the MCP server does with a plan (docs/design/plan-format.md, section 7): one wording for
 * /agents/, the help page and the FAQ.
 */
export const MCP_PRIVACY =
  "The MCP server processes each plan in memory to answer the request and then discards it. It stores no plans, has no accounts, and does not log plans. For usage analytics it sends PostHog the tool name, the plan's size and issue counts, the client app's name, the request's headers (such as the user agent and language, never credentials), its IP address and Cloudflare's location and network data for it, like the website's own analytics; never plan content, names or links. A plan link it returns holds the whole plan in the part of the URL after #, which browsers do not send to any server.";

/**
 * Readable plan links (`#p=`, src/core/share/readable.ts; docs/design/plan-format.md, section 5):
 * the syntax in a few lines for assistants with no tools and no code, and two examples, checked by
 * src/lib/readable.test.ts and e2e/plan-links.spec.ts.
 */
export const READABLE_EXAMPLES = {
  bedroom:
    'ft;room:Bedroom:12x11;door:bottom:8:3;window:top:4:4;item:Queen_bed:5x6.7@6,3.35;item:Nightstand:1.7x1.3@2.65,0.65;item:Dresser:5x1.5@4.5,10.25',
  flat: 'ft;name:Flat;room:Living_room:14x12;door:right:8:2.7;door:bottom:1:3;window:top:4:5;room:Bedroom:10x12;window:top:3:4;item:Sofa:7x3@5,1.5;item:Coffee_table:4x2@5,5.4;item:Dining_table:3.5x3.5@11.5,4:round;item:Queen_bed:5x6.7@19,3.35;item:Wardrobe:3.3x2@21.5,11;item:Armchair:2.7x2.8',
} as const;

export const READABLE_SYNTAX = [
  'Statements are separated by `;`, fields by `:`. Use `_` for spaces in names. Only letters, digits and `- . _ ~ , ; : @ ( ) !`.',
  'Start with the unit: `ft` (default), `in`, `m` or `cm`. Every length is in it. Optional: `name:My_flat`.',
  'x grows to the right and y grows DOWN; the floor starts at 0,0.',
  '`room:<name>:<W>x<L>` is a W wide, L long rectangle. The first room is at 0,0; each next one goes to the right of the one before, sharing its wall. `@x,y` puts its top-left corner elsewhere. An odd shape: `room:<name>:x1,y1,x2,y2,...` (its corners, clockwise).',
  '`door:<wall>:<offset>:<width>` and `window:<wall>:<offset>:<width>` belong to the room before them. wall is `top`, `right`, `bottom` or `left`; offset is the distance from the left end of a top or bottom wall, or from the top end of a left or right wall. (Odd shapes: wall is a number, wall i runs from corner i to corner i+1, offset from corner i.) A door on a wall two rooms share connects them.',
  'Door options, after the width: `out` (swings out), `sliding`, `pocket`, `double`, `bifold`, `opening`; `right` hinges it on the right, seen from inside.',
  '`item:<label>:<W>x<D>@x,y` is a piece W wide (along x) and D deep, its CENTRE at x,y. `@x,y,90` turns it 90° clockwise. Leave out `@...` to set it aside.',
  'Item options: `round` (a round or oval piece), `L-tr-6x4` (an L: a 6 × 4 cut from its top-right corner; tl, tr, br, bl).',
] as const;
