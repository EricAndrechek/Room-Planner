/**
 * The plan viewer, an MCP Apps view (SEP-1865): `viewer/viewer.html`, served as a `ui://`
 * resource. Wrangler bundles the HTML as text (its default rule for `.html`); Vitest gets it the
 * same way through the plugin in vitest.config.ts.
 */
import html from './viewer/viewer.html';

export const VIEWER_URI = 'ui://room-planner/plan-viewer.html';
export const VIEWER_MIME_TYPE = 'text/html;profile=mcp-app';
/** Where a tool result carries the viewer's data (`ViewData` in tools.ts). */
export const VIEW_META_KEY = 'com.andrechek.room-planner/view';

export const viewerHtml = (): string => html;
