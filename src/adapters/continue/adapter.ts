/**
 * Adapter for Continue.dev assistant.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { getContinueConfigPath } from './paths';
import { fileExists, readFileSafe } from '../../util/fsSafe';
import { parseJsonc } from '../../util/jsonc';

interface ContinueModel extends Record<string, unknown> {
  provider?: unknown;
  apiBase?: unknown;
  model?: unknown;
  title?: unknown;
}

interface ContinueConfig extends Record<string, unknown> {
  models?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function summarizeModels(models: ContinueModel[]): Array<Record<string, unknown>> {
  return models.map((model) => ({
    title: typeof model.title === 'string' ? model.title : undefined,
    provider: typeof model.provider === 'string' ? model.provider : undefined,
    model: typeof model.model === 'string' ? model.model : undefined,
    apiBaseConfigured: typeof model.apiBase === 'string' && model.apiBase.trim().length > 0
  }));
}

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
      description: `Patch Continue.dev OpenAI model apiBase to ${profile.baseUrl}`,
      assistantKey: 'continue',
      targetPath: configPath,
      newValue: profile.baseUrl,
      data: { 
        configPath, 
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        format: 'jsonc'
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

    let config: ContinueConfig;
    try {
      const parsed = parseJsonc<unknown>(content);
      if (!isRecord(parsed)) {
        return {
          success: false,
          message: 'Continue.dev config must be a JSON object',
          details: { configPath }
        };
      }
      config = parsed;
    } catch {
      return {
        success: false,
        message: 'Continue.dev config file is not valid JSON/JSONC',
        details: { configPath }
      };
    }

    if (!Array.isArray(config.models) || !config.models.every(isRecord)) {
      return {
        success: false,
        message: 'Continue.dev config does not contain a valid models array',
        details: { configPath, models: [] }
      };
    }

    const models = config.models as ContinueModel[];
    const hasValidModelShape = models.every((model) =>
      typeof model.title === 'string' &&
      model.title.trim().length > 0 &&
      typeof model.provider === 'string' &&
      model.provider.trim().length > 0
    );
    const modelSummaries = summarizeModels(models);
    if (!hasValidModelShape) {
      return {
        success: false,
        message: 'Continue.dev config contains an invalid model definition',
        details: { configPath, models: modelSummaries }
      };
    }

    const hasOpenAiApiBase = models.some((model) =>
      model.provider === 'openai' &&
      typeof model.apiBase === 'string' &&
      model.apiBase.trim().length > 0
    );

    if (!hasOpenAiApiBase) {
      return {
        success: false,
        message: 'Continue.dev config does not have an OpenAI model with apiBase set',
        details: { configPath, models: modelSummaries }
      };
    }

    return {
      success: true,
      message: 'Continue.dev configuration verified',
      details: { configPath, models: modelSummaries }
    };
  }

  getDisplayName(): string {
    return 'Continue.dev';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
