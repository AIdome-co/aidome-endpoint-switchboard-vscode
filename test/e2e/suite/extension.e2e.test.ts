/**
 * End-to-end smoke tests exercising the extension inside a real VS Code
 * Extension Development Host.
 *
 * These tests are intentionally small and deterministic — their job is to
 * prove that the packaged extension loads, activates, and contributes the
 * commands it declares in `package.json`. Deep business-logic coverage lives
 * in the Vitest unit suites.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'aidome.aidome-endpoint-switchboard';

const DECLARED_COMMANDS: readonly string[] = [
  'aidome-switchboard.setupSwitchboard',
  'aidome-switchboard.verifyRouting',
  'aidome-switchboard.showModelsProviders',
  'aidome-switchboard.manageProfiles',
  'aidome-switchboard.resetSwitchboard',
  'aidome-switchboard.exportDiagnostics'
];

// `aidome-switchboard.statusBarAction` is registered programmatically during
// activation rather than declared in `contributes.commands`, so we assert it
// separately.
const PROGRAMMATIC_COMMAND = 'aidome-switchboard.statusBarAction';

describe('AIdome Endpoint Switchboard — E2E', function () {
  // Activation downloads nothing, but the first `getCommands` call after
  // activation can race with the deferred `setImmediate` work in
  // `extension.ts`. Keep a generous timeout.
  this.timeout(60_000);

  before(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension '${EXTENSION_ID}' is not installed in the host`);
    if (!ext.isActive) {
      await ext.activate();
    }
    // Allow the `setImmediate` block in activate() to flush.
    await new Promise((r) => setTimeout(r, 250));
  });

  it('is present in the Extension Development Host', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
  });

  it('activates successfully', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.strictEqual(ext?.isActive, true);
  });

  it('registers every command declared in package.json', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const cmd of DECLARED_COMMANDS) {
      assert.ok(
        commands.includes(cmd),
        `Expected command '${cmd}' to be registered. Registered AIdome commands: ` +
          commands.filter((c) => c.startsWith('aidome-switchboard.')).join(', ')
      );
    }
  });

  it('registers the programmatic status-bar action command', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes(PROGRAMMATIC_COMMAND),
      `Expected '${PROGRAMMATIC_COMMAND}' to be registered`
    );
  });

  it('exposes the expected command count and no duplicates', async () => {
    const commands = await vscode.commands.getCommands(true);
    const owned = commands.filter((c) => c.startsWith('aidome-switchboard.'));
    const unique = new Set(owned);
    assert.strictEqual(
      unique.size,
      owned.length,
      `Duplicate AIdome commands registered: ${owned.join(', ')}`
    );
    // Declared commands + the one programmatic command.
    assert.strictEqual(
      unique.size,
      DECLARED_COMMANDS.length + 1,
      `Unexpected AIdome command set: ${owned.sort().join(', ')}`
    );
  });
});
