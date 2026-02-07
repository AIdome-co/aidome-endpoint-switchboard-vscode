/**
 * Setup Switchboard command handler.
 */

import * as vscode from 'vscode';

/**
 * Handles the setupSwitchboard command.
 * Launches the setup wizard for configuring endpoint routing.
 */
export async function setupSwitchboard(): Promise<void> {
  await vscode.window.showInformationMessage('Setup Switchboard - Coming soon!');
}
