/**
 * Verify All Profile Routes command handler.
 */

import * as vscode from 'vscode';
import { ProfileStore } from '../core/profiles/profileStore';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { Switchboard } from '../core/orchestration/switchboard';
import { loadRegistry } from '../core/registry/registryLoader';
import { renderVerificationResults } from '../ui/wizard/renderResults';
import { showError, showSuccess, showWarning } from '../ui/notifications';
import { showResults } from '../ui/output';
import { Logger } from '../util/log';

/**
 * Handles the verifyRouting command.
 * Verifies that endpoint routing is correctly configured for all assistants.
 */
export async function verifyRouting(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    logger.info('Starting routing verification');
    
    const profileStore = new ProfileStore(context);
    const activeProfile = await profileStore.getActiveProfile();
    
    if (!activeProfile) {
      await showWarning('No active profile found. Please configure a profile first.', 'Setup');
      return;
    }
    
    const registry = await loadRegistry();
    const profileSecrets = new ProfileSecrets(context);
    const switchboard = new Switchboard(context, registry, profileStore, profileSecrets);
    
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Verifying endpoint routing...',
        cancellable: false
      },
      async () => {
        const results = await switchboard.verifyAll();
        showResults(results);
        
        const allSuccess = Object.values(results).every(r => r.status === 'success');
        const anyFailed = Object.values(results).some(r => r.status === 'failed');
        
        if (allSuccess) {
          await showSuccess('All endpoint routes verified successfully!');
        } else if (anyFailed) {
          await showError('Some endpoint routes failed verification. Check the output for details.', 'View Output');
        } else {
          await showWarning('Endpoint verification completed with warnings. Check the output for details.', 'View Output');
        }
        
        logger.info('Verification complete');
      }
    );
  } catch (error) {
    logger.error('Failed to verify routing', error instanceof Error ? error : undefined);
    await showError(`Failed to verify routing: ${error instanceof Error ? error.message : String(error)}`);
  }
}
