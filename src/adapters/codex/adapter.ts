/**
 * Adapter for OpenAI Codex CLI.
 *
 * Codex stores custom providers in the user-level config.toml under
 * `[model_providers.<id>]`. The native provider uses the OpenAI Responses API;
 * credentials remain in the launch environment through Codex's `env_key`
 * setting and are never copied into config.toml.
 *
 * Verified against openai/codex main at commit b3cc21737803549679e2009193c04205f7d8d19c
 * (2026-08-15; after rust-v0.148.0-alpha.19).
 */

import { parse } from 'smol-toml';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { detectCli } from '../../core/detection/detectCLIs';
import { getCodexConfigPath } from './codexConfigPatcher';
import { fileExists, readFileSafe } from '../../util/fsSafe';
import { validateUrl } from '../../core/profiles/profileValidator';

const CODEX_PROVIDER_ID = 'aidome';
const CODEX_PROVIDER_NAME = 'AIdome Gateway';
const CODEX_API_KEY_ENV_VAR = 'OPENAI_API_KEY';

interface CodexProviderConfig {
  name?: unknown;
  base_url?: unknown;
  env_key?: unknown;
  wire_api?: unknown;
  [key: string]: unknown;
}

interface CodexConfig {
  model_provider?: unknown;
  model_providers?: unknown;
  providers?: unknown;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * OpenAI Codex CLI adapter.
 */
export class CodexAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = '';

  async detect(): Promise<boolean> {
    try {
      return await detectCli('codex');
    } catch (error) {
      this.logger.error('Error detecting Codex CLI', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('Codex provider base URL must use https:// or localhost http://');
    }

    const configPath = getCodexConfigPath();
    let plan = createPlan(profile.id, ['openai-codex']);

    const configExists = await fileExists(configPath);
    if (configExists) {
      plan = addStep(plan, {
        action: 'backup-file',
        description: 'Backup Codex config file',
        assistantKey: 'openai-codex',
        targetPath: configPath,
        data: { configPath },
        reversible: true
      });
    }

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: `Set Codex provider to ${profile.baseUrl}`,
      assistantKey: 'openai-codex',
      targetPath: configPath,
      newValue: profile.baseUrl,
      data: { 
        configPath, 
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        format: 'toml',
        providerName: CODEX_PROVIDER_ID,
        wireApi: 'responses',
        ...(profile.authRef ? { authEnvVar: CODEX_API_KEY_ENV_VAR } : {})
      },
      reversible: true
    });

    if (profile.authRef) {
      const authGuidanceData = {
        message: 'Codex provider authentication setup',
        steps: [
          `Set ${CODEX_API_KEY_ENV_VAR} in the environment used to launch Codex.`,
          `Codex will read that variable for the ${CODEX_PROVIDER_ID} provider; Switchboard keeps the saved profile secret in SecretStorage and does not write it to config.toml.`,
          'Restart Codex or VS Code after changing the environment so the process can read the variable.'
        ],
        baseUrl: profile.baseUrl,
        tier: 'A',
        optional: true,
        envVarName: CODEX_API_KEY_ENV_VAR,
        limitation: 'Codex reads custom-provider credentials from its process environment.'
      } satisfies GuidedStepsData;
      plan = addStep(plan, {
        action: 'show-guided-steps',
        description: 'Show Codex provider authentication setup',
        assistantKey: 'openai-codex',
        data: authGuidanceData,
        reversible: false
      });
    }

    plan = addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify Codex configuration',
      assistantKey: 'openai-codex',
      data: { baseUrl: profile.baseUrl },
      reversible: false
    });

    return plan;
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const configPath = getCodexConfigPath();
    const content = await readFileSafe(configPath);

    if (content === undefined) {
      return {
        success: false,
        message: 'Codex config file not found',
        details: { configPath }
      };
    }

    let config: CodexConfig;
    try {
      const parsed = parse(content) as unknown;
      if (!isRecord(parsed)) {
        throw new Error('configuration root must be a TOML table');
      }
      config = parsed as CodexConfig;
    } catch {
      return {
        success: false,
        message: 'Codex config file is not valid TOML',
        details: { configPath }
      };
    }

    if ('providers' in config) {
      return {
        success: false,
        message: 'Codex config uses unsupported providers table; expected model_providers',
        details: { configPath }
      };
    }

    if (config.model_provider !== CODEX_PROVIDER_ID) {
      return {
        success: false,
        message: 'Codex config does not select the AIdome model provider',
        details: { configPath }
      };
    }

    if (!isRecord(config.model_providers)) {
      return {
        success: false,
        message: 'Codex config does not have a model_providers table',
        details: { configPath }
      };
    }

    const provider = config.model_providers[CODEX_PROVIDER_ID];
    if (!isRecord(provider)) {
      return {
        success: false,
        message: 'Codex config does not have an AIdome provider entry',
        details: { configPath }
      };
    }

    const providerConfig = provider as CodexProviderConfig;
    if ('api_key' in providerConfig) {
      return {
        success: false,
        message: 'Codex AIdome provider uses unsupported api_key; use env_key instead',
        details: { configPath }
      };
    }

    if (providerConfig.name !== CODEX_PROVIDER_NAME) {
      return {
        success: false,
        message: 'Codex AIdome provider is missing its required name',
        details: { configPath }
      };
    }

    if (typeof providerConfig.base_url !== 'string' || !validateUrl(providerConfig.base_url)) {
      return {
        success: false,
        message: 'Codex AIdome provider has an invalid base_url',
        details: { configPath }
      };
    }

    if (providerConfig.wire_api !== undefined && providerConfig.wire_api !== 'responses') {
      return {
        success: false,
        message: 'Codex AIdome provider must use the Responses API',
        details: { configPath }
      };
    }

    return {
      success: true,
      message: 'Codex configuration verified',
      details: {
        configPath,
        provider: CODEX_PROVIDER_ID,
        wireApi: 'responses',
        authEnvironmentVariable: typeof providerConfig.env_key === 'string'
          ? providerConfig.env_key
          : undefined
      }
    };
  }

  getDisplayName(): string {
    return 'OpenAI Codex (CLI / IDE)';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
