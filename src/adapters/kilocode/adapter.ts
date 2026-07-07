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
import { getKiloConfigPath, discoverModels, buildModelEntries } from './kiloConfigPatcher';
import { fileExists, readFileSafe } from '../../util/fsSafe';

/**
 * Kilo Code assistant adapter.
 */
export class KiloCodeAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'kilocode.kilo-code';

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    const configPath = getKiloConfigPath();
    let plan = createPlan(profile.id, ['kilo-code']);

    // Try to auto-discover models from the gateway's /v1/models endpoint
    // Many OpenAI-compatible gateways serve model lists without auth
    const modelSlugs = await discoverModels(profile.baseUrl);
    const models = modelSlugs.length > 0
      ? buildModelEntries(modelSlugs)
      : undefined;

    const configExists = await fileExists(configPath);
    if (configExists) {
      plan = addStep(plan, {
        action: 'backup-file',
        description: 'Backup Kilo Code config file',
        assistantKey: 'kilo-code',
        targetPath: configPath,
        data: { configPath },
        reversible: true
      });
    }

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: `Add AIdome Gateway provider to Kilo Code`,
      assistantKey: 'kilo-code',
      targetPath: configPath,
      newValue: profile.baseUrl,
      data: {
        configBuilder: 'kilo-config',
        configPath: configPath,
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        authRef: profile.name,
        profileName: profile.name,
        format: 'jsonc',
        providerSlug: 'aidome-gateway',
        models
      },
      reversible: true
    });

    // If auto-discovery failed and no existing config, guide the user
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
          baseUrl: profile.baseUrl
        },
        reversible: false
      });
    }

    plan = addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify Kilo Code configuration',
      assistantKey: 'kilo-code',
      data: { baseUrl: profile.baseUrl },
      reversible: false
    });

    return plan;
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const configPath = getKiloConfigPath();
    const content = await readFileSafe(configPath);

    if (!content) {
      return {
        success: false,
        message: 'Kilo Code config file not found',
        details: { configPath }
      };
    }

    const hasProviderConfig = content.includes('"aidome-gateway"') &&
                              content.includes('baseURL');

    if (!hasProviderConfig) {
      return {
        success: false,
        message: 'Kilo Code config does not have AIdome Gateway provider configured',
        details: { configPath }
      };
    }

    return {
      success: true,
      message: 'Kilo Code configuration verified',
      details: { configPath }
    };
  }

  getDisplayName(): string {
    return 'Kilo Code';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}