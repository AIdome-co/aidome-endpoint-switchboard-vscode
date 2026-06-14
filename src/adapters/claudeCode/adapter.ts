/**
 * Adapter for Claude Code assistant.
 */

import * as vscode from 'vscode';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { detectCli } from '../../core/detection/detectCLIs';
import { fileExists, readFileSafe, createBackup, writeFileAtomic } from '../../util/fsSafe';
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
export class ClaudeCodeAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = CLAUDE_CODE_EXTENSION_ID;

  async detect(): Promise<boolean> {
    try {
      const extensionDetected = vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID) !== undefined;
      const cliDetected = await detectCli('claude');
      
      return extensionDetected || cliDetected;
    } catch (error) {
      this.logger.error('Error detecting Claude Code', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    const configPath = getClaudeCodeSettingsPath();
    const existingContent = await readFileSafe(configPath);
    const updatedContent = buildClaudeCodeSettingsContent(profile, existingContent);
    let plan = createPlan(profile.id, ['claude-code']);

    plan = addStep(plan, {
      action: 'edit-config-file',
      description: 'Configure Claude Code gateway environment',
      assistantKey: 'claude-code',
      targetPath: configPath,
      newValue: updatedContent,
      data: {
        configBuilder: 'claude-code-settings',
        configPath,
        profileId: profile.id,
        profileName: profile.name,
        authRef: profile.authRef ?? profile.name,
        baseUrl: profile.baseUrl,
        format: 'json',
        envVars: [
          'ANTHROPIC_BASE_URL',
          'ANTHROPIC_AUTH_TOKEN',
          'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'
        ],
        clearAuthWhenMissing: true
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

    const authGuidanceData = {
      message: 'Claude Code profile-switch notes',
      steps: [
        `Claude Code will read ANTHROPIC_BASE_URL from ${configPath} for both the CLI and VS Code extension.`,
        'When this profile is activated, Switchboard writes the profile\'s saved gateway token into ANTHROPIC_AUTH_TOKEN in that shared Claude settings file.',
        'If no saved secret exists for this profile, Switchboard clears ANTHROPIC_AUTH_TOKEN and Claude Code auth will fail until you save a token for the profile.',
        'If an already running Claude Code session does not pick up the new token immediately, restart Claude Code or VS Code.'
      ],
      baseUrl: profile.baseUrl,
      tier: 'A',
      optional: true,
      envVarName: 'ANTHROPIC_AUTH_TOKEN'
    } satisfies GuidedStepsData;
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Show Claude Code profile-switch notes',
      assistantKey: 'claude-code',
      data: authGuidanceData,
      reversible: false
    });

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

  protected async verifyConfiguration(): Promise<VerificationResult> {
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
    const anthropicAuthToken = env.ANTHROPIC_AUTH_TOKEN;

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

    if (typeof anthropicAuthToken !== 'string' || anthropicAuthToken.trim().length === 0) {
      return {
        success: false,
        message: 'Claude Code settings do not have ANTHROPIC_AUTH_TOKEN configured',
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
        authTokenConfigured: true,
        gatewayModelDiscovery: env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY === '1'
      }
    };
  }

  getDisplayName(): string {
    return 'Claude Code';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
