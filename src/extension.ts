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
import { createStatusBarItem, StatusBarManager } from './ui/statusBar';
import { ProfileStore } from './core/profiles/profileStore';
import { Logger } from './util/log';
import { initializeExtensionCaching } from './core/detection/detectExtensions';

const STATE_VERSION_KEY = 'aidome.switchboard.stateVersion';
const CURRENT_STATE_VERSION = '1';

/**
 * Performs state migration if needed.
 * @param context Extension context
 */
async function migrateState(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  const currentVersion = context.globalState.get<string>(STATE_VERSION_KEY);
  
  if (currentVersion === CURRENT_STATE_VERSION) {
    // No migration needed
    return;
  }
  
  logger.info(`Migrating state from version ${currentVersion || 'undefined'} to ${CURRENT_STATE_VERSION}`);
  
  // Future migrations will go here
  // Example:
  // if (!currentVersion || currentVersion === '1') {
  //   await migrateFromV1ToV2(context);
  // }
  
  // Update state version
  await context.globalState.update(STATE_VERSION_KEY, CURRENT_STATE_VERSION);
  logger.info('State migration complete');
}

/**
 * Activates the extension.
 * Called when the extension is first activated.
 * @param context Extension context
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Initialize output channel and logger
  const outputChannel = getOutputChannel();
  Logger.initialize(outputChannel);
  const logger = Logger.getInstance();
  
  logger.info('AIdome Endpoint Switchboard extension is activating...');
  
  // Initialize extension caching for performance
  initializeExtensionCaching(context);
  
  // Check and migrate state if needed
  await migrateState(context);

  // Defer status bar and non-essential initialization
  setImmediate(async () => {
    try {
      // Initialize status bar with StatusBarManager
      const statusBarItem = createStatusBarItem();
      const statusBarManager = new StatusBarManager(statusBarItem);
      context.subscriptions.push(statusBarItem);

      // Initialize profile store and update status bar
      const profileStore = new ProfileStore(context);
      profileStore.getActiveProfile().then(profile => {
        if (profile) {
          statusBarManager.setConfigured(profile.name);
        } else {
          statusBarManager.setNotConfigured();
        }
      }).catch(error => {
        logger.error('Failed to load active profile', error instanceof Error ? error : undefined);
        statusBarManager.setNotConfigured();
      });
    } catch (error) {
      logger.error('Failed to initialize status bar', error instanceof Error ? error : undefined);
    }
  });

  // Register status bar action command (quick actions menu)
  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.statusBarAction', async () => {
      try {
        const action = await vscode.window.showQuickPick([
          { label: '$(debug-start) Verify Routing', value: 'verify' },
          { label: '$(list-unordered) Manage Profiles', value: 'manage' },
          { label: '$(wand) Open Setup Wizard', value: 'setup' },
          { label: '$(notebook) Export Diagnostics', value: 'diagnostics' },
          { label: '$(gear) Show Models & Providers', value: 'models' }
        ], {
          placeHolder: 'AIdome Quick Actions'
        });

        if (!action) {
          return;
        }

        switch (action.value) {
          case 'verify':
            await vscode.commands.executeCommand('aidome-switchboard.verifyRouting');
            break;
          case 'manage':
            await vscode.commands.executeCommand('aidome-switchboard.manageProfiles');
            break;
          case 'setup':
            await vscode.commands.executeCommand('aidome-switchboard.setupSwitchboard');
            break;
          case 'diagnostics':
            await vscode.commands.executeCommand('aidome-switchboard.exportDiagnostics');
            break;
          case 'models':
            await vscode.commands.executeCommand('aidome-switchboard.showModelsProviders');
            break;
        }
      } catch (error) {
        logger.error('Error in statusBarAction command', error as Error);
        vscode.window.showErrorMessage('Failed to execute action: ' + (error as Error).message);
      }
    })
  );

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
