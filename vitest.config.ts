import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // E2E tests run inside a real VS Code Extension Development Host via
    // @vscode/test-electron and import the real `vscode` module — they cannot
    // run under Vitest. They are executed by `npm run test:e2e`.
    exclude: ['node_modules/**', 'out/**', 'test/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        'out/',
        '**/*.d.ts'
      ]
    }
  }
});
