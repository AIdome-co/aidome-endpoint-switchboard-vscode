/**
 * Status bar management for extension.
 */

import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * Creates and initializes the status bar item.
 * @returns The status bar item
 */
export function createStatusBarItem(): vscode.StatusBarItem {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'aidome-switchboard.setupSwitchboard';
  }
  return statusBarItem;
}

/**
 * Updates the status bar with active profile.
 * @param profileName The active profile name
 */
export function updateStatusBar(profileName?: string): void {
  const item = createStatusBarItem();
  
  if (profileName) {
    item.text = `$(shield) AIdome: ${profileName}`;
    item.tooltip = `Active profile: ${profileName}\nClick to configure`;
    item.show();
  } else {
    item.text = '$(warning) AIdome: Not configured';
    item.tooltip = 'No active profile\nClick to configure';
    item.show();
  }
}

/**
 * Hides the status bar item.
 */
export function hideStatusBar(): void {
  statusBarItem?.hide();
}

/**
 * Disposes the status bar item.
 */
export function disposeStatusBar(): void {
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
