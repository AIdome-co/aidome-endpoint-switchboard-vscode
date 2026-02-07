/**
 * Notification helpers for user messages.
 */

import * as vscode from 'vscode';

/**
 * Shows a success notification (information).
 * @param message The message to display
 * @param actions Optional action items
 * @returns Promise resolving to selected action
 */
export async function showSuccess(message: string, ...actions: string[]): Promise<string | undefined> {
  return await vscode.window.showInformationMessage(message, ...actions);
}

/**
 * Shows an information notification.
 * @param message The message to display
 * @param items Optional action items
 * @returns Promise resolving to selected item
 */
export async function showInfo(message: string, ...items: string[]): Promise<string | undefined> {
  return await vscode.window.showInformationMessage(message, ...items);
}

/**
 * Shows a warning notification.
 * @param message The message to display
 * @param actions Optional action items
 * @returns Promise resolving to selected action
 */
export async function showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
  return await vscode.window.showWarningMessage(message, ...actions);
}

/**
 * Shows an error notification.
 * @param message The message to display
 * @param actions Optional action items
 * @returns Promise resolving to selected action
 */
export async function showError(message: string, ...actions: string[]): Promise<string | undefined> {
  return await vscode.window.showErrorMessage(message, ...actions);
}

/**
 * Shows a progress notification.
 * @param title Progress title
 * @param task The task to run
 * @returns Promise resolving to task result
 */
export async function withProgress<T>(
  title: string,
  task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
): Promise<T> {
  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false
    },
    task
  );
}
