import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Gate all of lib + routes, thin spots included. Floors sit a few points
      // below measured coverage: a regression ratchet, not a stretch goal.
      include: ['lib/**/*.js', 'routes/**/*.js'],
      thresholds: { statements: 75, branches: 60, functions: 72, lines: 78 },
    },
  },
});
