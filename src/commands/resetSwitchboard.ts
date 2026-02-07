/**
 * Reset Switchboard command handler.
 */

import * as vscode from 'vscode';

/**
 * Handles the resetSwitchboard command.
 * Resets all switchboard configuration to defaults.
 */
export async function resetSwitchboard(): Promise<void> {
  await vscode.window.showInformationMessage('Reset Switchboard - Coming soon!');
}
