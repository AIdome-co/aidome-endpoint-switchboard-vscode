/**
 * Adapter for Continue.dev assistant.
 *
 * Thin wrapper around the ProviderConfigEngine: the descriptor's declarative
 * plan operations define the model-array mutation; the adapter resolves the
 * active config path (YAML primary, legacy JSONC fallback — an allowed
 * unusual-target hook) and discovers the gateway's model ids so the driver
 * can write one managed entry per model (Continue's config schema requires a
 * `model` field on every entry).
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { getContinueConfigPath } from './paths';
import { readFileSafe } from '../../util/fsSafe';
import { parseContinueModels } from './continueConfigPatcher';
import { buildProviderConfigPlan } from '../../core/providerConfig/engine';
import { normalizeOpenAiBaseUrl } from '../../core/providerConfig/endpointUrl';
import {
  getProviderConfigDescriptor,
} from '../../core/providerConfig/descriptors';
import { AIDOME_MODEL_IDENTITY } from '../../core/providerConfig/types';
import {
  discoverOpenAiModels,
  getCachedOpenAiModels,
} from '../../core/providerConfig/modelDiscovery';
import type { AdapterDependencies } from '../adapterDependencies';

const DESCRIPTOR = getProviderConfigDescriptor('continue');

/**
 * Continue.dev assistant adapter.
 */
