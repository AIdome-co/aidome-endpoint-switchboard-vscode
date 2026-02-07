/**
 * Adapter for OpenAI Codex CLI.
 */

import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { detectCli } from '../../core/detection/detectCLIs';
import { expandTilde } from '../../util/paths';
import { fileExists, readFileSafe } from '../../util/fsSafe';
import { Logger } from '../../util/log';

/**
 * OpenAI Codex CLI adapter.
 */
export class CodexAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      return await detectCli('codex');
    } catch (error) {
      this.logger.error('Error detecting Codex CLI', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    const configPath = expandTilde('~/.codex/config.toml');
    let plan = createPlan(profile.id, ['openai-codex']);

    // Check if config file exists and back it up if it does
    const configExists = await fileExists(configPath);
    if (configExists) {
      plan = addStep(plan, {
        action: 'backup-file',
        description: 'Backup Codex config file',
        assistantKey: 'openai-codex',
        targetPath: configPath,
        data: { configPath },
        reversible: true
      });
    }

    // Add step to edit config file
    plan = addStep(plan, {
      action: 'edit-config-file',
      description: `Set Codex provider to ${profile.baseUrl}`,
      assistantKey: 'openai-codex',
      targetPath: configPath,
      newValue: profile.baseUrl,
      data: { 
        configPath, 
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        format: 'toml',
        providerName: 'aidome',
        wireApi: 'responses'
      },
      reversible: true
    });

    // Add environment variable fallback
    plan = addStep(plan, {
      action: 'set-env-var',
      description: 'Set OPENAI_BASE_URL environment variable (fallback)',
      assistantKey: 'openai-codex',
      targetPath: 'OPENAI_BASE_URL',
      newValue: profile.baseUrl,
      data: { 
        envVar: 'OPENAI_BASE_URL',
        value: profile.baseUrl 
      },
      reversible: true
    });

    // Add verification step
    plan = addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify Codex configuration',
      assistantKey: 'openai-codex',
      data: { baseUrl: profile.baseUrl },
      reversible: false
    });

    return plan;
  }

  async apply(plan: Plan): Promise<void> {
    // Actual application is handled by the PlanApplier
    return Promise.resolve();
  }

  async verify(): Promise<VerificationResult> {
    try {
      const configPath = expandTilde('~/.codex/config.toml');
      const content = await readFileSafe(configPath);

      if (!content) {
        return {
          success: false,
          message: 'Codex config file not found',
          details: { configPath }
        };
      }

      // Check if config contains provider configuration
      // Looking for [providers.aidome] section or similar
      const hasProviderConfig = content.includes('[providers.') && 
                                (content.includes('base_url') || content.includes('base-url'));

      if (!hasProviderConfig) {
        return {
          success: false,
          message: 'Codex config does not have provider base_url configured',
          details: { configPath }
        };
      }

      return {
        success: true,
        message: 'Codex configuration verified',
        details: { configPath }
      };
    } catch (error) {
      return {
        success: false,
        message: `Error verifying Codex config: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      };
    }
  }

  getDisplayName(): string {
    return 'OpenAI Codex (CLI / IDE)';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
