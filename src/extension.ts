/**
 * Main extension entry point for AIdome Endpoint Switchboard.
 * This extension helps configure AI coding assistants to use custom LLM endpoints.
 */

import * as vscode from 'vscode';
import { setupSwitchboard } from './commands/setupSwitchboard';
import { verifyRouting } from './commands/verifyRouting';
import { showModelsProviders } from './commands/showModelsProviders';
import { manageProfiles } from './commands/manageProfiles';
import { assignProfileAssistants } from './commands/assignProfileAssistants';
import { resetSwitchboard } from './commands/resetSwitchboard';
import { exportDiagnostics } from './commands/exportDiagnostics';
import { getOutputChannel } from './ui/output';
import { createStatusBarItem, StatusBarManager } from './ui/statusBar';
import { ProfileStore } from './core/profiles/profileStore';
import { Logger } from './util/log';
import { initializeExtensionCaching } from './core/detection/detectExtensions';
import { withErrorBoundary } from './util/errors';
import { handleBoundaryOutcome } from './ui/notifications';
import {
  activateProfileAndReapplyMappings,
  getProfileActivationNotice
} from './commands/activateProfile';

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
        const action = await vscode.window.showQuickPick<vscode.QuickPickItem & { value: string }>([
          { label: '$(debug-start) Verify Routing', value: 'verify' },
          { label: '$(list-unordered) Manage Profiles', value: 'manage' },
          { label: '$(arrow-swap) Activate Profile', value: 'activate' },
          { label: '$(plug) Assign Assistants to Profile', value: 'assign' },
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
          case 'activate':
            await vscode.commands.executeCommand('aidome-switchboard.activateProfile');
            break;
          case 'assign':
            await vscode.commands.executeCommand('aidome-switchboard.assignProfileAssistants');
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
      const outcome = await withErrorBoundary(() => setupSwitchboard(context));
      await handleBoundaryOutcome(outcome, logger, 'Setup');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.verifyRouting', async () => {
      const outcome = await withErrorBoundary(() => verifyRouting(context));
      await handleBoundaryOutcome(outcome, logger, 'Verify routing');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.showModelsProviders', async () => {
      const outcome = await withErrorBoundary(() => showModelsProviders(context));
      await handleBoundaryOutcome(outcome, logger, 'Show models');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.manageProfiles', async () => {
      const outcome = await withErrorBoundary(() => manageProfiles(context));
      await handleBoundaryOutcome(outcome, logger, 'Manage profiles');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.assignProfileAssistants', async (rawProfileId?: unknown) => {
      if (rawProfileId !== undefined && typeof rawProfileId !== 'string') {
        vscode.window.showErrorMessage('assignProfileAssistants expects a string profileId.');
        return;
      }
      const outcome = await withErrorBoundary(() => assignProfileAssistants(context, rawProfileId));
      await handleBoundaryOutcome(outcome, logger, 'Assign profile assistants');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.resetSwitchboard', async () => {
      const outcome = await withErrorBoundary(() => resetSwitchboard(context));
      await handleBoundaryOutcome(outcome, logger, 'Reset');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.exportDiagnostics', async () => {
      const outcome = await withErrorBoundary(() => exportDiagnostics(context));
      await handleBoundaryOutcome(outcome, logger, 'Export diagnostics');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('aidome-switchboard.activateProfile', async (rawProfileId?: unknown) => {
      if (rawProfileId !== undefined && typeof rawProfileId !== 'string') {
        vscode.window.showErrorMessage('activateProfile expects a string profileId.');
        return;
      }
      let profileId: string | undefined = rawProfileId;
      if (!profileId) {
        const profileStore = new ProfileStore(context);
        const profiles = await profileStore.getProfiles();
        if (profiles.length === 0) {
          vscode.window.showWarningMessage('No profiles exist yet. Run setup or Manage Profiles first.');
          return;
        }
        const pick = await vscode.window.showQuickPick<vscode.QuickPickItem & { profileId: string }>(
          profiles
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(p => {
              let displayUrl = p.baseUrl;
              try {
                const u = new URL(p.baseUrl);
                if (u.username || u.password) { u.username = '***'; u.password = ''; displayUrl = u.toString(); }
              } catch { /* non-URL, show as-is */ }
              return { label: p.name, description: displayUrl, detail: p.dialect, profileId: p.id };
            }),
          { placeHolder: 'Select a profile to activate', matchOnDetail: true }
        );
        if (!pick) {
          return;
        }
        profileId = pick.profileId;
      }
      const resolvedId = profileId;
      const outcome = await withErrorBoundary(async () => {
        const result = await activateProfileAndReapplyMappings(context, resolvedId);
        const notice = getProfileActivationNotice(result);
        if (notice.kind === 'success') {
          if (result.status === 'active-only' && result.mappedAssistantKeys.length === 0) {
            const action = await vscode.window.showInformationMessage(notice.message, 'Assign Assistants');
            if (action === 'Assign Assistants') {
              await vscode.commands.executeCommand('aidome-switchboard.assignProfileAssistants', resolvedId);
            }
          } else {
            vscode.window.showInformationMessage(notice.message);
          }
        } else if (notice.kind === 'warning') {
          vscode.window.showWarningMessage(notice.message);
        } else {
          vscode.window.showErrorMessage(notice.message);
        }
      });
      await handleBoundaryOutcome(outcome, logger, 'Activate profile');
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
