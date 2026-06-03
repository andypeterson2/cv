import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Gate the whole server surface (lib + routes), including currently-thin
      // spots (embed-scorer's optional model path, the xelatex compile route) so
      // they stay visible. Floors sit a few points below today's numbers
      // (~84/72/80/86) — a regression ratchet, not a stretch goal. Raise over time.
      include: ['lib/**/*.js', 'routes/**/*.js'],
      thresholds: { statements: 75, branches: 60, functions: 72, lines: 78 },
    },
  },
});
