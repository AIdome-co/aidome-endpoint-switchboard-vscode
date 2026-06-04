/**
 * Adapter for OpenAI Codex CLI.
 *
 * ⚠️ RISK: OpenAI Codex CLI now ships from the Rust codex-rs codebase.
 * The config.toml schema and provider configuration format may have changed
 * significantly from the original Node.js version.  The adapter patches
 * config.toml with a `[providers.aidome]` section and sets OPENAI_BASE_URL as
 * an env-var fallback.  After major Codex CLI updates, re-verify that the
 * config.toml structure is still supported by the Rust binary.
 * Verified against: openai/codex v0.124.0 repository as of 2026-04-24.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { detectCli } from '../../core/detection/detectCLIs';
import { getCodexConfigPath } from './codexConfigPatcher';
import { fileExists, readFileSafe } from '../../util/fsSafe';

/**
 * OpenAI Codex CLI adapter.
 */
export class CodexAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = '';

  async detect(): Promise<boolean> {
    try {
      return await detectCli('codex');
    } catch (error) {
      this.logger.error('Error detecting Codex CLI', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    const configPath = getCodexConfigPath();
    let plan = createPlan(profile.id, ['openai-codex']);

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

    plan = addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify Codex configuration',
      assistantKey: 'openai-codex',
      data: { baseUrl: profile.baseUrl },
      reversible: false
    });

    return plan;
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const configPath = getCodexConfigPath();
    const content = await readFileSafe(configPath);

    if (!content) {
      return {
        success: false,
        message: 'Codex config file not found',
        details: { configPath }
      };
    }

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
  }

  getDisplayName(): string {
    return 'OpenAI Codex (CLI / IDE)';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
