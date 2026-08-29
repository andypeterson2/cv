// Flat config ON PURPOSE (not .eslintrc.*): this repo's .gitignore leads with
// `.*`, so a dotfile-named config would silently never be committed.
// Syntactic rules only — `npm run typecheck` (tsc strict) owns the type tier.
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';

// Complexity budgets (fleet lint baseline).
const complexityBudgets = {
  'sonarjs/cognitive-complexity': ['error', 15],
  'max-depth': ['error', 4],
  'max-params': ['error', 5],
  'max-nested-callbacks': ['error', 3],
};

export default [
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ['src/**/*.ts', 'test/**/*.ts'] })),
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    plugins: { sonarjs },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // WARN, not error: the MCP tool payloads and OAuth responses are untyped
      // JSON at the boundary (~31 sites). Typing that wire layer is a tracked
      // refactor; tsc strict still checks everything the types do cover.
      '@typescript-eslint/no-explicit-any': 'warn',
      ...complexityBudgets,
    },
  },
];
