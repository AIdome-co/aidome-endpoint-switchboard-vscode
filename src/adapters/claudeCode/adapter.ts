/**
 * Adapter for Claude Code assistant.
 */

import * as vscode from 'vscode';
import { AssistantAdapter, AssistantBuildContext, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { detectCli } from '../../core/detection/detectCLIs';
import { fileExists, readFileSafe, createBackup, writeFileAtomic } from '../../util/fsSafe';
import { Logger } from '../../util/log';
import { buildClaudeCodeSettingsContent, getClaudeCodeSettingsPath } from './claudeCodeConfigPatcher';
import { parseJsonc } from '../../util/jsonc';
import { validateUrl } from '../../core/profiles/profileValidator';

const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';
const CLAUDE_CODE_DISABLE_LOGIN_SETTING = 'claudeCode.disableLoginPrompt';

interface ClaudeCodeSettings {
  env?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Claude Code assistant adapter.
 */
export class ClaudeCodeAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      // Check for both VSCode extension and CLI
      const extensionDetected = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID) !== undefined;
      const cliDetected = await detectCli('claude');
      
      return extensionDetected || cliDetected;
    } catch (error) {
      this.logger.error('Error detecting Claude Code', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile, context: AssistantBuildContext = {}): Promise<Plan> {
    const configPath = getClaudeCodeSettingsPath();
    const existingContent = await readFileSafe(configPath);
    const authSecret = context.authSecret?.trim();
    const updatedContent = buildClaudeCodeSettingsContent(profile, existingContent, authSecret);
    const envVars = authSecret
      ? ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY']
      : ['ANTHROPIC_BASE_URL', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'];
    let plan = createPlan(profile.id, ['claude-code']);

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: 'Configure Claude Code gateway environment',
      assistantKey: 'claude-code',
      targetPath: configPath,
      newValue: updatedContent,
      data: {
        configPath,
        profileId: profile.id,
        baseUrl: profile.baseUrl,
        format: 'json',
        envVars
      },
      reversible: true
    });

    plan = addStep(plan, {
      action: 'set-vscode-setting',
      description: 'Disable Claude Code login prompt for gateway provider setup',
      assistantKey: 'claude-code',
      targetPath: CLAUDE_CODE_DISABLE_LOGIN_SETTING,
      newValue: true,
      data: { scope: 'global' },
      reversible: true
    });

    if (!authSecret) {
      const authGuidanceData = {
        message: 'Claude Code profile has no stored gateway API key',
        steps: [
          `Claude Code will read ANTHROPIC_BASE_URL from ${configPath} for both the CLI and VS Code extension.`,
          'Save a gateway API key on this profile to have AIdome write ANTHROPIC_API_KEY into Claude Code settings automatically, or set ANTHROPIC_API_KEY manually.',
          'Use an Anthropic Messages-compatible gateway endpoint; raw OpenAI Chat Completions endpoints are not supported by Claude Code.',
          'Restart Claude Code or VS Code after updating credentials.'
        ],
        configPath,
        baseUrl: profile.baseUrl,
        tier: 'B',
        optional: false,
        envVarName: 'ANTHROPIC_API_KEY'
      } satisfies GuidedStepsData;
      plan = addStep(plan, {
        action: 'show-guided-steps',
        description: 'Configure Claude Code gateway authentication',
        assistantKey: 'claude-code',
        data: authGuidanceData,
        reversible: false
      });
    }

    plan = addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify Claude Code configuration',
      assistantKey: 'claude-code',
      data: { baseUrl: profile.baseUrl },
      reversible: false
    });

    return plan;
  }

  async apply(plan: Plan): Promise<void> {
    for (const step of plan.steps.filter(item => item.assistantKey === 'claude-code')) {
      if (step.action !== 'edit-config-file' || !step.targetPath) {
        continue;
      }

      if (await fileExists(step.targetPath)) {
        const backupPath = await createBackup(step.targetPath);
        if (!backupPath) {
          throw new Error(`Failed to create backup of ${step.targetPath}`);
        }
      }

      const content = typeof step.newValue === 'string'
        ? step.newValue
        : JSON.stringify(step.newValue, null, 2);
      const success = await writeFileAtomic(step.targetPath, content);
      if (!success) {
        throw new Error(`Failed to write Claude Code settings to ${step.targetPath}`);
      }
    }
  }

  async verify(): Promise<VerificationResult> {
    try {
      const extension = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID);
      const cliDetected = await detectCli('claude');

      if (!extension && !cliDetected) {
        return {
          success: false,
          message: 'Claude Code is not installed',
          details: { extension: false, cli: false }
        };
      }

      const configPath = getClaudeCodeSettingsPath();
      const content = await readFileSafe(configPath);
      if (!content) {
        return {
          success: false,
          message: 'Claude Code settings file not found',
          details: { extension: !!extension, cli: cliDetected, configPath }
        };
      }

      const settings = parseJsonc<ClaudeCodeSettings>(content);
      const env = settings.env ?? {};
      const baseUrl = env.ANTHROPIC_BASE_URL;

      if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
        return {
          success: false,
          message: 'Claude Code settings do not have ANTHROPIC_BASE_URL configured',
          details: { extension: !!extension, cli: cliDetected, configPath }
        };
      }

      if (!validateUrl(baseUrl)) {
        return {
          success: false,
          message: 'Claude Code settings have an invalid ANTHROPIC_BASE_URL',
          details: { extension: !!extension, cli: cliDetected, configPath }
        };
      }

      return {
        success: true,
        message: 'Claude Code gateway configuration verified',
        details: {
          extension: !!extension,
          cli: cliDetected,
          configPath,
          baseUrlConfigured: true,
          apiKeyConfigured: typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 0,
          gatewayModelDiscovery: env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY === '1'
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Error verifying Claude Code config: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      };
    }
  }

  getDisplayName(): string {
    return 'Claude Code';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'B';
  }
}
