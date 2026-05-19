/**
 * Show Models & Providers command handler.
 */

import * as vscode from 'vscode';
import { ProfileStore } from '../core/profiles/profileStore';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { AIdomeClient } from '../core/aidome/client';
import { AIdomeModel, AIdomeProvider } from '../core/aidome/types';
import { resolveAidomeProfileAuthToken } from '../core/profiles/resolveAidomeProfileAuth';
import { EndpointProfile } from '../core/profiles/profileTypes';
import { showError, showWarning } from '../ui/notifications';
import { getOutputChannel } from '../ui/output';
import { HttpError } from '../util/http';
import { Logger } from '../util/log';

/**
 * Handles the showModelsProviders command.
 * Displays available models and providers from the selected or active profile.
 */
export async function showModelsProviders(
  context: vscode.ExtensionContext,
  profileId?: string
): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    logger.info('Fetching models and providers');

    const resolved = await resolveAidomeProfile(context, profileId);
    if (!resolved) {
      return;
    }
    const { profile, client } = resolved;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Fetching models and providers for ${profile.name}...`,
        cancellable: false
      },
      async () => {
        try {
          const [modelsResult, providersResult] = await Promise.allSettled([
            client.getModels(),
            client.getProviders()
          ]);

          if (modelsResult.status === 'rejected') {
            throw modelsResult.reason;
          }

          const models = modelsResult.value;
          let providers: AIdomeProvider[] = [];
          let providersNote: string | undefined;

          if (providersResult.status === 'fulfilled') {
            providers = providersResult.value;
          } else if (providersResult.reason instanceof HttpError && providersResult.reason.status === 404) {
            providersNote = 'Providers endpoint not exposed by this gateway. Derived providers are shown from model metadata.';
            providers = deriveProvidersFromModels(models);
          } else {
            throw providersResult.reason;
          }

          if (providers.length === 0 && models.length > 0) {
            providers = deriveProvidersFromModels(models);
            if (providers.length > 0 && !providersNote) {
              providersNote = 'Providers derived from model metadata.';
            }
          }

          const outputChannel = getOutputChannel();
          outputChannel.appendLine('');
          outputChannel.appendLine('='.repeat(60));
          outputChannel.appendLine(`Models & Providers - ${profile.name}`);
          outputChannel.appendLine('='.repeat(60));

          outputChannel.appendLine('\nProviders:');
          if (providersNote) {
            outputChannel.appendLine(`  ${providersNote}`);
          }
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

          appendModelsSection(outputChannel, models);
          outputChannel.appendLine('\n' + '='.repeat(60));
          outputChannel.show();

          logger.info(`Displayed ${providers.length} providers and ${models.length} models for ${profile.name}`);
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

/**
 * Handles the showModels command.
 * Displays available models from the selected or active profile.
 */
export async function showModels(
  context: vscode.ExtensionContext,
  profileId?: string
): Promise<void> {
  const logger = Logger.getInstance();

  try {
    logger.info('Fetching models');

    const resolved = await resolveAidomeProfile(context, profileId);
    if (!resolved) {
      return;
    }

    const { profile, client } = resolved;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Fetching models for ${profile.name}...`,
        cancellable: false
      },
      async () => {
        try {
          const models = await client.getModels();
          const outputChannel = getOutputChannel();
          outputChannel.appendLine('');
          outputChannel.appendLine('='.repeat(60));
          outputChannel.appendLine(`Models - ${profile.name}`);
          outputChannel.appendLine('='.repeat(60));
          appendModelsSection(outputChannel, models);
          outputChannel.appendLine('\n' + '='.repeat(60));
          outputChannel.show();

          logger.info(`Displayed ${models.length} models for ${profile.name}`);
        } catch (error) {
          logger.error('Failed to fetch models', error instanceof Error ? error : undefined);
          throw error;
        }
      }
    );
  } catch (error) {
    logger.error('Failed to show models', error instanceof Error ? error : undefined);
    await showError(`Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resolveAidomeProfile(
  context: vscode.ExtensionContext,
  profileId?: string
): Promise<{ profile: EndpointProfile; client: AIdomeClient } | undefined> {
  const profileStore = new ProfileStore(context);
  const profile = await resolveProfile(context, profileId, profileStore);

  if (!profile) {
    await showWarning('No profile found. Please configure a profile first.', 'Setup');
    return undefined;
  }

  if (profile.profileType !== 'aidome') {
    await showWarning('Models inventory is only available for AIdome profiles.');
    return undefined;
  }

  const profileSecrets = new ProfileSecrets(context);
  const authToken = await resolveAidomeProfileAuthToken(profile, profileSecrets);
  return {
    profile,
    client: new AIdomeClient(profile, authToken)
  };
}

async function resolveProfile(
  context: vscode.ExtensionContext,
  profileId: string | undefined,
  profileStore: ProfileStore
): Promise<EndpointProfile | undefined> {
  const profiles = await profileStore.getProfiles();
  const aidomeProfiles = profiles.filter(profile => profile.profileType === 'aidome');

  if (profileId) {
    const selected = profiles.find(profile => profile.id === profileId);
    if (selected) {
      return selected;
    }

    Logger.getInstance().warning(`Requested models view for missing profile ${profileId}; prompting for a selectable AIdome profile.`);
  }

  if (aidomeProfiles.length === 0) {
    return undefined;
  }

  if (aidomeProfiles.length === 1) {
    return aidomeProfiles[0];
  }

  const selected = await vscode.window.showQuickPick(
    aidomeProfiles.map(profile => ({
      label: profile.name,
      description: profile.baseUrl,
      detail: profile.lastVerified
        ? `Last verified ${new Date(profile.lastVerified).toLocaleString()}`
        : 'Not yet verified',
      profile
    })),
    {
      title: 'Select AIdome Profile',
      placeHolder: 'Choose which AIdome profile to inspect'
    }
  );

  return selected?.profile;
}

function appendModelsSection(outputChannel: vscode.OutputChannel, models: Awaited<ReturnType<AIdomeClient['getModels']>>): void {
  outputChannel.appendLine('\nModels:');
  if (models.length === 0) {
    outputChannel.appendLine('  No models found');
    return;
  }

  models.forEach(model => {
    outputChannel.appendLine(`  • ${model.name} (${model.id})`);
    outputChannel.appendLine(`    Provider: ${model.provider}`);
    if (model.contextWindow > 0) {
      outputChannel.appendLine(`    Context: ${model.contextWindow} tokens`);
    }
    if (model.capabilities.length > 0) {
      outputChannel.appendLine(`    Capabilities: ${model.capabilities.join(', ')}`);
    }
  });
}

function deriveProvidersFromModels(models: AIdomeModel[]): AIdomeProvider[] {
  const providers = new Map<string, AIdomeProvider>();

  models.forEach(model => {
    const providerId = model.provider || 'unknown';
    const existing = providers.get(providerId);
    if (existing) {
      if (!existing.supportedModels.includes(model.id)) {
        existing.supportedModels.push(model.id);
      }
      return;
    }

    providers.set(providerId, {
      id: providerId,
      name: providerId,
      type: 'derived',
      status: 'active',
      supportedModels: [model.id]
    });
  });

  return [...providers.values()].sort((left, right) => left.name.localeCompare(right.name));
}
