/**
 * Adapter for OpenAI Codex CLI.
 *
 * ⚠️ RISK: OpenAI Codex CLI now ships from the Rust codex-rs codebase.
 * The config.toml schema and provider configuration format are owned by the
 * Rust codex-rs implementation. The adapter uses the current
 * `model_providers.<name>` table with the Responses wire API and keeps process
 * authentication as guided environment setup.
 * Verified against the synchronized openai/codex reference recorded in the
 * provider descriptor.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { detectCli } from '../../core/detection/detectCLIs';
import { getCodexConfigPath } from './codexConfigPatcher';
import { readFileSafe } from '../../util/fsSafe';
import { parse as parseToml } from 'smol-toml';
import { validateUrl } from '../../core/profiles/profileValidator';
import { discoverOpenAiModels, getCachedOpenAiModels } from '../../core/providerConfig/modelDiscovery';
import { buildProviderConfigPlan } from '../../core/providerConfig/engine';
import { getProviderConfigDescriptor } from '../../core/providerConfig/descriptors';
import type { DiscoveredModel } from '../../core/providerConfig/modelDiscovery';
import type { AdapterDependencies } from '../adapterDependencies';

const DESCRIPTOR = getProviderConfigDescriptor('openai-codex');

/**
 * OpenAI Codex CLI adapter.
 */
export class CodexAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = '';

  constructor(private readonly dependencies: AdapterDependencies = {}) {
    super();
  }

  async detect(): Promise<boolean> {
    try {
      return await detectCli('codex');
    } catch (error) {
      this.logger.error('Error detecting Codex CLI', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    const configPath = getCodexConfigPath();
    const models = await this.discoverModels(profile);
    const model = models[0]?.id;
    if (!DESCRIPTOR) {
      throw new Error('OpenAI Codex provider descriptor is missing');
    }

    let { plan } = buildProviderConfigPlan(DESCRIPTOR, {
      profile,
      resolvedTargetPaths: { 'codex-config': configPath },
      discoveredModels: model ? [model] : undefined,
    });

    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Provide Codex process authentication guidance',
      assistantKey: 'openai-codex',
      data: {
        message: 'Codex reads the configured provider credentials from the process environment.',
        steps: [
          'Set OPENAI_API_KEY in the environment that launches Codex if the gateway requires authentication.',
          'Restart Codex after changing the environment.',
          'Switchboard keeps the profile credential in SecretStorage and never writes it to config.toml.'
        ],
        envVarName: 'OPENAI_API_KEY',
        tier: 'A',
        optional: true
      },
      reversible: false
    });

    plan = addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify Codex configuration',
      assistantKey: 'openai-codex',
      data: { baseUrl: profile.baseUrl },
      reversible: false
    });

    return plan;
  }

  private async discoverModels(profile: EndpointProfile): Promise<DiscoveredModel[]> {
    const cached = getCachedOpenAiModels(profile);
    if (cached.length > 0) {
      return cached;
    }

    const token = profile.authRef && this.dependencies.profileSecrets
      ? await this.dependencies.profileSecrets.getSecret(profile.authRef)
      : undefined;
    return discoverOpenAiModels(profile.baseUrl, token);
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const configPath = getCodexConfigPath();
    const content = await readFileSafe(configPath);

    if (!content) {
      return {
        success: false,
        message: 'Codex config file not found',
        details: { configPath }
      };
    }

    let config: {
      model_provider?: unknown;
      model_providers?: Record<string, { base_url?: unknown; wire_api?: unknown }>;
    };
    try {
      config = parseToml(content) as typeof config;
    } catch {
      return {
        success: false,
        message: 'Codex config file is not valid TOML',
        details: { configPath }
      };
    }

    const providerName = config.model_provider;
    const provider = typeof providerName === 'string'
      ? config.model_providers?.[providerName]
      : undefined;
    const configuredBaseUrl = provider?.base_url;
    const hasProviderConfig = typeof providerName === 'string'
      && providerName.length > 0
      && typeof configuredBaseUrl === 'string'
      && validateUrl(configuredBaseUrl)
      && provider?.wire_api === 'responses';

    if (!hasProviderConfig) {
      return {
        success: false,
        message: 'Codex config does not have a valid selected Responses provider',
        details: { configPath, selectedProvider: providerName ?? null }
      };
    }

    return {
      success: true,
      message: 'Codex configuration verified',
      details: { configPath, provider: providerName, baseUrl: configuredBaseUrl, wireApi: provider?.wire_api }
    };
  }

  getDisplayName(): string {
    return 'OpenAI Codex (CLI / IDE)';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
