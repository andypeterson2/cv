import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/dom/**/*.test.js'],
    environment: 'happy-dom',
    globals: true,
  },
});
