/**
 * Results rendering for wizard completion.
 */

import * as vscode from 'vscode';

/**
 * Wizard result data.
 */
export interface WizardResult {
  success: boolean;
  assistantsConfigured: string[];
  errors?: string[];
  warnings?: string[];
}

/**
 * Renders wizard completion results.
 * @param result The wizard result
 * @returns Promise resolving when complete
 */
export async function renderResults(result: WizardResult): Promise<void> {
  // Skeleton implementation
  throw new Error('Not implemented');
}

/**
 * Shows success message with next steps.
 * @param assistants Array of configured assistants
 * @returns Promise resolving when complete
 */
export async function showSuccessMessage(assistants: string[]): Promise<void> {
  const message = `Successfully configured ${assistants.length} assistant(s): ${assistants.join(', ')}`;
  await vscode.window.showInformationMessage(message);
}

/**
 * Shows error message with troubleshooting steps.
 * @param error The error message
 * @returns Promise resolving when complete
 */
export async function showErrorMessage(error: string): Promise<void> {
  const message = `Configuration failed: ${error}`;
  await vscode.window.showErrorMessage(message);
}
