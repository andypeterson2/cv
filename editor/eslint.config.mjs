// Flat config ON PURPOSE (not .eslintrc.*): this repo's .gitignore leads with
// `.*`, so a dotfile-named config would silently never be committed.
// Scope: this package only — ../shared/constants.js sits outside the flat
// config's base path (it is exercised by this package's tests instead).
import js from '@eslint/js';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';

// Complexity budgets (fleet lint baseline). Cognitive complexity is the
// primary metric — it punishes nesting, not flat readable constructs — so the
// core `complexity` rule stays off (no double-charging).
const complexityBudgets = {
  'sonarjs/cognitive-complexity': ['error', 15],
  'max-depth': ['error', 4],
  'max-params': ['error', 5],
  'max-nested-callbacks': ['error', 3],
};

export default [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  {
    // The server, its libs, routes, migrations, and scripts — CommonJS Node.
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    plugins: { sonarjs },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      ...complexityBudgets,
    },
  },
  {
    // Vitest suites are ESM, run in happy-dom, and use vitest's global API
    // (vitest.config.js sets globals: true).
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...globals.vitest },
    },
    rules: {
      // Test files legitimately nest describe/test/callback structures.
      'max-nested-callbacks': ['error', 5],
    },
  },
  {
    // Shipped migrations are append-only history — they are never edited after
    // landing, so the complexity budgets don't apply to them.
    files: ['migrations/**/*.js'],
    rules: {
      'sonarjs/cognitive-complexity': 'off',
      'max-depth': 'off',
      'max-params': 'off',
      'max-nested-callbacks': 'off',
    },
  },
  {
    // ESM config files in a CommonJS package (vitest loads its config as ESM).
    files: ['vitest.config.js', '*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
];