export class ContinueAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'Continue.continue';

  /** Profile URL expected by the most recent buildPlan, for exact verification. */
  private expectedBaseUrl: string | undefined;

  constructor(private readonly dependencies: AdapterDependencies = {}) {
    super();
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    const configPath = getContinueConfigPath();
    if (!DESCRIPTOR) {
      throw new Error('Continue provider descriptor is missing');
    }

    const targetId = configPath.endsWith('.yaml') ? 'continue-primary-yaml' : 'continue-legacy-json';
    const models = await this.discoverModels(profile);
    let { plan } = buildProviderConfigPlan(DESCRIPTOR, {
      profile,
      resolvedTargetPaths: { [targetId]: configPath },
      discoveredModels: models.map(model => model.id)
    });

    // Fail closed (Codex 157 round 2): a Continue models[] entry without a
    // `model` field is rejected by the vendor, so when no gateway models
    // could be discovered the plan must NOT write the legacy model-less
    // entry and claim success. Replace it with guidance instead — the
    // outcome then classifies as guided-required, not configured.
    if (models.length === 0) {
      plan.steps = plan.steps.filter(step => step.action !== 'edit-config-file');
      plan = addStep(plan, {
        action: 'show-guided-steps',
        description: 'Continue.dev model discovery returned no models',
        assistantKey: 'continue',
        data: {
          message: `No models were discovered at ${profile.baseUrl}. Continue cannot be configured without a valid model entry.`,
          steps: [
            'Save a credential for this profile — the gateway model list is token-scoped.',
            'Verify the profile base URL exposes the OpenAI-compatible /v1/models endpoint.',
            'Re-run the Switchboard wizard to apply the profile.'
          ],
          baseUrl: profile.baseUrl,
          tier: 'A',
          optional: false
        },
        reversible: false
      });
    }
    this.expectedBaseUrl = profile.baseUrl;

    return addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify Continue.dev configuration',
      assistantKey: 'continue',
      data: { baseUrl: profile.baseUrl },
      reversible: false
    });
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const configPath = getContinueConfigPath();
    const content = await readFileSafe(configPath);

    if (!content) {
      return {
        success: false,
        message: 'Continue.dev config file not found',
        details: { configPath }
      };
    }

    // Profile-aware verification: at least one Switchboard-managed entry
    // (identity name, or the per-model "identity - <modelId>" name the
    // multi-model driver writes) must exist AND its apiBase must exactly
    // match the expected profile URL. "Some model has apiBase" is not a
    // pass — that would false-positive on unrelated user models.
    const format = configPath.endsWith('.yaml') ? 'yaml' : 'jsonc';
    const models = parseContinueModels(content, format);
    const managed = models.filter(model => this.isManagedEntry(model));

    if (managed.length === 0) {
      return {
        success: false,
        message: `Continue.dev config has no ${AIDOME_MODEL_IDENTITY} model entry`,
        details: { configPath, format, modelCount: models.length }
      };
    }

    const withApiBase = managed.filter(model => typeof model.apiBase === 'string');
    if (withApiBase.length === 0) {
      return {
        success: false,
        message: `Continue.dev ${AIDOME_MODEL_IDENTITY} entries have no apiBase configured`,
        details: { configPath, format, modelCount: models.length }
      };
    }

    const expectedBaseUrl = this.expectedBaseUrl !== undefined
      ? normalizeOpenAiBaseUrl(this.expectedBaseUrl)
      : undefined;
    if (expectedBaseUrl === undefined) {
      return {
        success: false,
        message: 'Continue.dev apiBase is set, but the expected AIdome profile URL is unknown — apply a profile first to verify an exact match',
        details: { configPath, format, modelCount: models.length }
      };
    }

    const wrongUrl = managed.filter(model => model.apiBase !== expectedBaseUrl);
    if (wrongUrl.length > 0) {
      return {
        success: false,
        message: `Continue.dev ${AIDOME_MODEL_IDENTITY} apiBase (${String(wrongUrl[0].apiBase)}) does not match the expected profile URL (${expectedBaseUrl})`,
        details: { configPath, format, modelCount: models.length, expectedBaseUrl }
      };
    }

    // Credential verification (Tier A): managed entries must carry the
    // gateway key — Continue reads it from this file at request time.
    const missingKey = managed.filter(model =>
      typeof model.apiKey !== 'string' || model.apiKey.trim().length === 0
    );
    if (missingKey.length > 0) {
      return {
        success: false,
        message: `Continue.dev ${AIDOME_MODEL_IDENTITY} entries have no apiKey configured — save a credential for the profile and re-apply it`,
        details: { configPath, format, modelCount: models.length }
      };
    }

    // `model` is the field this integration exists to guarantee (Continue's
    // schema requires it and rejects entries without it), so verification
    // fails when any managed entry is missing or has a blank model value.
    const missingModel = managed.filter(model =>
      typeof model.model !== 'string' || model.model.trim().length === 0
    );
    if (missingModel.length > 0) {
      return {
        success: false,
        message: `Continue.dev ${AIDOME_MODEL_IDENTITY} entries have no model id configured — re-apply the profile so Switchboard rewrites them with one entry per gateway model`,
        details: { configPath, format, modelCount: models.length }
      };
    }

    return {
      success: true,
      message: 'Continue.dev configuration verified',
      details: {
        configPath,
        format,
        modelCount: models.length,
        managedEntries: managed.length
      }
    };
  }

  /** Managed-entry predicate: exact identity name (legacy) or a per-model
   * "identity - <id>" name carrying the ownership marker — the same strict
   * rule the driver uses, so a user entry that merely collides with the
   * prefix is never pulled into verification checks. */
  private isManagedEntry(model: { name?: string; title?: string; aidomeManaged?: unknown; [key: string]: unknown }): boolean {
    const withSeparator = `${AIDOME_MODEL_IDENTITY} - `;
    if (model.name === AIDOME_MODEL_IDENTITY || model.title === AIDOME_MODEL_IDENTITY) {
      return true;
    }
    const prefixMatch = (typeof model.name === 'string' && model.name.startsWith(withSeparator))
      || (typeof model.title === 'string' && model.title.startsWith(withSeparator));
    return prefixMatch && model.aidomeManaged === true;
  }

  /**
   * Queries the CURRENT endpoint first and falls back to the capabilities
   * cache only when the live lookup fails or returns nothing (Codex 157
   * round 5): the cache has no expiry and does not invalidate on URL/token
   * changes, so trusting it first would apply a stale model catalog
   * indefinitely.
   */
  private async discoverModels(profile: EndpointProfile) {
    const token = profile.authRef && this.dependencies.profileSecrets
      ? await this.dependencies.profileSecrets.getSecret(profile.authRef)
      : undefined;
    const live = await discoverOpenAiModels(profile.baseUrl, token);
    if (live.length > 0) {
      return live;
    }
    return getCachedOpenAiModels(profile);
  }

  getDisplayName(): string {
    return 'Continue.dev';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
