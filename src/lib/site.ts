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
 * Plan links (src/core/share/planParam.ts): a plan any assistant can write as a link, with no
 * tools. One example (checked by src/lib/planLinkExample.test.ts to open with no issue above
 * "info"), and the format in a few lines, mirroring the MCP tools' description
 * (worker/descriptions.ts). Not published on the site yet: the owner is still choosing how
 * assistants without tools should hand over a plan, so the reader exists but is not advertised.
 */
export const PLAN_LINK_EXAMPLE = {
  name: 'Bedroom',
  unit: 'ft',
  rooms: [
    {
      name: 'Bedroom',
      outline: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 11 },
        { x: 0, y: 11 },
      ],
      openings: [
        { kind: 'door', wall: 2, offset: 1, width: 3 },
        { kind: 'window', wall: 0, offset: 4, width: 4 },
      ],
    },
  ],
  items: [
    { label: 'Queen bed', width: 5, depth: 6.7, placement: { x: 6, y: 3.35 } },
    { label: 'Nightstand', width: 1.7, depth: 1.3, placement: { x: 2.65, y: 0.65 } },
    { label: 'Dresser', width: 5, depth: 1.5, placement: { x: 4.5, y: 10.25 } },
  ],
} as const;

export const PLAN_LINK_FORMAT = [
  'Lengths are in `unit` ("ft", "in", "m" or "cm"; default "ft"). x grows right, y grows DOWN; put the top-left corner of the floor at {"x":0,"y":0}.',
  'rooms: [{name, outline:[{x,y},...], openings:[...]}]. outline lists the corners clockwise as drawn; a W × D rectangle is [{"x":0,"y":0},{"x":W,"y":0},{"x":W,"y":D},{"x":0,"y":D}], and its walls are 0 = top, 1 = right, 2 = bottom, 3 = left (wall i runs from corner i to corner i+1). A room may also be given as {name, width, depth, x?, y?}.',
  'Several rooms share a wall by touching (no gap, no wall thickness): a room right of a 12-wide room starts at x = 12. A door on a shared wall, listed once, connects the two rooms.',
  'openings: {kind:"door"|"window", wall, offset, width}; offset runs along the wall from its start corner, clockwise (left to right on the top wall, right to left on the bottom wall). Doors may have type "swing-in" (default), "swing-out", "sliding", "pocket", "double-in", "bifold" or "opening".',
  'items: [{label, width, depth, placement:{x, y, rotation}}]: width along x, depth along y; placement is the CENTRE of the piece, rotation clockwise degrees. Optional: shape "ellipse" (round), or "l" with cut:{corner:"tl"|"tr"|"br"|"bl", width, depth}; color "#rrggbb". Leave out placement to set a piece aside.',
  'Optional: "name" for the plan, "version": 4, ids (made up when missing). Up to 16 KB of JSON.',
] as const;

/** The example as a link on `origin` (raw JSON, as an assistant would write it). */
export const planLinkExample = (origin: string): string =>
  `${new URL('/', origin).toString()}#plan=${JSON.stringify(PLAN_LINK_EXAMPLE)}`;
