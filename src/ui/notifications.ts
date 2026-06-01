/**
 * Notification helpers for user messages.
 */

import * as vscode from 'vscode';
import type { Logger } from '../util/log';
import type { BoundaryOutcome } from '../util/errors';

async function showMessage(
  showFn: (message: string, ...actions: string[]) => Thenable<string | undefined>,
  message: string,
  actions: string[]
): Promise<string | undefined> {
  if (actions.length === 0) {
    void showFn(message);
    return undefined;
  }

  return await showFn(message, ...actions);
}

/**
 * Shows a success notification (information).
 * Passive notifications with no actions are fire-and-forget.
 * @param message The message to display
 * @param actions Optional action items
 * @returns Promise resolving to selected action
 */
export async function showSuccess(message: string, ...actions: string[]): Promise<string | undefined> {
  return await showMessage(vscode.window.showInformationMessage, message, actions);
}

/**
 * Shows an information notification.
 * Passive notifications with no actions are fire-and-forget.
 * @param message The message to display
 * @param items Optional action items
 * @returns Promise resolving to selected item
 */
export async function showInfo(message: string, ...items: string[]): Promise<string | undefined> {
  return await showMessage(vscode.window.showInformationMessage, message, items);
}

/**
 * Shows a warning notification.
 * Passive notifications with no actions are fire-and-forget.
 * @param message The message to display
 * @param actions Optional action items
 * @returns Promise resolving to selected action
 */
export async function showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
  return await showMessage(vscode.window.showWarningMessage, message, actions);
}

/**
 * Shows an error notification.
 * Passive notifications with no actions are fire-and-forget.
 * @param message The message to display
 * @param actions Optional action items
 * @returns Promise resolving to selected action
 */
export async function showError(message: string, ...actions: string[]): Promise<string | undefined> {
  return await showMessage(vscode.window.showErrorMessage, message, actions);
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

/**
 * Handles a {@link BoundaryOutcome} produced by {@link withErrorBoundary} with
 * the correct user notification and log entry for each outcome kind.
 *
 * - **success**:    no action — returns `true` so callers can continue.
 * - **cancelled**:  logs the step name at `info` level; no error popup is shown.
 * - **domain**:     logs at `warning` level; shows the typed error's `userMessage`
 *                   (falls back to `error.message` when `userMessage` is absent).
 * - **unexpected**: logs the full stack at `error` level; shows a generic
 *                   "check the output channel" message.
 *
 * @param outcome  The outcome returned by {@link withErrorBoundary}.
 * @param logger   Logger used to record the outcome.
 * @param label    Short human-readable label for the operation, used in log
 *                 messages and the generic error popup (e.g. `'Setup'`).
 * @returns `true` when `outcome.kind === 'success'`; `false` otherwise.
 */
export async function handleBoundaryOutcome<T>(
  outcome: BoundaryOutcome<T>,
  logger: Logger,
  label: string
): Promise<boolean> {
  switch (outcome.kind) {
    case 'success':
      return true;

    case 'cancelled':
      logger.info(`${label} cancelled by user at step: ${outcome.step}`);
      return false;

    case 'domain': {
      const userMsg: string =
        'userMessage' in outcome.error
          ? (outcome.error as { userMessage: string }).userMessage
          : outcome.error.message;
      logger.warning(
        `${label} domain error: ${outcome.error.message}`,
        undefined,
        { errorName: outcome.error.name }
      );
      await showError(userMsg);
      return false;
    }

    case 'unexpected':
      logger.error(`${label} unexpected error`, outcome.error);
      await showError(
        `${label} failed unexpectedly. Check the Output channel for details.`
      );
      return false;
  }
}
