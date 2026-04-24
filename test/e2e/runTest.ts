/**
 * E2E runner entry point.
 *
 * Downloads the matching VS Code binary (cached in `.vscode-test/`), launches
 * an Extension Development Host with this extension loaded, and hands control
 * to the Mocha suite in `./suite/index`.
 *
 * Docs: https://code.visualstudio.com/api/working-with-extensions/testing-extension
 * API:  https://github.com/microsoft/vscode-test
 */

import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  try {
    // `__dirname` at runtime is `<repo>/out-test/e2e`. Two levels up is the
    // repo root — the folder containing `package.json`.
    const extensionDevelopmentPath = path.resolve(__dirname, '../..');

    // The path to the compiled Mocha test suite loader.
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      // Open a clean host and disable other extensions so the environment is
      // deterministic.
      launchArgs: ['--disable-extensions', '--disable-workspace-trust']
    });
  } catch (err) {
    // Surface failure to CI. console is permitted in the test harness — the
    // no-console ESLint rule is scoped to `src/**`, and @vscode/test-electron
    // examples in the official docs use console.error here.
    // eslint-disable-next-line no-console
    console.error('E2E test run failed:', err);
    process.exit(1);
  }
}

void main();
