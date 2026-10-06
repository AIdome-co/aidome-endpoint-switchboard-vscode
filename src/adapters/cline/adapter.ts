/**
 * Adapter for current Cline releases.
 *
 * Cline's provider configuration is file-backed rather than a VS Code
 * setting. The native OpenAI-compatible provider lives in providers.json and
 * active provider/base-URL state lives in globalState.json.
 *
 * Upstream evidence: synchronized cline/cline reference recorded in the
 * provider descriptor, apps/vscode package
 * configuration, provider-migration.ts, model-catalog/store.ts, and
 * cline-session-factory.ts. See CHANGELOG.md for the research links.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { fileExists, readFileSafe } from '../../util/fsSafe';
import { sanitizeUrl, validateUrl } from '../../core/profiles/profileValidator';
import { normalizeOpenAiBaseUrl } from '../../core/providerConfig/endpointUrl';
import { discoverOpenAiModels, getCachedOpenAiModels } from '../../core/providerConfig/modelDiscovery';
import type { DiscoveredModel } from '../../core/providerConfig/modelDiscovery';
import type { AdapterDependencies } from '../adapterDependencies';
import {
  CLINE_LEGACY_PROVIDER_ID,
  CLINE_PROVIDER_ID,
  getClineConfigPaths,
  parseJsonObjectForVerification
} from './clineConfigPatcher';

const CLINE_EXTENSION_ID = 'saoudrizwan.claude-dev';

interface ProviderSettingsEntry {
  settings?: Record<string, unknown>;
  updatedAt?: string;
  tokenSource?: string;
}

interface ProviderSettingsDocument {
  version?: unknown;
  providers?: Record<string, ProviderSettingsEntry>;
}

interface GlobalStateDocument {
  openAiBaseUrl?: unknown;
  planModeApiProvider?: unknown;
  actModeApiProvider?: unknown;
}

/**
 * Cline endpoint adapter using Cline's native file-backed provider format.
 */
