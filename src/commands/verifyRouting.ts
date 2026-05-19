/**
 * Verify Routing command handler.
 */

import * as vscode from 'vscode';
import { ProfileStore } from '../core/profiles/profileStore';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { Switchboard } from '../core/orchestration/switchboard';
import { loadRegistry } from '../core/registry/registryLoader';
import { renderVerificationResults } from '../ui/wizard/renderResults';
import { showError, showSuccess, showWarning } from '../ui/notifications';
import { showOutput, showResults } from '../ui/output';
import { Logger } from '../util/log';

/**
 * Handles the verifyRouting command.
 * Verifies endpoint routing globally or for a selected profile.
 */
export async function verifyRouting(
  context: vscode.ExtensionContext,
  profileId?: string
): Promise<void> {
  const logger = Logger.getInstance();
  let completionNotification:
    | { kind: 'success' | 'warning' | 'error'; message: string; actions?: string[] }
    | undefined;
  
  try {
    logger.info('Starting routing verification');
    
    const profileStore = new ProfileStore(context);
    const profiles = await profileStore.getProfiles();

    if (profiles.length === 0) {
      await showWarning('No profiles found. Please configure a profile first.', 'Setup');
      return;
    }
    
    const registry = await loadRegistry();
    const profileSecrets = new ProfileSecrets(context);
    const switchboard = new Switchboard(context, registry, profileStore, profileSecrets);
    
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: profileId ? 'Verifying selected profile...' : 'Verifying endpoint routing...',
        cancellable: false
      },
      async () => {
        const results = profileId
          ? { [profileId]: await switchboard.verifyProfile(profileId) }
          : await switchboard.verifyAll();
        showResults(results);
        
        const allSuccess = Object.values(results).every(r => r.status === 'success');
        const anyFailed = Object.values(results).some(r => r.status === 'failed');
        
        if (allSuccess) {
          completionNotification = {
            kind: 'success',
            message: profileId
              ? 'Selected profile verified successfully!'
              : 'All endpoint routes verified successfully!'
          };
        } else if (anyFailed) {
          completionNotification = {
            kind: 'error',
            message: profileId
              ? 'Selected profile failed verification. Check the output for details.'
              : 'Some endpoint routes failed verification. Check the output for details.',
            actions: ['View Output']
          };
        } else {
          completionNotification = {
            kind: 'warning',
            message: profileId
              ? 'Selected profile verification completed with warnings. Check the output for details.'
              : 'Endpoint verification completed with warnings. Check the output for details.',
            actions: ['View Output']
          };
        }
        
        logger.info('Verification complete');
      }
    );

    if (!completionNotification) {
      return;
    }

    const actions = completionNotification.actions || [];
    const selectedAction = completionNotification.kind === 'success'
      ? await showSuccess(completionNotification.message, ...actions)
      : completionNotification.kind === 'warning'
        ? await showWarning(completionNotification.message, ...actions)
        : await showError(completionNotification.message, ...actions);

    if (selectedAction === 'View Output') {
      showOutput();
    }
  } catch (error) {
    logger.error('Failed to verify routing', error instanceof Error ? error : undefined);
    await showError(`Failed to verify routing: ${error instanceof Error ? error.message : String(error)}`);
  }
}
