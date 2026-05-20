/**
 * Reset Switchboard command handler with granular reset options.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import { ChangeLog } from '../core/orchestration/changeLog';
import { ProfileStore } from '../core/profiles/profileStore';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { getOutputChannel } from '../interactions/output';
import { updateStatusBar } from '../interactions/statusBar';
import { showWarning, showError, showSuccess } from '../interactions/notifications';
import { Logger } from '../util/log';
import { safeWriteFile } from '../util/fsSafe';

/**
 * Main reset menu options.
 */
enum ResetOption {
  SPECIFIC_ASSISTANT = 'Reset Specific Assistant',
  ALL_FOR_PROFILE = 'Reset All for a Profile',
  FULL_FACTORY = 'Full Factory Reset',
  VIEW_HISTORY = 'View Change History'
}

/**
 * Handles the resetSwitchboard command.
 * Shows main menu with granular reset options.
 */
export async function resetSwitchboard(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    const choice = await vscode.window.showQuickPick([
      {
        label: '$(debug-reverse-continue) Reset Specific Assistant',
        description: 'Undo changes for a single assistant',
        value: ResetOption.SPECIFIC_ASSISTANT
      },
      {
        label: '$(refresh) Reset All for a Profile',
        description: 'Undo all changes for a profile',
        value: ResetOption.ALL_FOR_PROFILE
      },
      {
        label: '$(trash) Full Factory Reset',
        description: 'Remove all profiles, mappings, and restore configurations',
        value: ResetOption.FULL_FACTORY
      },
      {
        label: '$(history) View Change History',
        description: 'Show chronological list of all changes',
        value: ResetOption.VIEW_HISTORY
      }
    ], {
      placeHolder: 'AIdome: Reset Switchboard',
      title: 'AIdome: Reset Switchboard'
    });
    
    if (!choice) {
      logger.info('Reset cancelled by user');
      return;
    }
    
    switch (choice.value) {
      case ResetOption.SPECIFIC_ASSISTANT:
        await resetSpecificAssistant(context);
        break;
      case ResetOption.ALL_FOR_PROFILE:
        await resetAllForProfile(context);
        break;
      case ResetOption.FULL_FACTORY:
        await fullFactoryReset(context);
        break;
      case ResetOption.VIEW_HISTORY:
        await viewChangeHistory(context);
        break;
    }
  } catch (error) {
    logger.error('Failed to execute reset', error instanceof Error ? error : undefined);
    await showError(`Reset failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Resets a specific assistant by undoing its changes.
 */
async function resetSpecificAssistant(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  const changeLog = new ChangeLog(context);
  
  // Get all entries and group by assistant
  const allEntries = await changeLog.getEntries();
  const assistantKeys = [...new Set(allEntries.map(e => e.assistantKey))];
  
  if (assistantKeys.length === 0) {
    await vscode.window.showInformationMessage('No assistants have change log entries.');
    return;
  }
  
  // Show assistant picker
  const assistantChoice = await vscode.window.showQuickPick(
    assistantKeys.map(key => ({
      label: key,
      description: `${allEntries.filter(e => e.assistantKey === key).length} change log entries`,
      value: key
    })),
    {
      placeHolder: 'Select assistant to reset',
      title: 'Reset Specific Assistant'
    }
  );
  
  if (!assistantChoice) {
    return;
  }
  
  const assistantKey = assistantChoice.value;
  const entries = await changeLog.getEntriesForAssistant(assistantKey);
  
  // Count total changes
  const totalChanges = entries.reduce((sum, entry) => sum + entry.steps.length, 0);
  
  // Show what will be undone
  const changesList = entries
    .map(entry => `  • Profile: ${entry.profileName} (${entry.steps.length} changes)`)
    .join('\n');
  
  const confirmation = await showWarning(
    `This will undo ${totalChanges} changes for ${assistantKey}:\n\n${changesList}\n\nContinue?`,
    'Undo Changes',
    'Cancel'
  );
  
  if (confirmation !== 'Undo Changes') {
    logger.info('Reset cancelled by user');
    return;
  }
  
  // Execute undo for all entries
  let successCount = 0;
  let failCount = 0;
  
  for (const entry of entries) {
    for (const step of entry.steps) {
      try {
        await undoStep(step);
        successCount++;
      } catch (error) {
        logger.error(`Failed to undo step: ${step.target}`, error instanceof Error ? error : undefined);
        failCount++;
      }
    }
  }
  
  // Remove change log entries for this assistant
  await changeLog.removeEntriesForAssistant(assistantKey);
  
  if (failCount === 0) {
    await showSuccess(`Successfully undid all ${successCount} changes for ${assistantKey}`);
  } else {
    await showWarning(
      `Partially completed: ${successCount} changes undone, ${failCount} failed`,
      'OK'
    );
  }
  
  logger.info(`Reset assistant ${assistantKey}: ${successCount} succeeded, ${failCount} failed`);
}

/**
 * Resets all changes for a specific profile.
 */
async function resetAllForProfile(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  const changeLog = new ChangeLog(context);
  
  // Get all entries and group by profile
  const allEntries = await changeLog.getEntries();
  const profileNames = [...new Set(allEntries.map(e => e.profileName))];
  
  if (profileNames.length === 0) {
    await vscode.window.showInformationMessage('No profiles have change log entries.');
    return;
  }
  
  // Show profile picker
  const profileChoice = await vscode.window.showQuickPick(
    profileNames.map(name => ({
      label: name,
      description: `${allEntries.filter(e => e.profileName === name).length} change log entries`,
      value: name
    })),
    {
      placeHolder: 'Select profile to reset',
      title: 'Reset All for a Profile'
    }
  );
  
  if (!profileChoice) {
    return;
  }
  
  const profileName = profileChoice.value;
  const entries = await changeLog.getEntriesForProfile(profileName);
  
  // Count total changes and affected assistants
  const totalChanges = entries.reduce((sum, entry) => sum + entry.steps.length, 0);
  const assistantKeys = [...new Set(entries.map(e => e.assistantKey))];
  
  const confirmation = await showWarning(
    `This will undo ${totalChanges} changes for profile "${profileName}" affecting ${assistantKeys.length} assistants:\n${assistantKeys.join(', ')}\n\nContinue?`,
    'Undo All',
    'Cancel'
  );
  
  if (confirmation !== 'Undo All') {
    logger.info('Reset cancelled by user');
    return;
  }
  
  // Execute undo for all entries
  let successCount = 0;
  let failCount = 0;
  
  for (const entry of entries) {
    for (const step of entry.steps) {
      try {
        await undoStep(step);
        successCount++;
      } catch (error) {
        logger.error(`Failed to undo step: ${step.target}`, error instanceof Error ? error : undefined);
        failCount++;
      }
    }
  }
  
  // Remove change log entries for this profile
  await changeLog.removeEntriesForProfile(profileName);
  
  if (failCount === 0) {
    await showSuccess(`Successfully undid all ${successCount} changes for profile "${profileName}"`);
  } else {
    await showWarning(
      `Partially completed: ${successCount} changes undone, ${failCount} failed`,
      'OK'
    );
  }
  
  logger.info(`Reset profile ${profileName}: ${successCount} succeeded, ${failCount} failed`);
}

/**
 * Performs a full factory reset of all configuration.
 */
async function fullFactoryReset(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  
  // First confirmation
  const firstConfirm = await showWarning(
    '⚠️ This will remove ALL profiles, mappings, and restore all backed-up configurations. This cannot be undone. Continue?',
    'Continue',
    'Cancel'
  );
  
  if (firstConfirm !== 'Continue') {
    logger.info('Factory reset cancelled by user');
    return;
  }
  
  // Second confirmation: type RESET
  const resetConfirmation = await vscode.window.showInputBox({
    prompt: "Type 'RESET' to confirm full factory reset",
    placeHolder: 'RESET',
    validateInput: (value) => {
      return value === 'RESET' ? null : "Please type 'RESET' to confirm";
    }
  });
  
  if (resetConfirmation !== 'RESET') {
    logger.info('Factory reset cancelled by user');
    return;
  }
  
  logger.info('Starting full factory reset');
  
  const changeLog = new ChangeLog(context);
  const profileStore = new ProfileStore(context);
  const profileSecrets = new ProfileSecrets(context);
  
  // 1. Undo all change log entries
  let successCount = 0;
  let failCount = 0;
  
  const allEntries = await changeLog.getEntries();
  for (const entry of allEntries) {
    for (const step of entry.steps) {
      try {
        await undoStep(step);
        successCount++;
      } catch (error) {
        logger.error(`Failed to undo step: ${step.target}`, error instanceof Error ? error : undefined);
        failCount++;
      }
    }
  }
  
  // 2. Delete all profiles
  const profiles = await profileStore.getProfiles();
  for (const profile of profiles) {
    try {
      await profileSecrets.deleteSecret(profile.name);
    } catch (error) {
      logger.error(`Failed to delete secret for profile: ${profile.name}`, error instanceof Error ? error : undefined);
    }
  }
  await profileStore.clearAll();
  
  // 3. Clear change log
  await changeLog.clearAll();
  
  // 4. Reset status bar
  updateStatusBar(undefined);
  
  if (failCount === 0) {
    await showSuccess(`Factory reset complete. Undid ${successCount} changes, removed ${profiles.length} profiles.`);
  } else {
    await showWarning(
      `Factory reset completed with errors: ${successCount} changes undone, ${failCount} failed, ${profiles.length} profiles removed.`,
      'OK'
    );
  }
  
  logger.info(`Factory reset complete: ${successCount} changes undone, ${failCount} failed, ${profiles.length} profiles removed`);
}

/**
 * Displays change history in the output channel.
 */
async function viewChangeHistory(context: vscode.ExtensionContext): Promise<void> {
  const changeLog = new ChangeLog(context);
  const entries = await changeLog.getEntries();
  
  if (entries.length === 0) {
    await vscode.window.showInformationMessage('No change history available.');
    return;
  }
  
  const output = getOutputChannel();
  output.clear();
  output.appendLine('='.repeat(80));
  output.appendLine('AIdome Switchboard - Change History');
  output.appendLine('='.repeat(80));
  output.appendLine('');
  
  // Sort entries chronologically
  const sortedEntries = [...entries].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  for (const entry of sortedEntries) {
    const timestamp = new Date(entry.timestamp).toLocaleString();
    const summary = entry.steps.map(s => `${s.type}: ${s.target}`).join(', ');
    
    output.appendLine(`[${timestamp}] Applied to ${entry.assistantKey} via profile ${entry.profileName}`);
    output.appendLine(`  Changes: ${summary}`);
    output.appendLine('');
  }
  
  output.appendLine('='.repeat(80));
  output.show();
  
  await vscode.window.showInformationMessage(`Showing ${entries.length} change log entries in output channel.`);
}

/**
 * Undoes a single applied step.
 */
async function undoStep(step: { type: string; target: string; oldValue: unknown; backupPath?: string }): Promise<void> {
  const logger = Logger.getInstance();
  
  switch (step.type) {
    case 'set-vscode-setting':
      // Restore old value via workspace configuration
      await undoVSCodeSetting(step.target, step.oldValue);
      logger.info(`Restored VS Code setting: ${step.target}`);
      break;
      
    case 'edit-config-file':
      // Restore from backup file if available, otherwise restore oldValue content
      await undoConfigFile(step.target, step.oldValue, step.backupPath);
      logger.info(`Restored config file: ${step.target}`);
      break;
      
    case 'set-env-var':
      // Cannot reliably undo environment variables
      await vscode.window.showWarningMessage(
        `Environment variable changes cannot be automatically undone. Please manually unset: ${step.target}`
      );
      logger.warning(`Cannot undo environment variable: ${step.target}`);
      break;
      
    default:
      logger.warning(`Unknown step type for undo: ${step.type}`);
  }
}

/**
 * Undoes a VS Code setting change.
 */
async function undoVSCodeSetting(settingKey: string, oldValue: unknown): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  await config.update(settingKey, oldValue, vscode.ConfigurationTarget.Global);
}

/**
 * Undoes a config file change.
 */
async function undoConfigFile(filePath: string, oldValue: unknown, backupPath?: string): Promise<void> {
  if (backupPath) {
    try {
      // Try to restore from backup file
      const backupContent = await fs.promises.readFile(backupPath, 'utf-8');
      await safeWriteFile(filePath, backupContent);
      return;
    } catch {
      // Backup file doesn't exist or can't be read, fall through to oldValue
    }
  }
  
  if (oldValue !== undefined && oldValue !== null) {
    // Restore from oldValue
    const content = typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue, null, 2);
    await safeWriteFile(filePath, content);
  } else {
    throw new Error(`Cannot restore ${filePath}: no backup file or old value available`);
  }
}
