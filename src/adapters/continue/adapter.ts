/**
 * Adapter for Continue.dev assistant.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { getContinueConfigPath } from './paths';
import { fileExists, readFileSafe } from '../../util/fsSafe';
import { parseContinueModels } from './continueConfigPatcher';

/**
 * Continue.dev assistant adapter.
 */
export class ContinueAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'Continue.continue';

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    const configPath = getContinueConfigPath();
    let plan = createPlan(profile.id, ['continue']);

    if (await fileExists(configPath)) {
      plan = addStep(plan, {
        action: 'backup-file',
        description: 'Backup Continue.dev config file',
        assistantKey: 'continue',
        targetPath: configPath,
        data: { configPath },
        reversible: true
      });
    }

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: `Set Continue.dev apiBase to ${profile.baseUrl}`,
      assistantKey: 'continue',
      targetPath: configPath,
      newValue: profile.baseUrl,
      data: {
        driver: 'yaml-model-array',
        format: configPath.endsWith('.yaml') ? 'yaml' : 'jsonc',
        configPath,
        profileId: profile.id,
        baseUrl: profile.baseUrl
      },
      reversible: true
    });

    plan = addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify Continue.dev configuration',
      assistantKey: 'continue',
      data: { baseUrl: profile.baseUrl },
      reversible: false
    });

    return plan;
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

    const format = configPath.endsWith('.yaml') ? 'yaml' : 'jsonc';
    const models = parseContinueModels(content, format);
    const hasApiBase = models.some((model) => typeof model.apiBase === 'string' && model.apiBase.trim().length > 0);

    if (!hasApiBase) {
      return {
        success: false,
        message: 'Continue.dev config does not have apiBase set',
        details: { configPath, format, modelCount: models.length }
      };
    }

    return {
      success: true,
      message: 'Continue.dev configuration verified',
      details: { configPath, format, modelCount: models.length }
    };
  }

  getDisplayName(): string {
    return 'Continue.dev';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
