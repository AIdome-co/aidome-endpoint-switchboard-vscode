/**
 * Adapter for CodeGPT assistant.
 */

import * as vscode from 'vscode';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { getSettingValue, discoverBaseUrlSettings, discoverProviderSettings } from '../generic/settingsScanner';
import { validateUrl } from '../../core/profiles/profileValidator';

/**
 * CodeGPT assistant adapter.
 */
export class CodeGptAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'DanielSanMedium.dscodegpt';

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('CodeGPT endpoint URL is invalid or uses an unsupported scheme');
    }

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
        const providerValue = this.resolveOpenAiCompatibleProviderValue(settingKeys.providerKey) ?? 'openai-compatible';
        plan = addStep(plan, {
          action: 'set-vscode-setting',
          description: `Set ${settingKeys.providerKey} to ${providerValue}`,
          assistantKey: 'codegpt',
          targetPath: settingKeys.providerKey,
          oldValue: oldValue,
          newValue: providerValue,
          requiresConfirmation: true,
          data: { 
            settingKey: settingKeys.providerKey, 
            value: providerValue,
            oldValue: oldValue,
            note: 'May need to be set to "custom" or "openai-compatible" depending on CodeGPT version'
          },
          reversible: true
        });
      }

      if (!settingKeys.baseUrlKey || !settingKeys.providerKey) {
        plan = addStep(plan, {
          action: 'show-guided-steps',
          description: 'Complete CodeGPT model configuration in the extension UI',
          assistantKey: 'codegpt',
          data: this.getGuidedSteps(profile, settingKeys),
          reversible: false
        });
      }
    } else {
      plan = addStep(plan, {
        action: 'show-guided-steps',
        description: 'Manual configuration required for CodeGPT',
        assistantKey: 'codegpt',
        data: this.getGuidedSteps(profile),
        reversible: false
      });
    }

    return plan;
  }

  private getGuidedSteps(
    profile: EndpointProfile,
    settingKeys: { baseUrlKey?: string; providerKey?: string } = {}
  ): GuidedStepsData {
    const steps = [
      'Open the CodeGPT view in the VS Code Activity Bar',
      'Open the Gear icon or "Manage my AI Models"',
      'Choose the Local provider or another OpenAI-compatible provider',
      `Set the provider API URL/Base URL to: ${profile.baseUrl}`,
      'Enter the gateway API key in CodeGPT if the endpoint requires authentication',
      'Select a model, click Connect or Save, and reload CodeGPT if prompted'
    ];

    if (settingKeys.baseUrlKey) {
      steps.splice(3, 0, `The discovered setting ${settingKeys.baseUrlKey} was updated automatically`);
    }
    if (settingKeys.providerKey) {
      steps.splice(4, 0, `The discovered setting ${settingKeys.providerKey} was updated automatically`);
    }

    return {
      message: 'Complete CodeGPT model configuration in the extension UI',
      steps,
      baseUrl: profile.baseUrl,
      tier: 'B',
      configurationType: 'in-extension-ui',
      limitation: 'CodeGPT model-management settings are version-dependent and may require manual completion'
    };
  }

  private async discoverSettingKeys(): Promise<{ baseUrlKey?: string; providerKey?: string }> {
    try {
      const extension = vscode.extensions.getExtension(this.extensionId);
      if (!extension) {
        return {};
      }

      const baseUrlMatches = discoverBaseUrlSettings(this.extensionId);
      const providerMatches = discoverProviderSettings(this.extensionId)
        .filter((match) => this.supportsOpenAiCompatibleProviderValue(match.key));

      return {
        baseUrlKey: baseUrlMatches.length > 0 ? baseUrlMatches[0].key : undefined,
        providerKey: providerMatches.length > 0 ? providerMatches[0].key : undefined
      };
    } catch (error) {
      this.logger.warning('Error discovering CodeGPT setting keys', error);
      return {};
    }
  }

  private supportsOpenAiCompatibleProviderValue(settingKey: string): boolean {
    return this.resolveOpenAiCompatibleProviderValue(settingKey) !== undefined;
  }

  private resolveOpenAiCompatibleProviderValue(settingKey: string): string | undefined {
    const extension = vscode.extensions.getExtension(this.extensionId);
    const properties = extension?.packageJSON?.contributes?.configuration?.properties;
    const property = properties?.[settingKey] as { enum?: unknown[] } | undefined;
    if (!Array.isArray(property?.enum)) {
      return undefined;
    }
    const supported = ['openai-compatible', 'custom', 'openai'];
    return property.enum.find((value) => supported.includes(String(value))) as string | undefined;
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
    const configuredSettingKeys: string[] = [];
    let configuredBaseUrl: string | undefined;

    if (settingKeys.baseUrlKey) {
      const value = getSettingValue(settingKeys.baseUrlKey);
      if (typeof value === 'string' && value.trim().length > 0) {
        configuredSettingKeys.push(settingKeys.baseUrlKey);
        configuredBaseUrl = value.trim();
      }
    }

    if (settingKeys.providerKey) {
      const value = getSettingValue(settingKeys.providerKey);
      if (value) {
        configuredSettingKeys.push(settingKeys.providerKey);
      }
    }

    const hasBaseUrl = configuredBaseUrl !== undefined && validateUrl(configuredBaseUrl);

    if (!hasBaseUrl) {
      return {
        success: false,
        message: 'CodeGPT endpoint URL is not configured; complete setup in the model-management panel',
        details: { 
          extension: true,
          checkedKeys: settingKeys,
          configuredSettingKeys,
          tier: 'B',
          configurationStatus: 'manual-configuration-required',
          note: 'CodeGPT model-management settings may need to be completed manually through the extension UI'
        }
      };
    }

    return {
      success: true,
      message: 'CodeGPT configuration verified',
      details: { 
        extension: true,
        configuredSettingKeys,
        configurationStatus: 'endpoint-configured'
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
