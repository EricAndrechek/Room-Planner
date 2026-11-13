import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'legacy/**/*.test.ts'],
    environment: 'node',
  },
});
