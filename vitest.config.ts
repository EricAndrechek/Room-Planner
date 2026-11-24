import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The Worker imports its MCP Apps view as text, as Wrangler's default `.html` rule does.
  plugins: [
    {
      name: 'html-as-text',
      enforce: 'pre',
      async load(id) {
        if (!id.endsWith('.html')) return null;
        const { readFile } = await import('node:fs/promises');
        return `export default ${JSON.stringify(await readFile(id, 'utf8'))};`;
      },
    },
  ],
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    environment: 'node',
  },
});
