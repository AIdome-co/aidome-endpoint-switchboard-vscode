/**
 * Mocha loader invoked inside the Extension Development Host.
 *
 * `@vscode/test-electron` imports this module and calls `run()` in the
 * extension host's Node context. From here we discover and execute all
 * compiled `*.e2e.test.js` files under `test/e2e/suite/`.
 */

import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    // Downloading and spinning up VS Code on a cold CI runner is slow.
    timeout: 60_000
  });

  const testsRoot = __dirname;

  const files = await glob('**/*.e2e.test.js', { cwd: testsRoot });
  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  return new Promise<void>((resolve, reject) => {
    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} E2E test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
