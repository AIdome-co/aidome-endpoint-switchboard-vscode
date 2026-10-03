/**
 * Adapter for Continue.dev assistant.
 *
 * Thin wrapper around the ProviderConfigEngine: the descriptor's declarative
 * plan operations define the model-array mutation; the adapter only resolves
 * the active config path (YAML primary, legacy JSONC fallback) — an allowed
 * unusual-target hook.
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

const DESCRIPTOR = getProviderConfigDescriptor('continue');

/**
 * Continue.dev assistant adapter.
 */
export class ContinueAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'Continue.continue';

  /** Profile URL expected by the most recent buildPlan, for exact verification. */
  private expectedBaseUrl: string | undefined;

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    const configPath = getContinueConfigPath();
    if (!DESCRIPTOR) {
      throw new Error('Continue provider descriptor is missing');
    }

    const targetId = configPath.endsWith('.yaml') ? 'continue-primary-yaml' : 'continue-legacy-json';
    const { plan } = buildProviderConfigPlan(DESCRIPTOR, {
      profile,
      resolvedTargetPaths: { [targetId]: configPath },
    });
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

    // Profile-aware verification: the Switchboard-managed entry
    // (identity: AIdome Gateway) must exist AND its apiBase must exactly
    // match the expected profile URL. "Some model has apiBase" is not a
    // pass — that would false-positive on unrelated user models.
    const format = configPath.endsWith('.yaml') ? 'yaml' : 'jsonc';
    const models = parseContinueModels(content, format);
    const managed = models.find(model =>
      model.title === AIDOME_MODEL_IDENTITY || model.name === AIDOME_MODEL_IDENTITY
    );

    if (!managed) {
      return {
        success: false,
        message: `Continue.dev config has no ${AIDOME_MODEL_IDENTITY} model entry`,
        details: { configPath, format, modelCount: models.length }
      };
    }

    const managedApiBase = typeof managed.apiBase === 'string' ? managed.apiBase : undefined;
    if (managedApiBase === undefined) {
      return {
        success: false,
        message: `Continue.dev ${AIDOME_MODEL_IDENTITY} entry has no apiBase configured`,
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
        details: { configPath, format, modelCount: models.length, managedApiBase }
      };
    }

    if (managedApiBase !== expectedBaseUrl) {
      return {
        success: false,
        message: `Continue.dev ${AIDOME_MODEL_IDENTITY} apiBase (${managedApiBase}) does not match the expected profile URL (${expectedBaseUrl})`,
        details: { configPath, format, modelCount: models.length, managedApiBase, expectedBaseUrl }
      };
    }

    return {
      success: true,
      message: 'Continue.dev configuration verified',
      details: {
        configPath,
        format,
        modelCount: models.length,
        managedEntry: { apiBase: managedApiBase, provider: managed.provider }
      }
    };
  }

  getDisplayName(): string {
    return 'Continue.dev';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
