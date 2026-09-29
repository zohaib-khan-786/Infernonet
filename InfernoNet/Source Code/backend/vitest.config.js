import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    // Each file builds its own in-memory database, so files can run in parallel
    // without sharing state.
    pool: 'threads',
    reporters: 'default',
  },
});
