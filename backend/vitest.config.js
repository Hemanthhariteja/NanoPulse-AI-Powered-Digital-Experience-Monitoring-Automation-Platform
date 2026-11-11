import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.js'],
    fileParallelism: false, // test files share one MongoDB test database
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
