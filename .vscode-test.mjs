// @ts-check
import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out-test/e2e/suite/**/*.e2e.test.js',
  launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
  mocha: {
    ui: 'bdd',
    color: true,
    timeout: 60_000
  }
});
