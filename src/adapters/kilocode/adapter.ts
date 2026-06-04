/**
 * Adapter for Kilo Code assistant.
 *
 * Kilo Code has specialized discovery logic that checks both key names and
 * property descriptions for URL-related patterns, and validates types as
 * string-like before including them.
 */

import * as vscode from 'vscode';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';

const FALLBACK_KEYS = [
  'kilocode.openaiBaseUrl',
  'kilocode.customProviderEndpoint',
  'kilocode.baseUrl'
];

const URL_SETTING_KEY_PATTERN = /(baseurl|base_url|apibase|endpoint|customproviderendpoint)/;
const URL_SETTING_DESCRIPTION_PATTERN = /(url|endpoint)/i;

interface SettingProperty {
  type?: string | string[];
  description?: string;
}

function isStringLikeType(type: unknown): boolean {
  if (typeof type === 'string') {
    return type === 'string';
  }
  if (Array.isArray(type)) {
    return type.includes('string');
  }
  return false;
}

function getDiscoveryErrorContext(error: unknown): Record<string, unknown> | unknown {
  if (error instanceof Error) {
    return {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    };
  }
  return { error };
}

/**
 * Kilo Code assistant adapter.
 */
export class KiloCodeAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'kilocode.kilo-code';

  private discoverSettingKeys(): string[] {
    const extension = vscode.extensions.getExtension(this.extensionId);
    if (!extension) {
      return FALLBACK_KEYS;
    }

    const packageJson = extension.packageJSON;
    const contributes = packageJson?.contributes;
    const configuration = contributes?.configuration;

    if (!configuration) {
      return [];
    }

    const entries: Array<[string, SettingProperty | undefined]> = Array.isArray(configuration)
      ? configuration.flatMap((c: { properties?: Record<string, SettingProperty> }) =>
          Object.entries(c.properties || {}))
      : Object.entries((configuration as { properties?: Record<string, SettingProperty> }).properties || {});

    const matchedKeys: string[] = [];

    for (const [key, prop] of entries) {
      if (!key.startsWith('kilocode.')) {
        continue;
      }
      if (!prop || !isStringLikeType(prop.type)) {
        continue;
      }
      const keyLower = key.toLowerCase();
      const desc = prop.description ?? '';
      if (URL_SETTING_KEY_PATTERN.test(keyLower) || URL_SETTING_DESCRIPTION_PATTERN.test(desc)) {
        matchedKeys.push(key);
      }
    }

    return [...new Set(matchedKeys)];
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    let plan = createPlan(profile.id, ['kilo-code']);
    let settingKeys: string[];

    try {
      settingKeys = this.discoverSettingKeys();
    } catch (error) {
      this.logger.warning('Error discovering Kilo Code setting keys', getDiscoveryErrorContext(error));
      settingKeys = [];
    }

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
      const guidedData: GuidedStepsData = {
        message: 'Please configure Kilo Code base URL manually in extension settings',
        steps: [
          'Open VS Code Settings (Ctrl+, or Cmd+,)',
          'Search for "Kilo Code" or "kilocode"',
          'Locate the base URL or endpoint setting (e.g. kilocode.openaiBaseUrl)',
          `Set the value to: ${profile.baseUrl}`,
          'Save the settings and reload Kilo Code if prompted'
        ],
        baseUrl: profile.baseUrl
      };
      plan = addStep(plan, {
        action: 'show-guided-steps',
        description: 'Manual configuration required for Kilo Code',
        assistantKey: 'kilo-code',
        data: guidedData,
        reversible: false
      });
    }

    return plan;
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const config = vscode.workspace.getConfiguration();
    let settingKeys: string[];

    try {
      settingKeys = this.discoverSettingKeys();
    } catch {
      settingKeys = [];
    }

    if (settingKeys.length === 0) {
      return {
        success: false,
        message: 'No registered Kilo Code URL settings were discovered. Configure the endpoint manually in Kilo Code settings or update the Kilo Code extension.',
        details: {
          checkedKeys: [],
          nextStep: 'Configure the endpoint manually in Kilo Code settings or update the Kilo Code extension.'
        }
      };
    }

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
  }

  getDisplayName(): string {
    return 'Kilo Code';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
