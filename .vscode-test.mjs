// @ts-check
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@vscode/test-cli';

const runSuffix = process.env.GITHUB_RUN_ID ?? String(process.pid);
const tempRoot = path.join(process.env.RUNNER_TEMP || (process.platform === 'darwin' ? '/tmp' : os.tmpdir()), `aidome-vsc-${runSuffix}`);
const userDataDir = path.join(tempRoot, 'ud');

export default defineConfig({
  files: 'out-test/e2e/suite/**/*.e2e.test.js',
  launchArgs: ['--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${userDataDir}`],
  mocha: {
    ui: 'bdd',
    color: true,
    timeout: 60_000
  }
});
