/**
 * Reset Switchboard command handler.
 */

import * as vscode from 'vscode';
import { ProfileStore } from '../core/profiles/profileStore';
import { showWarning, showSuccess, showError } from '../ui/notifications';
import { updateStatusBar } from '../ui/statusBar';
import { Logger } from '../util/log';

/**
 * Handles the resetSwitchboard command.
 * Resets all switchboard configuration to defaults.
 */
export async function resetSwitchboard(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    const confirm = await showWarning(
      'Are you sure you want to reset all switchboard configuration? This will clear all profiles, mappings, and settings.',
      'Reset',
      'Cancel'
    );
    
    if (confirm !== 'Reset') {
      logger.info('Reset cancelled by user');
      return;
    }
    
    logger.info('Resetting switchboard configuration');
    
    const profileStore = new ProfileStore(context);
    await profileStore.clearAll();
    
    updateStatusBar(undefined);
    
    await showSuccess('Switchboard configuration has been reset. All profiles and mappings have been cleared.');
    logger.info('Reset complete');
  } catch (error) {
    logger.error('Failed to reset switchboard', error instanceof Error ? error : undefined);
    await showError(`Failed to reset: ${error instanceof Error ? error.message : String(error)}`);
  }
}
