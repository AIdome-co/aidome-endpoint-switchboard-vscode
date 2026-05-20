/**
 * Status bar management for extension.
 */

import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem | undefined;

/**
 * StatusBarManager class for managing status bar states.
 */
export class StatusBarManager {
  constructor(private item: vscode.StatusBarItem) {}

  /**
   * Set status bar to configured state.
   * @param profileName The active profile name
   */
  setConfigured(profileName: string): void {
    this.item.text = `$(shield) AIdome: ${profileName}`;
    this.item.tooltip = `Active profile: ${profileName}\nClick for quick actions`;
    this.item.color = undefined;
    this.item.accessibilityInformation = {
      label: `AIdome Switchboard configured with profile ${profileName}`,
      role: 'button'
    };
    this.item.show();
  }

  /**
   * Set status bar to not configured state.
   */
  setNotConfigured(): void {
    this.item.text = '$(warning) AIdome: Not configured';
    this.item.tooltip = 'No active profile\nClick for quick actions';
    this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    this.item.accessibilityInformation = {
      label: 'AIdome Switchboard not configured. Click to setup.',
      role: 'button'
    };
    this.item.show();
  }

  /**
   * Set status bar to error state.
   * @param message Optional error message
   */
  setError(message?: string): void {
    this.item.text = '$(error) AIdome: Error';
    this.item.tooltip = message ? `Error: ${message}\nClick for quick actions` : 'Verification failed\nClick for quick actions';
    this.item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
    this.item.accessibilityInformation = {
      label: message ? `AIdome Switchboard error: ${message}` : 'AIdome Switchboard verification failed',
      role: 'button'
    };
    this.item.show();
  }

  /**
   * Dispose the status bar item.
   */
  dispose(): void {
    this.item.dispose();
  }
}

/**
 * Creates and initializes the status bar item.
 * @returns The status bar item
 */
export function createStatusBarItem(): vscode.StatusBarItem {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'aidome-switchboard.statusBarAction';
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
    item.tooltip = `Active profile: ${profileName}\nClick for quick actions`;
    item.color = undefined;
    item.show();
  } else {
    item.text = '$(warning) AIdome: Not configured';
    item.tooltip = 'No active profile\nClick for quick actions';
    item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
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