// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      'dist/',
      '.astro/',
      'node_modules/',
      'playwright-report/',
      'test-results/',
      '.wrangler/',
      'legacy/worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['*.{js,mjs,ts}', 'e2e/**/*.ts', 'brand/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // The legacy Worker runs on workerd: Web APIs only, no DOM.
    files: ['legacy/**/*.ts'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
);
