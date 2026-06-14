/**
 * Adapter for CodeGPT assistant.
 */

import * as vscode from 'vscode';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { getSettingValue, discoverBaseUrlSettings, discoverProviderSettings } from '../generic/settingsScanner';

/**
 * CodeGPT assistant adapter.
 */
export class CodeGptAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'CodeGPT.codegpt';

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    let plan = createPlan(profile.id, ['codegpt']);

    const settingKeys = await this.discoverSettingKeys();

    if (settingKeys.baseUrlKey || settingKeys.providerKey) {
      if (settingKeys.baseUrlKey) {
        const oldValue = getSettingValue(settingKeys.baseUrlKey);
        plan = addStep(plan, {
          action: 'set-vscode-setting',
          description: `Set ${settingKeys.baseUrlKey} to ${profile.baseUrl}`,
          assistantKey: 'codegpt',
          targetPath: settingKeys.baseUrlKey,
          oldValue: oldValue,
          newValue: profile.baseUrl,
          requiresConfirmation: true,
          data: { 
            settingKey: settingKeys.baseUrlKey, 
            value: profile.baseUrl,
            oldValue: oldValue
          },
          reversible: true
        });
      }

      if (settingKeys.providerKey) {
        const oldValue = getSettingValue(settingKeys.providerKey);
        plan = addStep(plan, {
          action: 'set-vscode-setting',
          description: `Set ${settingKeys.providerKey} to custom provider`,
          assistantKey: 'codegpt',
          targetPath: settingKeys.providerKey,
          oldValue: oldValue,
          newValue: 'openai-compatible',
          requiresConfirmation: true,
          data: { 
            settingKey: settingKeys.providerKey, 
            value: 'openai-compatible',
            oldValue: oldValue,
            note: 'May need to be set to "custom" or "openai-compatible" depending on CodeGPT version'
          },
          reversible: true
        });
      }
    } else {
      const guidedData: GuidedStepsData = {
        message: 'CodeGPT settings could not be auto-detected. Please configure manually.',
        steps: [
          'Open CodeGPT settings (Ctrl+Shift+P → CodeGPT: Settings)',
          'Select "Custom" or "OpenAI-compatible" provider',
          `Enter your AIdome endpoint URL: ${profile.baseUrl}`,
          'Save the configuration',
          'Restart VS Code if needed'
        ],
        baseUrl: profile.baseUrl
      };
      plan = addStep(plan, {
        action: 'show-guided-steps',
        description: 'Manual configuration required for CodeGPT',
        assistantKey: 'codegpt',
        data: guidedData,
        reversible: false
      });
    }

    return plan;
  }

  private async discoverSettingKeys(): Promise<{ baseUrlKey?: string; providerKey?: string }> {
    try {
      const extension = vscode.extensions.getExtension(this.extensionId);
      if (!extension) {
        return {};
      }

      const baseUrlMatches = discoverBaseUrlSettings(this.extensionId);
      const providerMatches = discoverProviderSettings(this.extensionId);

      return {
        baseUrlKey: baseUrlMatches.length > 0 ? baseUrlMatches[0].key : undefined,
        providerKey: providerMatches.length > 0 ? providerMatches[0].key : undefined
      };
    } catch (error) {
      this.logger.warning('Error discovering CodeGPT setting keys', error);
      return {};
    }
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const extension = vscode.extensions.getExtension(this.extensionId);
    if (!extension) {
      return {
        success: false,
        message: 'CodeGPT extension is not installed',
        details: { extension: false }
      };
    }

    const settingKeys = await this.discoverSettingKeys();
    const configuredSettings: Record<string, unknown> = {};

    if (settingKeys.baseUrlKey) {
      const value = getSettingValue(settingKeys.baseUrlKey);
      if (value) {
        configuredSettings[settingKeys.baseUrlKey] = value;
      }
    }

    if (settingKeys.providerKey) {
      const value = getSettingValue(settingKeys.providerKey);
      if (value) {
        configuredSettings[settingKeys.providerKey] = value;
      }
    }

    if (Object.keys(configuredSettings).length === 0) {
      return {
        success: false,
        message: 'No CodeGPT endpoint settings configured',
        details: { 
          extension: true,
          checkedKeys: settingKeys,
          tier: 'B',
          note: 'Configuration may need to be done manually through CodeGPT UI'
        }
      };
    }

    return {
      success: true,
      message: 'CodeGPT configuration verified',
      details: { 
        extension: true,
        configuredSettings: configuredSettings 
      }
    };
  }

  getDisplayName(): string {
    return 'CodeGPT';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'B';
  }
}
