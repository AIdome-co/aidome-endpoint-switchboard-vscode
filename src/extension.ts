/**
 * Main extension entry point for AIdome Endpoint Switchboard.
 * This extension helps configure AI coding assistants to use custom LLM endpoints.
 */

import * as vscode from 'vscode';
import { setupSwitchboard } from './commands/setupSwitchboard';
import { verifyRouting } from './commands/verifyRouting';
import { showModelsProviders } from './commands/showModelsProviders';
import { manageProfiles } from './commands/manageProfiles';
import { resetSwitchboard } from './commands/resetSwitchboard';
import { exportDiagnostics } from './commands/exportDiagnostics';
import { getOutputChannel } from './ui/output';
import { createStatusBarItem, updateStatusBar } from './ui/statusBar';
import { ProfileStore } from './core/profiles/profileStore';
import { Logger } from './util/log';

/**
 * Activates the extension.
 * Called when the extension is first activated.
 * @param context Extension context
 */
export function activate(context: vscode.ExtensionContext): void {
  // Initialize output channel and logger
  const outputChannel = getOutputChannel();
  Logger.initialize(outputChannel);
  const logger = Logger.getInstance();
  
  logger.info('AIdome Endpoint Switchboard extension is activating...');

  // Initialize status bar
  const statusBar = createStatusBarItem();
  context.subscriptions.push(statusBar);

  // Initialize profile store and update status bar
  const profileStore = new ProfileStore(context);
  profileStore.getActiveProfile().then(profile => {
    updateStatusBar(profile?.name);
  }).catch(error => {
    logger.error('Failed to load active profile', error instanceof Error ? error : undefined);
    updateStatusBar(undefined);
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.setupSwitchboard', async () => {
      try {
        await setupSwitchboard(context);
      } catch (error) {
        logger.error('Error in setupSwitchboard command', error as Error);
        vscode.window.showErrorMessage('Failed to run setup: ' + (error as Error).message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.verifyRouting', async () => {
      try {
        await verifyRouting(context);
      } catch (error) {
        logger.error('Error in verifyRouting command', error as Error);
        vscode.window.showErrorMessage('Failed to verify routing: ' + (error as Error).message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.showModelsProviders', async () => {
      try {
        await showModelsProviders(context);
      } catch (error) {
        logger.error('Error in showModelsProviders command', error as Error);
        vscode.window.showErrorMessage('Failed to show models: ' + (error as Error).message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.manageProfiles', async () => {
      try {
        await manageProfiles(context);
      } catch (error) {
        logger.error('Error in manageProfiles command', error as Error);
        vscode.window.showErrorMessage('Failed to manage profiles: ' + (error as Error).message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.resetSwitchboard', async () => {
      try {
        await resetSwitchboard(context);
      } catch (error) {
        logger.error('Error in resetSwitchboard command', error as Error);
        vscode.window.showErrorMessage('Failed to reset: ' + (error as Error).message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.exportDiagnostics', async () => {
      try {
        await exportDiagnostics(context);
      } catch (error) {
        logger.error('Error in exportDiagnostics command', error as Error);
        vscode.window.showErrorMessage('Failed to export diagnostics: ' + (error as Error).message);
      }
    })
  );

  logger.info('AIdome Endpoint Switchboard extension activated successfully');
}

/**
 * Deactivates the extension.
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  // Cleanup if needed
}
