/**
 * Adapter for Kilo Code v7.4+.
 *
 * Kilo Code v7.4 stores provider configurations in a global config file
 * at ~/.config/kilo/kilo.jsonc (XDG_CONFIG_HOME/kilo/kilo.jsonc).
 * See https://app.kilo.ai/config.json for the schema.
 *
 * During plan building, this adapter auto-discovers models from the
 * gateway's /v1/models endpoint and writes them into the config.
 * If model discovery fails, a guided step is added for manual setup.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { resolveKiloConfigTarget, getKiloConfigPath, discoverModels, buildModelEntries } from './kiloConfigPatcher';
import { writeKiloProviderAuth } from './kiloAuthStore';
import { fileExists, readFileSafe } from '../../util/fsSafe';
import { parseJsonc } from '../../util/jsonc';
import { normalizeOpenAiBaseUrl } from '../../core/providerConfig/endpointUrl';
import { registerAssistantStorageWriter } from '../../core/orchestration/assistantStorageWriters';

// Register the storage writer so the generic `write-assistant-storage`
// applier action can dispatch to Kilo without importing provider modules
// from core (dependency-direction rule).
//
// Write strategy: merge-write the AIdome PAT into Kilo's own credential file
// (`<data>/kilo/auth.json`, reconciled by Kilo on every backend startup) and
// refresh the provider entry's models from an AUTHENTICATED discovery probe.
// The writer owns its backups and reports every mutated target for rollback.
registerAssistantStorageWriter('kilo-code', async (step, apiKey) => {
  const data = (step.data ?? {}) as Record<string, unknown>;
  const baseUrl = typeof data.baseUrl === 'string' ? data.baseUrl : undefined;
  if (!baseUrl) {
    throw new Error('write-assistant-storage requires a baseUrl in step data');
  }
  const dataDir = typeof data.dataDir === 'string' ? data.dataDir : undefined;
  const configPath = typeof data.configPath === 'string' ? data.configPath : undefined;
  return writeKiloProviderAuth({ baseUrl, apiKey, dataDir, configPath });
});

/**
 * Kilo Code assistant adapter.
 */
export class KiloCodeAdapter extends BaseExtensionAdapter {
  /** Profile base URL captured at buildPlan for exact-profile verification (GAP 4). */
  private expectedBaseUrl: string | undefined;

  protected readonly extensionId = 'kilocode.kilo-code';

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    const target = resolveKiloConfigTarget();
    const baseUrl = normalizeOpenAiBaseUrl(profile.baseUrl);
    let plan = createPlan(profile.id, ['kilo-code']);

    // Fail closed: when Kilo's active configuration source cannot be
    // determined safely, guide instead of guessing a path.
    if (target.kind === 'guided') {
      return addStep(plan, {
        action: 'show-guided-steps',
        description: 'Kilo Code configuration guidance',
        assistantKey: 'kilo-code',
        data: {
          message: target.reason,
          steps: [
            'Open Kilo Code and go to provider settings',
            'Select or add the "AIdome Gateway" provider',
            `Set the provider baseURL to ${baseUrl}`,
            'Kilo manages provider credentials through its own auth store — configure them in Kilo Code'
          ],
          baseUrl,
          limitation: 'ambiguous-config-source'
        },
        reversible: false
      });
    }
    const configPath: string = target.path;

    // Try to auto-discover models from the gateway's /v1/models endpoint
    // Many OpenAI-compatible gateways serve model lists without auth
    const modelSlugs = await discoverModels(baseUrl);
    const models = modelSlugs.length > 0
      ? buildModelEntries(modelSlugs)
      : undefined;

