/**
 * Show Models & Providers command handler.
 */

import * as vscode from 'vscode';
import { ProfileStore } from '../core/profiles/profileStore';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { EndpointProfile } from '../core/profiles/profileTypes';
import { getAuthHeadersForDialect } from '../core/dialects/authSchemes';
import { showError, showWarning } from '../ui/notifications';
import { getOutputChannel } from '../ui/output';
import { joinApiPath } from '../util/apiUrl';
import { httpRequest, HttpError } from '../util/http';
import { Logger } from '../util/log';

interface DisplayProvider {
  id: string;
  name: string;
  type?: string;
  status?: string;
  supportedModels: string[];
}

interface DisplayModel {
  id: string;
  name: string;
  provider?: string;
  contextWindow?: number;
  capabilities: string[];
}

interface EndpointInventory {
  providers: DisplayProvider[];
  models: DisplayModel[];
  providersMessage?: string;
  modelsMessage?: string;
}

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
    
    const profileStore = new ProfileStore(context);
    const targetProfile = profileId
      ? (await profileStore.getProfiles()).find((profile) => profile.id === profileId)
      : await profileStore.getActiveProfile();
    
    if (!targetProfile) {
      if (profileId) {
        await showWarning('The selected profile no longer exists. Refresh profiles and try again.');
        return;
      }

      await showWarning('No active profile found. Please configure a profile first.', 'Setup');
      return;
    }

    const profileSecrets = new ProfileSecrets(context);
    const authToken = targetProfile.authRef ? await profileSecrets.getSecret(targetProfile.authRef) : undefined;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Fetching models and providers...',
        cancellable: false
      },
      async () => {
        try {
          const inventory = await fetchEndpointInventory(targetProfile, authToken);
          
          const outputChannel = getOutputChannel();
          outputChannel.appendLine('');
          outputChannel.appendLine('='.repeat(60));
          outputChannel.appendLine(`Models & Providers - ${targetProfile.name}`);
          outputChannel.appendLine('='.repeat(60));
          outputChannel.appendLine(`Base URL: ${targetProfile.baseUrl}`);
          outputChannel.appendLine(`Dialect: ${targetProfile.dialect}`);
          outputChannel.appendLine(`Profile Type: ${targetProfile.profileType}`);
          
          outputChannel.appendLine('\nProviders:');
          if (inventory.providers.length === 0) {
            outputChannel.appendLine(`  ${inventory.providersMessage || 'No providers found'}`);
          } else {
            if (inventory.providersMessage) {
              outputChannel.appendLine(`  ${inventory.providersMessage}`);
            }

            inventory.providers.forEach(provider => {
              outputChannel.appendLine(`  • ${provider.name} (${provider.id})`);
              if (provider.type) {
                outputChannel.appendLine(`    Type: ${provider.type}`);
              }
              if (provider.status) {
                outputChannel.appendLine(`    Status: ${provider.status}`);
              }
              outputChannel.appendLine(`    Models: ${provider.supportedModels.length}`);
            });
          }
          
          outputChannel.appendLine('\nModels:');
          if (inventory.models.length === 0) {
            outputChannel.appendLine(`  ${inventory.modelsMessage || 'No models found'}`);
          } else {
            inventory.models.forEach(model => {
              outputChannel.appendLine(`  • ${model.name} (${model.id})`);
              outputChannel.appendLine(`    Provider: ${model.provider || 'unknown'}`);
              if (typeof model.contextWindow === 'number') {
                outputChannel.appendLine(`    Context: ${model.contextWindow} tokens`);
              }
              if (model.capabilities.length > 0) {
                outputChannel.appendLine(`    Capabilities: ${model.capabilities.join(', ')}`);
              }
            });
          }
          
          outputChannel.appendLine('\n' + '='.repeat(60));
          outputChannel.show();
          
          logger.info(`Displayed ${inventory.providers.length} providers and ${inventory.models.length} models for ${targetProfile.name}`);
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

async function fetchEndpointInventory(profile: EndpointProfile, authToken?: string): Promise<EndpointInventory> {
  const headerCandidates = buildHeaderCandidates(profile, authToken);
  const [providersResult, modelsResult] = await Promise.allSettled([
    fetchProviders(profile, headerCandidates),
    fetchModels(profile, headerCandidates)
  ]);

  const models = modelsResult.status === 'fulfilled' ? modelsResult.value.models : [];
  const fetchedProviders = providersResult.status === 'fulfilled' ? providersResult.value.providers : [];
  const providersMessage = providersResult.status === 'fulfilled'
    ? providersResult.value.message
    : formatEndpointFailure(providersResult.reason, 'Provider list is not available for this profile.');
  const synthesizedProviders = fetchedProviders.length === 0
    ? synthesizeProvidersFromModels(models)
    : [];

  return {
    providers: fetchedProviders.length > 0 ? fetchedProviders : synthesizedProviders,
    models,
    providersMessage: fetchedProviders.length > 0
      ? providersMessage
      : synthesizedProviders.length > 0
        ? 'Derived from model list because a dedicated providers list was unavailable.'
        : providersMessage,
    modelsMessage: modelsResult.status === 'fulfilled'
      ? modelsResult.value.message
      : formatEndpointFailure(modelsResult.reason, 'Model list is not available for this profile.')
  };
}

function buildHeaderCandidates(profile: EndpointProfile, authToken?: string): Record<string, string>[] {
  if (!authToken?.trim()) {
    return [{}];
  }

  const trimmedToken = authToken.trim();
  const dialectHeaders = getAuthHeadersForDialect(profile.dialect, trimmedToken);
  const bearerHeaders = { Authorization: `Bearer ${trimmedToken}` };

  if (headersEqual(dialectHeaders, bearerHeaders)) {
    return [dialectHeaders];
  }

  return [dialectHeaders, bearerHeaders];
}

function headersEqual(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => left[key] === right[key]);
}

async function fetchProviders(
  profile: EndpointProfile,
  headerCandidates: Record<string, string>[]
): Promise<{ providers: DisplayProvider[]; message?: string }> {
  try {
    const body = await requestWithFallback(joinApiPath(profile.baseUrl, '/v1/providers'), headerCandidates);
    const items = extractList(body);

    if (!items) {
      return {
        providers: [],
        message: 'Provider list response format is not recognized by this endpoint.'
      };
    }

    return {
      providers: items.map(normalizeProvider),
      message: items.length === 0 ? 'No providers found.' : undefined
    };
  } catch (error) {
    return {
      providers: [],
      message: formatEndpointFailure(error, 'Provider list is not available for this profile.')
    };
  }
}

async function fetchModels(
  profile: EndpointProfile,
  headerCandidates: Record<string, string>[]
): Promise<{ models: DisplayModel[]; message?: string }> {
  if (!supportsModelsList(profile)) {
    return {
      models: [],
      message: `Model list is not exposed for dialect ${profile.dialect}.`
    };
  }

  try {
    const body = await requestWithFallback(joinApiPath(profile.baseUrl, '/v1/models'), headerCandidates);
    const items = extractList(body);

    if (!items) {
      return {
        models: [],
        message: 'Model list response format is not recognized by this endpoint.'
      };
    }

    return {
      models: items.map(normalizeModel),
      message: items.length === 0 ? 'No models found.' : undefined
    };
  } catch (error) {
    return {
      models: [],
      message: formatEndpointFailure(error, 'Model list is not available for this profile.')
    };
  }
}

async function requestWithFallback(url: string, headerCandidates: Record<string, string>[]): Promise<unknown> {
  let lastError: unknown;

  for (const headers of headerCandidates) {
    try {
      const response = await httpRequest<unknown>(url, {
        method: 'GET',
        headers,
        retries: 1
      });

      return response.body;
    } catch (error) {
      lastError = error;

      if (error instanceof HttpError && error.status === 404) {
        break;
      }
    }
  }

  throw lastError;
}

function extractList(body: unknown): unknown[] | undefined {
  if (Array.isArray(body)) {
    return body;
  }

  if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown[] }).data)) {
    return (body as { data: unknown[] }).data;
  }

  return undefined;
}

