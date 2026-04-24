/**
 * Adapter for Cline assistant.
 *
 * ⚠️ RISK: Cline stores its API configuration (provider, base URL, model) in
 * webview globalState, NOT in VS Code settings.json contributions.  The
 * switchboard writes VS Code settings (e.g. `cline.openAiBaseUrl`) which may
 * not be read by all Cline versions.  The fallback key discovery in
 * discoverSettingKeys() mitigates this, but verify after major Cline updates
 * that the settings-based approach still takes effect.
 * Verified against: Cline v3.x source (saoudrizwan/claude-dev) as of 2026-04-24.
 */

import * as vscode from 'vscode';
import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { Logger } from '../../util/log';

interface ExtensionConfiguration {
  properties?: Record<string, unknown>;
}

/**
 * Cline assistant adapter.
 */
export class ClineAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      const extension = vscode.extensions.getExtension('saoudrizwan.claude-dev');
      return extension !== undefined;
    } catch (error) {
      this.logger.error('Error detecting Cline', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    let plan = createPlan(profile.id, ['cline']);

    const settingKeys = await this.discoverSettingKeys();
    
    for (const key of settingKeys) {
      plan = addStep(plan, {
        action: 'set-vscode-setting',
        description: `Set ${key} to ${profile.baseUrl}`,
        assistantKey: 'cline',
        targetPath: key,
        newValue: profile.baseUrl,
        data: { 
          settingKey: key, 
          value: profile.baseUrl 
        },
        reversible: true
      });
    }

    if (settingKeys.length === 0) {
      const guidedData: GuidedStepsData = {
        message: 'Please configure Cline base URL manually in extension settings',
        steps: [
          'Open VS Code Settings (Ctrl+, or Cmd+,)',
          'Search for "Cline" or "claude-dev"',
          'Locate the base URL or API endpoint setting (e.g. cline.openAiBaseUrl)',
          `Set the value to: ${profile.baseUrl}`,
          'Save the settings and reload Cline if prompted'
        ],
        baseUrl: profile.baseUrl
      };
      plan = addStep(plan, {
        action: 'show-guided-steps',
        description: 'Manual configuration required for Cline',
        assistantKey: 'cline',
        data: guidedData,
        reversible: false
      });
    }

    return plan;
  }

  private async discoverSettingKeys(): Promise<string[]> {
    try {
      const extension = vscode.extensions.getExtension('saoudrizwan.claude-dev');
      if (!extension) {
        return [];
      }

      const packageJson = extension.packageJSON;
      const contributes = packageJson?.contributes;
      const configuration = contributes?.configuration;

      if (!configuration) {
        return this.getFallbackKeys();
      }

      const properties = Array.isArray(configuration) 
        ? configuration.flatMap((c: ExtensionConfiguration) => Object.keys(c.properties || {}))
        : Object.keys(configuration.properties || {});

      const baseUrlKeys = properties.filter((key: string) => 
        key.toLowerCase().includes('baseurl') || 
        key.toLowerCase().includes('base_url') ||
        (key.toLowerCase().includes('openai') && key.toLowerCase().includes('base'))
      );

      return baseUrlKeys.length > 0 ? baseUrlKeys : this.getFallbackKeys();
    } catch (error) {
      this.logger.warning('Error discovering Cline setting keys', error);
      return this.getFallbackKeys();
    }
  }

  private getFallbackKeys(): string[] {
    return [
      'cline.openAiBaseUrl',
      'cline.baseUrl',
      'cline.openaiBaseUrl'
    ];
  }

  async apply(plan: Plan): Promise<void> {
    return Promise.resolve();
  }

  async verify(): Promise<VerificationResult> {
    try {
      const config = vscode.workspace.getConfiguration();
      const settingKeys = await this.discoverSettingKeys();

      const configuredKeys: Record<string, string> = {};
      for (const key of settingKeys) {
        const value = config.get<string>(key);
        if (value) {
          configuredKeys[key] = value;
        }
      }

      if (Object.keys(configuredKeys).length === 0) {
        return {
          success: false,
          message: 'No Cline base URL settings configured',
          details: { checkedKeys: settingKeys }
        };
      }

      return {
        success: true,
        message: 'Cline configuration verified',
        details: { configuredSettings: configuredKeys }
      };
    } catch (error) {
      return {
        success: false,
        message: `Error verifying Cline config: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      };
    }
  }

  getDisplayName(): string {
    return 'Cline';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