    // GAP 6: PlanApplier backs up the config before its edit-config-file
    // step; backupRequired below is preview metadata, not a duplicate backup.
    const configExists = await fileExists(configPath);

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: `Add AIdome Gateway provider to Kilo Code`,
      assistantKey: 'kilo-code',
      targetPath: configPath,
      newValue: baseUrl,
      data: {
        driver: 'jsonc-provider-map',
        mapPath: ['provider'],
        providerId: 'aidome-gateway',
        providerSlug: 'aidome-gateway',
        defaults: {
          name: 'AIdome Gateway',
          npm: '@ai-sdk/openai-compatible'
        },
        baseUrlPath: ['options', 'baseURL'],
        configPath: configPath,
        ...(configExists ? { backupRequired: true } : {}),
        profileId: profile.id,
        baseUrl,
        format: 'jsonc',
        models
      },
      reversible: true
    });

    // The credential + authenticated model discovery run at apply time (the
    // PAT lives in SecretStorage and is only resolvable by the applier).
    plan = addStep(plan, {
      action: 'write-assistant-storage',
      description: 'Write the AIdome PAT to the Kilo credential store (auth.json)',
      assistantKey: 'kilo-code',
      targetPath: configPath,
      newValue: baseUrl,
      data: {
        baseUrl,
        authRef: profile.authRef,
        configPath
      },
      reversible: true
    });

    // If auto-discovery failed and no existing config, guide the user.
    // GAP 10/round-2: when a saved credential exists, the storage writer
    // performs AUTHENTICATED discovery at apply time and populates the model
    // map — the planning probe could not (it is unauthenticated), so the
    // guidance here must be OPTIONAL. A required step would misclassify a
    // fully automatic setup as guided-required and skip the mapping. Without
    // a credential the guidance is genuinely required (nothing can discover
    // models or authenticate).
    if (!models && !configExists) {
      plan = addStep(plan, {
        action: 'show-guided-steps',
        description: 'Configure models in Kilo Code UI',
        assistantKey: 'kilo-code',
        data: {
          message: 'Kilo Code requires at least one model configured for the provider.',
          steps: [
            `Open Kilo Code and go to provider settings`,
            `Select the "AIdome Gateway" provider`,
            `Add model(s) under "Models" (e.g. "gpt-4" or any model your gateway serves)`,
            `Save the provider configuration`
          ],
          baseUrl,
          ...(profile.authRef ? { optional: true } : {})
        },
        reversible: false
      });
    }

    // GAP 4: remember the assigned profile's URL so verification requires an
    // exact match (fail closed when unknown).
    this.expectedBaseUrl = baseUrl;

    plan = addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify Kilo Code configuration',
      assistantKey: 'kilo-code',
      data: { baseUrl },
      reversible: false
    });

    return plan;
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const target = resolveKiloConfigTarget();
    if (target.kind === 'guided') {
      return {
        success: false,
        message: 'Kilo Code configuration source is ambiguous — configure it manually',
        details: { reason: target.reason, configurationStatus: 'guided-required' }
      };
    }
    const configPath = target.path;
    const content = await readFileSafe(configPath);

    if (!content) {
      return {
        success: false,
        message: 'Kilo Code config file not found',
        details: { configPath }
      };
    }

    // GAP 4: parse the JSONC document (never substring matching) and require
    // the aidome-gateway provider entry with the EXACT expected profile URL.
    let document: Record<string, unknown>;
    try {
      document = parseJsonc<Record<string, unknown>>(content);
    } catch (error) {
      return {
        success: false,
        message: `Kilo Code config file is not valid JSONC: ${error instanceof Error ? error.message : String(error)}`,
        details: { configPath }
      };
    }

    if (this.expectedBaseUrl === undefined) {
      return {
        success: false,
        message: 'Kilo Code provider configuration exists, but the expected AIdome profile URL is unknown — apply a profile first to verify an exact match',
        details: { configPath, exactUrlMatchVerified: false }
      };
    }

    const providerMap = document['provider'];
    const providerEntry = (providerMap !== null && typeof providerMap === 'object' && !Array.isArray(providerMap)
      ? (providerMap as Record<string, unknown>)['aidome-gateway']
      : undefined);
    if (providerEntry === undefined || providerEntry === null || typeof providerEntry !== 'object') {
      return {
        success: false,
        message: 'Kilo Code config does not have the AIdome Gateway provider configured',
        details: { configPath }
      };
    }

    const options = (providerEntry as Record<string, unknown>)['options'];
    const baseURL = options !== null && typeof options === 'object' && !Array.isArray(options)
      ? (options as Record<string, unknown>)['baseURL']
      : undefined;
    const expectedBaseUrl = normalizeOpenAiBaseUrl(this.expectedBaseUrl);
    if (typeof baseURL !== 'string' || normalizeOpenAiBaseUrl(baseURL) !== expectedBaseUrl) {
      return {
        success: false,
        message: 'Kilo Code aidome-gateway baseURL does not match the assigned profile URL',
        details: {
          configPath,
          configuredBaseUrl: typeof baseURL === 'string' ? baseURL : undefined,
          expectedBaseUrl
        }
      };
    }

    return {
      success: true,
      message: 'Kilo Code configuration verified',
      details: { configPath, exactUrlMatchVerified: true }
    };
  }

  /**
   * Kilo's backend imports credentials from auth.json and reads its config
   * only at process startup (no filesystem watcher covers the data dir —
   * verified in pub-refs kilocode). A window reload restarts the backend and
   * re-imports, so the reload requirement rides the result to the top level.
   */
  getReloadExtensionIds(): string[] {
    return ['kilocode.kilo-code'];
  }

  getDisplayName(): string {
    return 'Kilo Code';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
