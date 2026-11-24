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
  'Doors on any wall: swing in or out, double (French), sliding, pocket, bi-fold or an open doorway',
  'Windows on any wall',
  'Drag, resize, rotate, lock and hide furniture, with exact sizes and positions',
  'Snapping to walls and other pieces, with clear-distance labels',
  'Warnings for overlapping pieces, pieces outside the room and furniture that blocks a door',
  'Several floor plans, saved automatically in your browser',
  'Share links that carry the whole layout',
  'Export as a PNG image or PDF (A4 or Letter), or print',
  'Works offline and installs as an app (PWA)',
  'Undo and redo, keyboard shortcuts, and a touch-friendly phone layout',
] as const;
