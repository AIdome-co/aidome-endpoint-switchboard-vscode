/**
 * Output channel management for logging.
 */

import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Gets or creates the output channel.
 * @returns The output channel
 */
export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('AIdome Switchboard');
  }
  return outputChannel;
}

/**
 * Logs a message to the output channel.
 * @param message The message to log
 */
export function log(message: string): void {
  const channel = getOutputChannel();
  channel.appendLine(`[${new Date().toISOString()}] ${message}`);
}

/**
 * Shows the output channel.
 */
export function showOutput(): void {
  getOutputChannel().show();
}

/**
 * Clears the output channel.
 */
export function clearOutput(): void {
  getOutputChannel().clear();
}
