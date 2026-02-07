/**
 * Adapter for Cline assistant.
 */

import * as vscode from 'vscode';
import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
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
      plan = addStep(plan, {
        action: 'show-guided-steps',
        description: 'Manual configuration required for Cline',
        assistantKey: 'cline',
        data: { 
          message: 'Please configure Cline base URL manually in extension settings',
          baseUrl: profile.baseUrl 
        },
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