export class ClineAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = CLINE_EXTENSION_ID;

  /** Profile base URL captured at buildPlan for exact-profile verification (GAP 5). */
  private expectedBaseUrl: string | undefined;

  constructor(private readonly dependencies: AdapterDependencies = {}) {
    super();
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('Invalid Cline endpoint URL');
    }

    const paths = getClineConfigPaths();
    const baseUrl = normalizeOpenAiBaseUrl(profile.baseUrl);
    // Remember the assigned profile's URL so verification requires an exact
    // match (fail closed when unknown — internally consistent files pointing
    // at a different URL must NOT verify for this profile).
    this.expectedBaseUrl = baseUrl;
    const models = await this.discoverModels(profile);
    const modelId = models[0]?.id;
    const modelCatalog = buildModelCatalog(models);
    let plan = createPlan(profile.id, ['cline']);

    // PlanApplier owns backup-before-write for edit-config-file; the
    // backupRequired flag keeps the preview's recoverability guarantee
    // without executing a duplicate backup operation.

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: `Set Cline OpenAI-compatible endpoint to ${sanitizeUrl(baseUrl)}`,
      assistantKey: 'cline',
      targetPath: paths.providerSettingsPath,
      newValue: baseUrl,
      data: {
        driver: 'json-object',
        configPath: paths.providerSettingsPath,
        configType: 'cline-provider-settings',
        backupRequired: true,
        providerId: CLINE_PROVIDER_ID,
        profileId: profile.id,
        profileName: profile.name,
        authRef: profile.authRef ?? profile.name,
        baseUrl,
        format: 'json',
        secretPolicy: 'target-persisted-at-apply',
        patches: [
          { path: ['version'], value: 1 },
          { path: ['modes'], value: {}, setWhenMissing: true },
          { path: ['providers', CLINE_PROVIDER_ID, 'settings', 'provider'], value: CLINE_PROVIDER_ID },
          { path: ['providers', CLINE_PROVIDER_ID, 'settings', 'baseUrl'], source: 'baseUrl' },
          ...(modelId ? [{ path: ['providers', CLINE_PROVIDER_ID, 'settings', 'model'], value: modelId }] : []),
          { path: ['providers', CLINE_PROVIDER_ID, 'settings', 'apiKey'], source: 'secret', removeWhenMissing: true },
          { path: ['providers', CLINE_PROVIDER_ID, 'updatedAt'], source: 'timestamp' },
          { path: ['providers', CLINE_PROVIDER_ID, 'tokenSource'], value: 'manual' }
        ],
        clearAuthWhenMissing: true,
        missingSecretMessage: `Cline API key was cleared for "${profile.name}" because no saved profile secret was found. Re-enter the gateway token in the Switchboard profile and reapply.`
      },
      reversible: true
    });

    // GAP 6: PlanApplier backs up paths.secretsMirrorPath before its edit-config-file step;
    // backupRequired below is preview metadata, not a duplicate backup.
    plan = addStep(plan, {
      action: 'edit-config-file',
      description: 'Sync Cline legacy secrets mirror with the profile credential',
      assistantKey: 'cline',
      targetPath: paths.secretsMirrorPath,
      newValue: baseUrl,
      data: {
        driver: 'json-object',
        configPath: paths.secretsMirrorPath,
        configType: 'cline-legacy-secrets',
        backupRequired: true,
        providerId: CLINE_PROVIDER_ID,
        profileId: profile.id,
        profileName: profile.name,
        authRef: profile.authRef ?? profile.name,
        baseUrl,
        format: 'json',
        secretPolicy: 'target-persisted-at-apply',
        patches: [
          { path: ['openAiApiKey'], source: 'secret', removeWhenMissing: true }
        ],
        clearAuthWhenMissing: false
      },
      reversible: true
    });

    // GAP 6: PlanApplier backs up paths.globalStatePath before its edit-config-file step;
    // backupRequired below is preview metadata, not a duplicate backup.

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: 'Select Cline OpenAI-compatible provider',
      assistantKey: 'cline',
      targetPath: paths.globalStatePath,
      newValue: baseUrl,
      data: {
        driver: 'json-object',
        configPath: paths.globalStatePath,
        configType: 'cline-global-state',
        backupRequired: true,
        providerId: CLINE_LEGACY_PROVIDER_ID,
        profileId: profile.id,
        baseUrl,
        format: 'json',
        patches: [
          { path: ['openAiBaseUrl'], source: 'baseUrl' },
          { path: ['planModeApiProvider'], value: CLINE_LEGACY_PROVIDER_ID },
          { path: ['actModeApiProvider'], value: CLINE_LEGACY_PROVIDER_ID },
          ...(modelId ? [
            { path: ['planModeOpenAiModelId'], value: modelId },
            { path: ['actModeOpenAiModelId'], value: modelId }
          ] : [])
        ]
      },
      reversible: true
    });

    // GAP 6: PlanApplier backs up paths.modelCatalogPath before its edit-config-file step;
    // backupRequired below is preview metadata, not a duplicate backup.

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: 'Update Cline OpenAI-compatible model catalog',
      assistantKey: 'cline',
      targetPath: paths.modelCatalogPath,
      newValue: baseUrl,
      data: {
        driver: 'json-object',
        configPath: paths.modelCatalogPath,
        configType: 'cline-model-catalog',
        backupRequired: true,
        profileId: profile.id,
        baseUrl,
        format: 'json',
        patches: [
          { path: ['version'], value: 1 },
          { path: ['providers', CLINE_PROVIDER_ID, 'provider', 'name'], value: 'OpenAI Compatible' },
          { path: ['providers', CLINE_PROVIDER_ID, 'provider', 'baseUrl'], source: 'baseUrl' },
          ...(modelId ? [{ path: ['providers', CLINE_PROVIDER_ID, 'provider', 'defaultModelId'], value: modelId }] : []),
          ...(Object.keys(modelCatalog).length > 0 ? [{
            path: ['providers', CLINE_PROVIDER_ID, 'models'],
            value: modelCatalog,
            mergeObject: true
          }] : [])
        ]
      },
      reversible: true
    });

    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Configure Cline gateway authentication',
      assistantKey: 'cline',
      data: {
        message: 'Cline stores OpenAI-compatible credentials in its own provider store.',
        steps: [
          'Open Cline provider settings and select OpenAI Compatible.',
          `Set the endpoint to ${baseUrl}.`,
          'Enter the saved AIdome profile token in Cline’s API key field, then save.',
          ...(modelId ? [`Select model ${modelId}.`] : ['Select a model returned by the gateway.']),
          'Restart or reload Cline before sending a new task.'
        ],
        baseUrl,
        tier: 'A',
        limitation: 'Cline API key is persisted into providers.json from the profile secret at apply time (target-persisted-at-apply), mirroring the Codex env-file credential flow.',
        configurationType: 'cline-provider-ui',
        // GAP 2: the credential is persisted automatically at apply
        // (target-persisted-at-apply) — this guidance is advisory
        // (fallback manual path), not a required user step.
        optional: true
      },
      reversible: false
    });

    plan = addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify Cline native provider configuration',
      assistantKey: 'cline',
      data: {
        providerSettingsPath: paths.providerSettingsPath,
        globalStatePath: paths.globalStatePath,
        baseUrl,
        providerId: CLINE_PROVIDER_ID
      },
      reversible: false
    });

    return plan;
  }

  private async discoverModels(profile: EndpointProfile): Promise<DiscoveredModel[]> {
    const cached = getCachedOpenAiModels(profile);
    if (cached.length > 0) {
      return cached;
    }

    if (!this.dependencies.profileSecrets) {
      return [];
    }

    const token = profile.authRef
      ? await this.dependencies.profileSecrets.getSecret(profile.authRef)
      : undefined;
    return discoverOpenAiModels(profile.baseUrl, token);
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const paths = getClineConfigPaths();
    const [providerSettingsContent, globalStateContent] = await Promise.all([
      readFileSafe(paths.providerSettingsPath),
      readFileSafe(paths.globalStatePath)
    ]);

    if (!providerSettingsContent || !globalStateContent) {
      return {
        success: false,
        message: 'Cline native provider configuration files are missing',
        details: {
          providerSettingsPath: paths.providerSettingsPath,
          globalStatePath: paths.globalStatePath,
          providerSettingsPresent: Boolean(providerSettingsContent),
          globalStatePresent: Boolean(globalStateContent)
        }
      };
    }

    const providerDocument = parseJsonObjectForVerification(providerSettingsContent) as ProviderSettingsDocument | undefined;
    const globalState = parseJsonObjectForVerification(globalStateContent) as GlobalStateDocument | undefined;

    if (!providerDocument || !globalState || !isValidProviderDocument(providerDocument)) {
      return {
        success: false,
        message: 'Cline native provider configuration contains invalid JSON',
        details: {
          providerSettingsPath: paths.providerSettingsPath,
          globalStatePath: paths.globalStatePath
        }
      };
    }

    // GAP 5: exact-profile URL verification. The coordinated-store checks
    // alone would accept internally-consistent files pointing at a different
    // profile's URL.
    const expectedBaseUrl = this.expectedBaseUrl !== undefined
      ? normalizeOpenAiBaseUrl(this.expectedBaseUrl)
      : undefined;
    if (expectedBaseUrl === undefined) {
      return {
        success: false,
        message: 'Cline configuration files are internally consistent, but the expected AIdome profile URL is unknown — apply a profile first to verify an exact match',
        details: {
          providerSettingsPath: paths.providerSettingsPath,
          globalStatePath: paths.globalStatePath,
          exactUrlMatchVerified: false
        }
      };
    }

    const providerEntry = providerDocument.providers?.[CLINE_PROVIDER_ID];
    const providerSettings = providerEntry?.settings;
    const providerBaseUrl = providerSettings?.baseUrl;
    const globalBaseUrl = globalState.openAiBaseUrl;
    const planProvider = normalizeProvider(globalState.planModeApiProvider);
    const actProvider = normalizeProvider(globalState.actModeApiProvider);

    if (!providerEntry || providerSettings?.provider !== CLINE_PROVIDER_ID) {
      return {
        success: false,
        message: 'Cline providers.json does not select the OpenAI-compatible provider',
        details: { providerSettingsPath: paths.providerSettingsPath, expectedProviderId: CLINE_PROVIDER_ID }
      };
    }

    if (planProvider !== CLINE_LEGACY_PROVIDER_ID || actProvider !== CLINE_LEGACY_PROVIDER_ID) {
      return {
        success: false,
        message: 'Cline globalState.json does not select the OpenAI-compatible provider for both modes',
        details: {
          globalStatePath: paths.globalStatePath,
          planModeApiProvider: globalState.planModeApiProvider,
          actModeApiProvider: globalState.actModeApiProvider,
          expectedProviderId: CLINE_LEGACY_PROVIDER_ID
        }
      };
    }

    if (typeof providerBaseUrl !== 'string' || !validateUrl(providerBaseUrl)) {
      return {
        success: false,
        message: 'Cline providers.json has no valid OpenAI-compatible base URL',
        details: { providerSettingsPath: paths.providerSettingsPath }
      };
    }

    if (typeof globalBaseUrl !== 'string' || !validateUrl(globalBaseUrl)) {
      return {
        success: false,
        message: 'Cline globalState.json has no valid OpenAI-compatible base URL',
        details: { globalStatePath: paths.globalStatePath }
      };
    }

    const providerUrlNormalized = normalizeOpenAiBaseUrl(providerBaseUrl);
    const globalUrlNormalized = normalizeOpenAiBaseUrl(globalBaseUrl);
    if (providerUrlNormalized !== expectedBaseUrl || globalUrlNormalized !== expectedBaseUrl) {
      return {
        success: false,
        message: 'Cline configuration does not match the assigned profile base URL',
        details: {
          providerSettingsPath: paths.providerSettingsPath,
          globalStatePath: paths.globalStatePath,
          providerBaseUrl: sanitizeUrl(providerBaseUrl),
          globalBaseUrl: sanitizeUrl(globalBaseUrl),
          expectedBaseUrl: sanitizeUrl(expectedBaseUrl)
        }
      };
    }

    if (providerBaseUrl !== globalBaseUrl) {
      return {
        success: false,
        message: 'Cline provider and global-state base URLs do not match',
        details: {
          providerSettingsPath: paths.providerSettingsPath,
          globalStatePath: paths.globalStatePath,
          providerBaseUrl: sanitizeUrl(providerBaseUrl),
          globalBaseUrl: sanitizeUrl(globalBaseUrl)
        }
      };
    }

    const hasApiKey = typeof providerSettings?.apiKey === 'string'
      && providerSettings.apiKey.trim().length > 0;
    return {
      success: true,
      message: hasApiKey
        ? 'Cline native provider configuration verified'
        : 'Cline native provider configuration verified (no API key set)',
      details: {
        providerSettingsPath: paths.providerSettingsPath,
        globalStatePath: paths.globalStatePath,
        providerId: CLINE_PROVIDER_ID,
        planModeApiProvider: planProvider,
        actModeApiProvider: actProvider,
        baseUrlConfigured: true,
        apiKeyConfigured: hasApiKey
      }
    };
  }

  getDisplayName(): string {
    return 'Cline';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}

function buildModelCatalog(models: DiscoveredModel[]): Record<string, Record<string, unknown>> {
  const catalog: Record<string, Record<string, unknown>> = {};
  for (const model of models) {
    catalog[model.id] = {
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow ?? 128_000,
      maxInputTokens: model.maxInputTokens ?? model.contextWindow ?? 128_000,
      capabilities: model.capabilities ?? ['streaming', 'tools']
    };
  }
  return catalog;
}

function normalizeProvider(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === CLINE_PROVIDER_ID ? CLINE_LEGACY_PROVIDER_ID : normalized;
}

function isValidProviderDocument(document: ProviderSettingsDocument): boolean {
  if (document.version !== 1 || !document.providers) {
    return false;
  }

  const entry = document.providers[CLINE_PROVIDER_ID];
  return Boolean(
    entry
      && typeof entry.updatedAt === 'string'
      && !Number.isNaN(Date.parse(entry.updatedAt))
      && (entry.tokenSource === undefined
        || entry.tokenSource === 'manual'
        || entry.tokenSource === 'oauth'
        || entry.tokenSource === 'migration')
  );
}
