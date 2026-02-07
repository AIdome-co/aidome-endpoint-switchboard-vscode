/**
 * Show Models & Providers command handler.
 */

import * as vscode from 'vscode';
import { ProfileStore } from '../core/profiles/profileStore';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { AIdomeClient } from '../core/aidome/client';
import { showError, showWarning } from '../ui/notifications';
import { getOutputChannel } from '../ui/output';
import { Logger } from '../util/log';

/**
 * Handles the showModelsProviders command.
 * Displays available models and providers from the active profile.
 */
export async function showModelsProviders(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    logger.info('Fetching models and providers');
    
    const profileStore = new ProfileStore(context);
    const activeProfile = await profileStore.getActiveProfile();
    
    if (!activeProfile) {
      await showWarning('No active profile found. Please configure a profile first.', 'Setup');
      return;
    }
    
    if (activeProfile.profileType !== 'aidome') {
      await showWarning('Models & Providers view is only available for AIdome profiles.');
      return;
    }
    
    const profileSecrets = new ProfileSecrets(context);
    const authToken = await profileSecrets.getSecret(activeProfile.name);
    
    const client = new AIdomeClient(activeProfile, authToken);
    
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Fetching models and providers...',
        cancellable: false
      },
      async () => {
        try {
          const [providers, models] = await Promise.all([
            client.getProviders(),
            client.getModels()
          ]);
          
          const outputChannel = getOutputChannel();
          outputChannel.appendLine('');
          outputChannel.appendLine('='.repeat(60));
          outputChannel.appendLine(`Models & Providers - ${activeProfile.name}`);
          outputChannel.appendLine('='.repeat(60));
          
          outputChannel.appendLine('\nProviders:');
          if (providers.length === 0) {
            outputChannel.appendLine('  No providers found');
          } else {
            providers.forEach(provider => {
              outputChannel.appendLine(`  • ${provider.name} (${provider.id})`);
              outputChannel.appendLine(`    Type: ${provider.type}`);
              outputChannel.appendLine(`    Status: ${provider.status}`);
              outputChannel.appendLine(`    Models: ${provider.supportedModels.length}`);
            });
          }
          
          outputChannel.appendLine('\nModels:');
          if (models.length === 0) {
            outputChannel.appendLine('  No models found');
          } else {
            models.forEach(model => {
              outputChannel.appendLine(`  • ${model.name} (${model.id})`);
              outputChannel.appendLine(`    Provider: ${model.provider}`);
              outputChannel.appendLine(`    Context: ${model.contextWindow} tokens`);
              if (model.capabilities.length > 0) {
                outputChannel.appendLine(`    Capabilities: ${model.capabilities.join(', ')}`);
              }
            });
          }
          
          outputChannel.appendLine('\n' + '='.repeat(60));
          outputChannel.show();
          
          logger.info(`Displayed ${providers.length} providers and ${models.length} models`);
        } catch (error) {
          logger.error('Failed to fetch models/providers', error instanceof Error ? error : undefined);
          throw error;
        }
      }
    );
  } catch (error) {
    logger.error('Failed to show models and providers', error instanceof Error ? error : undefined);
    await showError(`Failed to fetch models and providers: ${error instanceof Error ? error.message : String(error)}`);
  }
}
