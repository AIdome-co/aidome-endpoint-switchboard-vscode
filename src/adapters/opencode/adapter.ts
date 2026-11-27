/**
 * Adapter for the OpenCode CLI assistant.
 *
 * OpenCode reads a legacy `provider.<id>` config file (opencode.json /
 * opencode.jsonc) that stays compatible across installed releases. Verified
 * live against opencode 1.19.5 (snap): the newer upstream top-level
 * `providers` + `package`/`settings` shape is NOT accepted by installed
 * releases, so this adapter targets the legacy shape exclusively.
 *
 * Upstream evidence: sst/opencode packages/opencode/src/config/config.ts and
 * packages/opencode/src/config/provider.ts (ProviderConfig.options.baseURL /
 * options.apiKey / models), recorded in the provider descriptor.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { detectCli } from '../../core/detection/detectCLIs';
import { fileExists, readFileSafe } from '../../util/fsSafe';
import { sanitizeUrl, validateUrl } from '../../core/profiles/profileValidator';
import { normalizeOpenAiBaseUrl } from '../../core/providerConfig/endpointUrl';
import { discoverOpenAiModels, getCachedOpenAiModels } from '../../core/providerConfig/modelDiscovery';
import type { DiscoveredModel } from '../../core/providerConfig/modelDiscovery';
import type { AdapterDependencies } from '../adapterDependencies';
import {
  OPENCODE_PROVIDER_ID,
  OPENCODE_PROVIDER_NPM,
  OPENCODE_PROVIDER_NAME,
  getOpenCodeConfigPath,
  parseOpenCodeConfigForVerification
} from './opencodeConfigPatcher';

const OPENCODE_CLI_COMMAND = 'opencode';

interface OpenCodeProviderConfig {
  npm?: unknown;
  name?: unknown;
  options?: {
    baseURL?: unknown;
    apiKey?: unknown;
    [key: string]: unknown;
  };
  models?: unknown;
  [key: string]: unknown;
}

/**
 * OpenCode CLI adapter.
 */
