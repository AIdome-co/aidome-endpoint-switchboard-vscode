/**
 * Show Models & Providers command handler.
 */

import * as vscode from 'vscode';

/**
 * Handles the showModelsProviders command.
 * Displays available models and providers from the active profile.
 */
export async function showModelsProviders(): Promise<void> {
  await vscode.window.showInformationMessage('Show Models & Providers - Coming soon!');
}
