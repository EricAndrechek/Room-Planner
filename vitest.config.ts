import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The Worker imports its MCP Apps view as text, as Wrangler's default `.html` rule does. The
  // view is built fresh (scripts/build-viewer.mjs), so tests never see a stale one.
  plugins: [
    {
      name: 'html-as-text',
      enforce: 'pre',
      // The built view may not exist yet: it is made in `load`.
      async resolveId(source, importer) {
        if (!source.endsWith('viewer/dist/viewer.html') || !importer) return null;
        const { dirname, resolve } = await import('node:path');
        return resolve(dirname(importer.split('?')[0]), source);
      },
      async load(id) {
        if (!id.endsWith('.html')) return null;
        const { viewerHtml, VIEWER_OUT } = await import('./scripts/build-viewer.mjs');
        const { readFile } = await import('node:fs/promises');
        // The id may come root-relative (`/worker/...`) when the file does not exist yet.
        const isViewer = id === VIEWER_OUT || id.endsWith('/worker/viewer/dist/viewer.html');
        const text = isViewer ? await viewerHtml() : await readFile(id, 'utf8');
        return `export default ${JSON.stringify(text)};`;
      },
    },
  ],
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    environment: 'node',
  },
});
