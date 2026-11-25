/**
 * The plan viewer, an MCP Apps view (SEP-1865), served as a `ui://` resource: the template
 * viewer/viewer.html with viewer/app.ts bundled in, built by scripts/build-viewer.mjs into
 * viewer/dist/viewer.html (Wrangler's custom build runs it first). Wrangler bundles the HTML as
 * text (its default rule for `.html`); Vitest gets it through the plugin in vitest.config.ts.
 */
import html from './viewer/dist/viewer.html';

export const VIEWER_URI = 'ui://room-planner/plan-viewer.html';
export const VIEWER_MIME_TYPE = 'text/html;profile=mcp-app';

export const viewerHtml = (): string => html;