export class OpenCodeAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = '';

  /** Profile URL expected by the most recent buildPlan, for exact verification. */
  private expectedBaseUrl: string | undefined;

  constructor(private readonly dependencies: AdapterDependencies = {}) {
    super();
  }

  async detect(): Promise<boolean> {
    try {
      const cliDetected = await detectCli(OPENCODE_CLI_COMMAND);
      if (cliDetected) {
        return true;
      }
      // Config-file presence also counts at the adapter level: opencode may
      // be installed without being resolvable on the extension host's PATH.
      // NOTE: the setup/assignment wizards drive their pickers from
      // `Switchboard.detectAll()` → `detectCLIs()`, which probes PATH only
      // for every CLI assistant (uniform for codex, claude-code, gemini-cli,
      // opencode); this fallback serves the adapter-level detect() contract
      // and does not add the assistant to the wizard's candidate list.
      return await fileExists(getOpenCodeConfigPath());
    } catch (error) {
      this.logger.error('Error detecting OpenCode', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('Invalid OpenCode endpoint URL');
    }

    const configPath = getOpenCodeConfigPath();
    // Gateway URLs already end with `/v1`; normalization is idempotent so the
    // version suffix is never doubled.
    const baseUrl = normalizeOpenAiBaseUrl(profile.baseUrl);
    // Remember the assigned profile's URL so verification requires an exact
    // match (fail closed when unknown — a config pointing at a different URL
    // must NOT verify for this profile).
    this.expectedBaseUrl = baseUrl;
    // The managed provider's models map is wholly owned by the Switchboard:
    // on every apply it is replaced with the CURRENT profile's full discovery
    // result (authoritative reconcile). An empty discovery probe writes no
    // models patch at all, so a failed lookup never wipes an existing map.
    const models = await this.discoverModels(profile);
    const managedModels: Record<string, Record<string, never>> = {};
    for (const model of models) {
      managedModels[model.id] = {};
    }

    let plan = createPlan(profile.id, ['opencode']);

    // PlanApplier owns backup-before-write for edit-config-file; the
    // backupRequired flag keeps the preview's recoverability guarantee
    // without executing a duplicate backup operation.
    plan = addStep(plan, {
      action: 'edit-config-file',
      description: `Set OpenCode AIdome gateway endpoint to ${sanitizeUrl(baseUrl)}`,
      assistantKey: 'opencode',
      targetPath: configPath,
      newValue: baseUrl,
      data: {
        driver: 'json-object',
        configPath,
        configType: 'opencode-config',
        backupRequired: true,
        providerId: OPENCODE_PROVIDER_ID,
        profileId: profile.id,
        profileName: profile.name,
        authRef: profile.authRef ?? profile.name,
        baseUrl,
        format: configPath.endsWith('.jsonc') ? 'jsonc' : 'json',
        secretPolicy: 'target-persisted-at-apply',
        patches: [
          { path: ['provider', OPENCODE_PROVIDER_ID, 'npm'], value: OPENCODE_PROVIDER_NPM },
          { path: ['provider', OPENCODE_PROVIDER_ID, 'name'], value: OPENCODE_PROVIDER_NAME },
          { path: ['provider', OPENCODE_PROVIDER_ID, 'options', 'baseURL'], source: 'baseUrl' },
          ...(models.length > 0
            ? [{ path: ['provider', OPENCODE_PROVIDER_ID, 'models'], value: managedModels }]
            : []),
          { path: ['provider', OPENCODE_PROVIDER_ID, 'options', 'apiKey'], source: 'secret', removeWhenMissing: true }
        ],
        clearAuthWhenMissing: true,
        missingSecretMessage: `OpenCode API key was cleared for "${profile.name}" because no saved profile secret was found. Re-enter the gateway token in the Switchboard profile and reapply.`
      },
      reversible: true
    });

    const guidanceData = {
      message: 'OpenCode profile-switch notes',
      steps: [
        `OpenCode reads provider.${OPENCODE_PROVIDER_ID} from ${configPath}.`,
        'When this profile is activated, Switchboard writes the profile\'s saved gateway token into provider.aidome.options.apiKey in that config file.',
        'If no saved secret exists for this profile, Switchboard clears the API key and OpenCode auth will fail until you save a token for the profile.',
        'Restart OpenCode after switching profiles so the new configuration is picked up.'
      ],
      baseUrl: profile.baseUrl,
      tier: 'A',
      optional: true
    } satisfies GuidedStepsData;
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Show OpenCode profile-switch notes',
      assistantKey: 'opencode',
      data: guidanceData,
      reversible: false
    });

    plan = addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify OpenCode configuration',
      assistantKey: 'opencode',
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
    const cliDetected = await detectCli(OPENCODE_CLI_COMMAND);
    const configPath = getOpenCodeConfigPath();
    const configPresent = await fileExists(configPath);

    if (!cliDetected && !configPresent) {
      return {
        success: false,
        message: 'OpenCode is not installed',
        details: { cli: false, configPath }
      };
    }

    const content = await readFileSafe(configPath);
    if (!content) {
      return {
        success: false,
        message: 'OpenCode config file not found',
        details: { cli: cliDetected, configPath }
      };
    }

    // Fail closed when the expected profile URL is unknown: "some valid
    // provider exists" is NOT a verified state — the managed provider must
    // match the assigned profile exactly.
    if (this.expectedBaseUrl === undefined) {
      return {
        success: false,
        message: 'OpenCode configuration exists, but the expected AIdome profile URL is unknown — apply a profile first to verify an exact match',
        details: { cli: cliDetected, configPath, exactUrlMatchVerified: false }
      };
    }

    let config: ReturnType<typeof parseOpenCodeConfigForVerification>;
    try {
      config = parseOpenCodeConfigForVerification(content);
    } catch (error) {
      return {
        success: false,
        message: `OpenCode config file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        details: { cli: cliDetected, configPath }
      };
    }

    const provider = config.provider?.[OPENCODE_PROVIDER_ID];
    if (!provider || typeof provider !== 'object') {
      return {
        success: false,
        message: 'OpenCode config does not have the managed AIdome provider configured',
        details: { cli: cliDetected, configPath }
      };
    }

    const options = provider.options;
    const baseURL = options && typeof options === 'object' ? options.baseURL : undefined;
    const apiKey = options && typeof options === 'object' ? options.apiKey : undefined;

    if (typeof baseURL !== 'string' || baseURL.trim().length === 0) {
      return {
        success: false,
        message: 'OpenCode config does not have provider.aidome.options.baseURL configured',
        details: { cli: cliDetected, configPath }
      };
    }

    if (!validateUrl(baseURL)) {
      return {
        success: false,
        message: 'OpenCode config has an invalid provider.aidome.options.baseURL',
        details: { cli: cliDetected, configPath }
      };
    }

    if (baseURL !== this.expectedBaseUrl) {
      return {
        success: false,
        message: 'OpenCode config points at a different endpoint than the assigned profile',
        details: { cli: cliDetected, configPath, expectedBaseUrl: sanitizeUrl(this.expectedBaseUrl), actualBaseUrl: sanitizeUrl(baseURL) }
      };
    }

    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return {
        success: false,
        message: 'OpenCode config does not have provider.aidome.options.apiKey configured',
        details: { cli: cliDetected, configPath }
      };
    }

    return {
      success: true,
      message: 'OpenCode gateway configuration verified',
      details: {
        cli: cliDetected,
        configPath,
        baseUrlConfigured: true,
        apiKeyConfigured: true,
        exactUrlMatchVerified: true,
        models: provider.models && typeof provider.models === 'object'
          ? Object.keys(provider.models as Record<string, unknown>)
          : []
      }
    };
  }

  getDisplayName(): string {
    return 'OpenCode';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
