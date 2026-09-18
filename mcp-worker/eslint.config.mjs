// Flat config on purpose: the repo gitignore leads with `.*`, so a dotfile-named
// config would never be committed. Syntactic rules only; tsc strict owns types.
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
      // Warn only: MCP tool payloads and OAuth responses are untyped JSON at
      // the boundary; tsc strict still checks everything the types do cover.
      '@typescript-eslint/no-explicit-any': 'warn',
      ...complexityBudgets,
    },
  },
];
