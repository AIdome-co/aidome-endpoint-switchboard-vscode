/**
 * Manage Profiles command handler.
 */

import * as vscode from 'vscode';

/**
 * Handles the manageProfiles command.
 * Opens the profile management interface for creating, editing, and switching profiles.
 */
export async function manageProfiles(): Promise<void> {
  await vscode.window.showInformationMessage('Manage Profiles - Coming soon!');
}
