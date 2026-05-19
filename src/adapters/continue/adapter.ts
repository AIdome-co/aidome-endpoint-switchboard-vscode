/**
 * Adapter for Continue.dev assistant.
 */

import * as vscode from 'vscode';
import { AssistantAdapter, AssistantBuildContext, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { getContinueConfigPath } from './paths';
import { readFileSafe } from '../../util/fsSafe';
import { Logger } from '../../util/log';
import { parseContinueConfigContent } from './continueConfigPatcher';

/**
 * Continue.dev assistant adapter.
 */
export class ContinueAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      const extension = vscode.extensions.getExtension('Continue.continue');
      return extension !== undefined;
    } catch (error) {
      this.logger.error('Error detecting Continue.dev', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile, context?: AssistantBuildContext): Promise<Plan> {
    const configPath = getContinueConfigPath();
    let plan = createPlan(profile.id, ['continue']);

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: `Set Continue.dev apiBase to ${profile.baseUrl}`,
      assistantKey: 'continue',
      targetPath: configPath,
      newValue: profile.baseUrl,
      data: {
        configPath,
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        dialect: profile.dialect,
        authSecret: context?.authSecret,
        format: configPath.endsWith('.yaml') ? 'yaml' : 'json'
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

  async apply(plan: Plan): Promise<void> {
    return Promise.resolve();
  }

  async verify(): Promise<VerificationResult> {
    try {
      const configPath = getContinueConfigPath();
      const content = await readFileSafe(configPath);

      if (!content) {
        return {
          success: false,
          message: 'Continue.dev config file not found',
          details: { configPath }
        };
      }

      try {
        const config = parseContinueConfigContent(content, configPath);
        const models = Array.isArray(config.models) ? config.models : [];
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
      } catch {
        return {
          success: false,
          message: `Continue.dev config file is not valid ${configPath.endsWith('.yaml') ? 'YAML' : 'JSON'}`,
          details: { configPath }
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Error verifying Continue.dev config: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      };
    }
  }

  getDisplayName(): string {
    return 'Continue.dev';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
