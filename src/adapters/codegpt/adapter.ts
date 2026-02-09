/**
 * Adapter for CodeGPT assistant.
 */

import * as vscode from 'vscode';
import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { getSettingValue, discoverBaseUrlSettings, discoverProviderSettings } from '../generic/settingsScanner';
import { Logger } from '../../util/log';

/**
 * CodeGPT assistant adapter.
 */
export class CodeGptAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      const extension = vscode.extensions.getExtension('CodeGPT.codegpt');
      return extension !== undefined;
    } catch (error) {
      this.logger.error('Error detecting CodeGPT', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    let plan = createPlan(profile.id, ['codegpt']);

    // Try to discover settings keys by scanning the extension
    const settingKeys = await this.discoverSettingKeys();

    if (settingKeys.baseUrlKey || settingKeys.providerKey) {
      // We found settings keys - attempt auto-configuration
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
        // Try to set provider to a custom/OpenAI-compatible value
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
      // Fall back to guided mode if no settings keys found
      plan = addStep(plan, {
        action: 'show-guided-steps',
        description: 'Manual configuration required for CodeGPT',
        assistantKey: 'codegpt',
        data: {
          message: 'CodeGPT settings could not be auto-detected. Please configure manually.',
          steps: [
            'Open CodeGPT settings (Ctrl+Shift+P → CodeGPT: Settings)',
            'Select "Custom" or "OpenAI-compatible" provider',
            `Enter your AIdome endpoint URL: ${profile.baseUrl}`,
            'Save the configuration',
            'Restart VS Code if needed'
          ],
          baseUrl: profile.baseUrl
        },
        reversible: false
      });
    }

    return plan;
  }

  private async discoverSettingKeys(): Promise<{ baseUrlKey?: string; providerKey?: string }> {
    try {
      const extension = vscode.extensions.getExtension('CodeGPT.codegpt');
      if (!extension) {
        return {};
      }

      // Use the enhanced scanner with confidence scoring
      const baseUrlMatches = discoverBaseUrlSettings('CodeGPT.codegpt');
      const providerMatches = discoverProviderSettings('CodeGPT.codegpt');

      // Return the highest confidence matches
      return {
        baseUrlKey: baseUrlMatches.length > 0 ? baseUrlMatches[0].key : undefined,
        providerKey: providerMatches.length > 0 ? providerMatches[0].key : undefined
      };
    } catch (error) {
      this.logger.warning('Error discovering CodeGPT setting keys', error);
      return {};
    }
  }

  async apply(plan: Plan): Promise<void> {
    // Actual application is handled by the PlanApplier
    return Promise.resolve();
  }

  async verify(): Promise<VerificationResult> {
    try {
      const extension = vscode.extensions.getExtension('CodeGPT.codegpt');
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
    } catch (error) {
      return {
        success: false,
        message: `Error verifying CodeGPT config: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      };
    }
  }

  getDisplayName(): string {
    return 'CodeGPT';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'B';
  }
}