function normalizeProvider(provider: unknown): DisplayProvider {
  if (!provider || typeof provider !== 'object') {
    return {
      id: 'unknown',
      name: String(provider ?? 'unknown'),
      supportedModels: []
    };
  }

  const candidate = provider as {
    id?: unknown;
    name?: unknown;
    type?: unknown;
    status?: unknown;
    supportedModels?: unknown;
    models?: unknown;
  };
  const supportedModels = Array.isArray(candidate.supportedModels)
    ? candidate.supportedModels.map((value) => String(value))
    : Array.isArray(candidate.models)
      ? candidate.models.map((value) => String(value))
      : [];

  return {
    id: String(candidate.id ?? candidate.name ?? 'unknown'),
    name: String(candidate.name ?? candidate.id ?? 'unknown'),
    type: typeof candidate.type === 'string' ? candidate.type : undefined,
    status: typeof candidate.status === 'string' ? candidate.status : undefined,
    supportedModels
  };
}

function normalizeModel(model: unknown): DisplayModel {
  if (!model || typeof model !== 'object') {
    return {
      id: 'unknown',
      name: String(model ?? 'unknown'),
      capabilities: []
    };
  }

  const candidate = model as {
    id?: unknown;
    name?: unknown;
    provider?: unknown;
    owned_by?: unknown;
    contextWindow?: unknown;
    context_window?: unknown;
    capabilities?: unknown;
  };
  const contextWindow = typeof candidate.contextWindow === 'number'
    ? candidate.contextWindow
    : typeof candidate.context_window === 'number'
      ? candidate.context_window
      : undefined;

  return {
    id: String(candidate.id ?? candidate.name ?? 'unknown'),
    name: String(candidate.name ?? candidate.id ?? 'unknown'),
    provider: typeof candidate.provider === 'string'
      ? candidate.provider
      : typeof candidate.owned_by === 'string'
        ? candidate.owned_by
        : inferProviderFromModelIdentifier(String(candidate.id ?? candidate.name ?? '')),
    contextWindow,
    capabilities: Array.isArray(candidate.capabilities)
      ? candidate.capabilities.map((value) => String(value))
      : []
  };
}

