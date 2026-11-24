import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The Worker imports its MCP Apps view as text, as Wrangler's default `.html` rule does. The
  // view is built fresh (scripts/build-viewer.mjs), so tests never see a stale one.
  plugins: [
    {
      name: 'html-as-text',
      enforce: 'pre',
      // The built view may not exist yet: it is made in `load`.
      resolveId(source, importer) {
        if (!source.endsWith('viewer/dist/viewer.html') || !importer) return null;
        return new URL(source, `file://${importer}`).pathname;
      },
      async load(id) {
        if (!id.endsWith('.html')) return null;
        const { viewerHtml, VIEWER_OUT } = await import('./scripts/build-viewer.mjs');
        const { readFile } = await import('node:fs/promises');
        const text = id === VIEWER_OUT ? await viewerHtml() : await readFile(id, 'utf8');
        return `export default ${JSON.stringify(text)};`;
      },
    },
  ],
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    environment: 'node',
  },
});
