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
import { discoverOpenAiModels, getCachedOpenAiModels } from '../../core/providerConfig/modelDiscovery';
import { parseConfigDocument, verifyFileTarget } from '../../core/providerConfig/engineVerification';
import { buildProviderConfigPlan } from '../../core/providerConfig/engine';
import * as path from 'path';
import { getProviderConfigDescriptor } from '../../core/providerConfig/descriptors';
import type { DiscoveredModel } from '../../core/providerConfig/modelDiscovery';
import type { AdapterDependencies } from '../adapterDependencies';

const DESCRIPTOR = getProviderConfigDescriptor('openai-codex');

/**
 * OpenAI Codex CLI adapter.
 */
export class CodexAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = '';

  /** Profile URL expected by the most recent buildPlan, for exact verification. */
  private expectedBaseUrl: string | undefined;

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
    this.expectedBaseUrl = profile.baseUrl;

    // Credential persistence: Codex loads <codex_home>/.env at startup
    // (upstream load_dotenv) — the official on-disk location for the
    // provider API key (config.toml keeps only the symbolic env_key).
    // Secret resolved from SecretStorage at APPLY time, never serialized
    // into the plan.
    plan = addStep(plan, {
      action: 'write-env-file',
      description: 'Persist gateway credential to the Codex .env file',
      assistantKey: 'openai-codex',
      targetPath: path.join(path.dirname(configPath), '.env'),
      data: {
        secretPolicy: 'target-persisted-at-apply',
        // A previous profile's credential must never survive a profile
        // switch: when the newly applied profile has no saved secret,
        // remove ONLY the managed key (unrelated variables preserved).
        missingSecretBehavior: 'remove-managed-key',
        // authRef is the SecretStorage lookup identity — profiles may have
        // name !== authRef; the name is for human-readable messages only.
        authRef: profile.authRef ?? profile.name,
        profileName: profile.name,
        envVarName: 'OPENAI_API_KEY'
      },
      reversible: true
    });

    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Provide Codex process authentication guidance',
      assistantKey: 'openai-codex',
      data: {
        message: 'Switchboard persists the gateway credential to ~/.codex/.env (loaded by Codex at startup). If apply reports a missing credential, set OPENAI_API_KEY in the environment that launches Codex.',
        steps: [
          'Switchboard writes OPENAI_API_KEY to ~/.codex/.env when the profile has a saved credential.',
          'If no saved credential exists, set OPENAI_API_KEY in the environment that launches Codex.',
          'Restart Codex after changing the environment.'
        ],
        envVarName: 'OPENAI_API_KEY',
        tier: 'A',
        // Informational: the missing-credential outcome is decided by the
        // write-env-file evidence (secretResolved), not by this note.
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

    // Fail closed when the expected profile URL is unknown: "some valid
    // selected Responses provider exists" is NOT a verified state — the
    // managed provider must match the assigned profile exactly.
    if (this.expectedBaseUrl === undefined) {
      return {
        success: false,
        message: 'Codex provider configuration exists, but the expected AIdome profile URL is unknown — apply a profile first to verify an exact match',
        details: { configPath, exactUrlMatchVerified: false }
      };
    }

    // Descriptor-driven, profile-aware verification via the shared engine
    // layer: selection, exact base URL (normalized per descriptor), wire API,
    // and required provider identity — path/field logic lives in the
    // descriptor's plan operations, not here.
    const document = parseConfigDocument(content, 'toml');
    if (!document.ok) {
      return {
        success: false,
        message: `Codex config file is not valid TOML: ${document.error}`,
        details: { configPath }
      };
    }

    const result = verifyFileTarget(DESCRIPTOR!, {
      parsed: document.parsed,
      profileBaseUrl: this.expectedBaseUrl
    });

    return {
      success: result.success,
      message: result.message,
      details: { configPath, ...result.details }
    };
  }

  getDisplayName(): string {
    return 'OpenAI Codex (CLI / IDE)';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