function synthesizeProvidersFromModels(models: DisplayModel[]): DisplayProvider[] {
  const providersById = new Map<string, DisplayProvider>();

  for (const model of models) {
    const providerId = normalizeProviderIdentifier(model.provider, model.id);

    if (!providerId) {
      continue;
    }

    const existing = providersById.get(providerId);

    if (existing) {
      if (!existing.supportedModels.includes(model.id)) {
        existing.supportedModels.push(model.id);
      }
      continue;
    }

    providersById.set(providerId, {
      id: providerId,
      name: providerId,
      supportedModels: [model.id]
    });
  }

  return [...providersById.values()];
}

function normalizeProviderIdentifier(provider: string | undefined, modelId: string): string | undefined {
  if (provider?.trim()) {
    return provider.trim();
  }

  return inferProviderFromModelIdentifier(modelId);
}

function inferProviderFromModelIdentifier(modelId: string): string | undefined {
  if (!modelId.includes('/')) {
    return undefined;
  }

  const [provider] = modelId.split('/', 1);
  return provider?.trim() || undefined;
}

function supportsModelsList(profile: EndpointProfile): boolean {
  const supportedDialects = ['openai.chat_completions', 'openai.responses', 'anthropic.messages'];
  return supportedDialects.includes(profile.dialect.toLowerCase());
}

function formatEndpointFailure(error: unknown, fallbackMessage: string): string {
  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) {
      return 'Authentication failed while fetching this list.';
    }

    if (error.status === 404) {
      return fallbackMessage;
    }

    return `Request failed with HTTP ${error.status}.`;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}
