import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Covers all of lib + routes, thin spots included. CI runs test:coverage, not
      // the bare test script, or these floors never apply to anything.
      include: ['lib/**/*.js', 'routes/**/*.js'],
      thresholds: { statements: 85, branches: 74, functions: 84, lines: 86 },
    },
  },
});
