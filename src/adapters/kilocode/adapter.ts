/**
 * Adapter for Kilo Code assistant.
 */

import * as vscode from 'vscode';
import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { Logger } from '../../util/log';

interface ExtensionConfiguration {
  properties?: Record<string, unknown>;
}

interface ConfigurationProperty {
  type?: string | string[];
  description?: string;
}

/**
 * Kilo Code assistant adapter.
 */
export class KiloCodeAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      const extension = vscode.extensions.getExtension('kilocode.kilo-code');
      return extension !== undefined;
    } catch (error) {
      this.logger.error('Error detecting Kilo Code', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    let plan = createPlan(profile.id, ['kilo-code']);

    const settingKeys = await this.discoverSettingKeys();
    
    for (const key of settingKeys) {
      plan = addStep(plan, {
        action: 'set-vscode-setting',
        description: `Set ${key} to ${profile.baseUrl}`,
        assistantKey: 'kilo-code',
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
        description: 'Manual configuration required for Kilo Code',
        assistantKey: 'kilo-code',
        data: { 
          message: 'Please configure Kilo Code base URL manually in extension settings',
          baseUrl: profile.baseUrl 
        },
        reversible: false
      });
    }

    return plan;
  }

  private async discoverSettingKeys(): Promise<string[]> {
    try {
      const extension = vscode.extensions.getExtension('kilocode.kilo-code');
      if (!extension) {
        return this.getFallbackKeys();
      }

      const packageJson = extension.packageJSON;
      const contributes = packageJson?.contributes;
      const configuration = contributes?.configuration;

      if (!configuration) {
        // Extension is installed but does not expose configurable keys.
        // Avoid writing guessed keys that may not be registered.
        return [];
      }

      const properties = Array.isArray(configuration) 
        ? configuration.flatMap((c: ExtensionConfiguration) => Object.keys(c.properties || {}))
        : Object.keys(configuration.properties || {});

      const propertiesMap = Array.isArray(configuration)
        ? configuration.reduce<Record<string, ConfigurationProperty>>((acc, c: ExtensionConfiguration) => {
            for (const [key, value] of Object.entries(c.properties || {})) {
              acc[key] = value as ConfigurationProperty;
            }
            return acc;
          }, {})
        : (configuration.properties || {}) as Record<string, ConfigurationProperty>;

      const baseUrlKeys = properties
        .filter((key: string) => {
          const normalizedKey = key.toLowerCase();
          const property = propertiesMap[key] || {};
          const description = (property.description || '').toLowerCase();
          const propertyType = Array.isArray(property.type) ? property.type : [property.type];
          const isStringLike = propertyType.filter(Boolean).includes('string') || propertyType.length === 0;
          const keyLooksLikeUrlSetting = /(baseurl|base_url|apibase|endpoint|customproviderendpoint)/.test(normalizedKey);
          const descMentionsUrl = /(url|endpoint|base)/.test(description);

          return isStringLike && (keyLooksLikeUrlSetting || descMentionsUrl);
        })
        .filter((key) => key.startsWith('kilocode.'));

      // Do not guess unknown keys when extension is installed; use guided mode instead.
      return [...new Set(baseUrlKeys)];
    } catch (error) {
      this.logger.warning('Error discovering Kilo Code setting keys', error);
      return [];
    }
  }

  private getFallbackKeys(): string[] {
    return [
      'kilocode.openaiBaseUrl',
      'kilocode.customProviderEndpoint',
      'kilocode.baseUrl'
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
          message: 'No Kilo Code base URL settings configured',
          details: { checkedKeys: settingKeys }
        };
      }

      return {
        success: true,
        message: 'Kilo Code configuration verified',
        details: { configuredSettings: configuredKeys }
      };
    } catch (error) {
      return {
        success: false,
        message: `Error verifying Kilo Code config: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      };
    }
  }

  getDisplayName(): string {
    return 'Kilo Code';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
