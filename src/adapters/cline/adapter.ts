/**
 * Adapter for current Cline releases.
 *
 * Cline's provider configuration is file-backed rather than a VS Code
 * setting. The native OpenAI-compatible provider lives in providers.json and
 * active provider/base-URL state lives in globalState.json.
 *
 * Upstream evidence: cline/cline 8bbdde2 (2026-08-14), apps/vscode package
 * configuration, provider-migration.ts, model-catalog/store.ts, and
 * cline-session-factory.ts. See CHANGELOG.md for the research links.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { fileExists, readFileSafe } from '../../util/fsSafe';
import { validateUrl } from '../../core/profiles/profileValidator';
import {
  CLINE_LEGACY_PROVIDER_ID,
  CLINE_PROVIDER_ID,
  buildGlobalStateContent,
  buildProviderSettingsContent,
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

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('Invalid Cline endpoint URL');
    }

    const paths = getClineConfigPaths();
    const [providerSettingsContent, globalStateContent] = await Promise.all([
      readFileSafe(paths.providerSettingsPath),
      readFileSafe(paths.globalStatePath)
    ]);
    const timestamp = new Date().toISOString();
    let plan = createPlan(profile.id, ['cline']);

    // PlanApplier also backs up edit-config-file steps immediately before
    // writing. The explicit backup steps make the plan preview show the
    // recoverability guarantee and match the other file-backed adapters.
    if (await fileExists(paths.providerSettingsPath)) {
      plan = addStep(plan, {
        action: 'backup-file',
        description: 'Backup Cline provider settings',
        assistantKey: 'cline',
        targetPath: paths.providerSettingsPath,
        data: { configPath: paths.providerSettingsPath },
        reversible: true
      });
    }

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: `Set Cline OpenAI-compatible endpoint to ${profile.baseUrl}`,
      assistantKey: 'cline',
      targetPath: paths.providerSettingsPath,
      newValue: buildProviderSettingsContent(profile.baseUrl, providerSettingsContent, timestamp),
      data: {
        configPath: paths.providerSettingsPath,
        configType: 'cline-provider-settings',
        providerId: CLINE_PROVIDER_ID,
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        format: 'json'
      },
      reversible: true
    });

    if (await fileExists(paths.globalStatePath)) {
      plan = addStep(plan, {
        action: 'backup-file',
        description: 'Backup Cline global state',
        assistantKey: 'cline',
        targetPath: paths.globalStatePath,
        data: { configPath: paths.globalStatePath },
        reversible: true
      });
    }

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: 'Select Cline OpenAI-compatible provider',
      assistantKey: 'cline',
      targetPath: paths.globalStatePath,
      newValue: buildGlobalStateContent(profile.baseUrl, globalStateContent),
      data: {
        configPath: paths.globalStatePath,
        configType: 'cline-global-state',
        providerId: CLINE_LEGACY_PROVIDER_ID,
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        format: 'json'
      },
      reversible: true
    });

    plan = addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify Cline native provider configuration',
      assistantKey: 'cline',
      data: {
        providerSettingsPath: paths.providerSettingsPath,
        globalStatePath: paths.globalStatePath,
        baseUrl: profile.baseUrl,
        providerId: CLINE_PROVIDER_ID
      },
      reversible: false
    });

    return plan;
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

    if (providerBaseUrl !== globalBaseUrl) {
      return {
        success: false,
        message: 'Cline provider and global-state base URLs do not match',
        details: {
          providerSettingsPath: paths.providerSettingsPath,
          globalStatePath: paths.globalStatePath,
          providerBaseUrl,
          globalBaseUrl
        }
      };
    }

    return {
      success: true,
      message: 'Cline native provider configuration verified',
      details: {
        providerSettingsPath: paths.providerSettingsPath,
        globalStatePath: paths.globalStatePath,
        providerId: CLINE_PROVIDER_ID,
        planModeApiProvider: planProvider,
        actModeApiProvider: actProvider,
        baseUrlConfigured: true
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
