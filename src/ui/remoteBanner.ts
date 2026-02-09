/**
 * Remote environment banner display.
 * Shows informational messages about the current remote context.
 */

import * as vscode from 'vscode';
import { RemoteContext } from '../core/detection/detectRemote';

/**
 * Shows a remote environment banner with context information.
 * @param remoteContext The remote context to display
 */
export function showRemoteBanner(remoteContext: RemoteContext): void {
  let message: string;
  
  if (!remoteContext.isRemote) {
    message = '📍 Configuring: Local machine';
  } else {
    switch (remoteContext.remoteType) {
      case 'ssh':
        message = `📍 Configuring: Remote host: ${remoteContext.hostInfo} (via SSH)`;
        break;
      case 'dev-container':
        message = `📍 Configuring: Container: ${remoteContext.hostInfo}`;
        break;
      case 'codespaces':
        message = `📍 Configuring: GitHub Codespaces: ${remoteContext.hostInfo}`;
        break;
      case 'wsl':
        message = `📍 Configuring: WSL: ${remoteContext.hostInfo}`;
        break;
      case 'tunnel':
        message = `📍 Configuring: Remote tunnel: ${remoteContext.hostInfo}`;
        break;
      default:
        message = `📍 Configuring: Remote: ${remoteContext.hostInfo}`;
    }
  }
  
  // Show as information message (non-blocking)
  vscode.window.showInformationMessage(message);
}

/**
 * Shows warnings for remote environment issues.
 * @param remoteContext The remote context
 */
export function showRemoteWarnings(remoteContext: RemoteContext): void {
  if (remoteContext.warningMessages && remoteContext.warningMessages.length > 0) {
    for (const warning of remoteContext.warningMessages) {
      vscode.window.showWarningMessage(warning);
    }
  }
}
