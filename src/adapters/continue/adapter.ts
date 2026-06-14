/**
 * Adapter for Continue.dev assistant.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { getContinueConfigPath } from './paths';
import { readFileSafe } from '../../util/fsSafe';

/**
 * Continue.dev assistant adapter.
 */
export class ContinueAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'Continue.continue';

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    const configPath = getContinueConfigPath();
    let plan = createPlan(profile.id, ['continue']);

    plan = addStep(plan, {
      action: 'backup-file',
      description: 'Backup Continue.dev config file',
      assistantKey: 'continue',
      targetPath: configPath,
      data: { configPath },
      reversible: true
    });

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: `Set Continue.dev apiBase to ${profile.baseUrl}`,
      assistantKey: 'continue',
      targetPath: configPath,
      newValue: profile.baseUrl,
      data: { 
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

    let config;
    try {
      config = JSON.parse(content);
    } catch {
      return {
        success: false,
        message: 'Continue.dev config file is not valid JSON',
        details: { configPath }
      };
    }

    const models = config.models || [];
    const hasApiBase = models.some((m: { apiBase?: string }) => m.apiBase);

    if (!hasApiBase) {
      return {
        success: false,
        message: 'Continue.dev config does not have apiBase set',
        details: { configPath, models }
      };
    }

    return {
      success: true,
      message: 'Continue.dev configuration verified',
      details: { configPath, models }
    };
  }

  getDisplayName(): string {
    return 'Continue.dev';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
