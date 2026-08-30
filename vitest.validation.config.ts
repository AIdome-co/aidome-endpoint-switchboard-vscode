import { defineConfig } from 'vitest/config';

/**
 * Dedicated config for the live-network validation gate (`npm run validate:registry`).
 * Runs only the *.live.test.ts tests, which hit the VS Code marketplace.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.live.test.ts'],
  },
});