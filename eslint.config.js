// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * The core boundary (docs/design/plan-format.md, section 6): `src/core/**` is pure TypeScript that
 * the app, the Worker and the guides build all import. It may import other core files and
 * `zod/mini`, nothing else: no React, Astro or icons, nothing from the app (`../components`,
 * `../hooks`, `../lib`, `../types`), and no browser-only globals. Tests are exempt (they may
 * import fixtures, Vitest and the app's code under test). One block per folder depth, because a
 * relative import leaves `src/core` at a depth-dependent number of `../`.
 */
const CORE_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'location',
];
/** @type {import("eslint").Linter.Config[]} */
const coreBoundary = [1, 2, 3, 4].map((depth) => ({
  files: [`src/core/${'*/'.repeat(depth - 1)}*.ts`],
  ignores: ['src/core/**/*.test.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            regex: `^(\\.\\./){${depth}}`,
            message: 'src/core must not import from outside src/core.',
          },
          {
            regex: '^(?!\\.|zod/mini$)',
            message: 'src/core may import only other core files and zod/mini.',
          },
        ],
      },
    ],
    'no-restricted-globals': [
      'error',
      ...CORE_GLOBALS.map((name) => ({
        name,
        message: 'src/core runs outside the browser (Worker, build): no DOM or storage globals.',
      })),
    ],
  },
}));

export default defineConfig(
  {
    ignores: [
      'dist/',
      '.astro/',
      'node_modules/',
      'playwright-report/',
      'test-results/',
      '.wrangler/',
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
    files: ['*.{js,mjs,ts}', 'e2e/**/*.ts', 'brand/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  ...coreBoundary,
);
