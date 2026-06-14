/**
 * Shared base for adapters that configure assistants via VS Code settings keys.
 *
 * Extracts the common patterns from Cline and Kilo Code adapters:
 *  - discoverSettingKeys() by scanning extension contributes.configuration
 *  - buildPlan() that creates set-vscode-setting steps (with guided fallback)
 *  - verify() that checks whether discovered settings have values
 */

import * as vscode from 'vscode';
import { EndpointProfile } from '../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../core/orchestration/planBuilder';
import { VerificationResult } from './AssistantAdapter';
import { BaseExtensionAdapter, formatThrowable } from './BaseExtensionAdapter';

interface ExtensionConfiguration {
  properties?: Record<string, unknown>;
}

/**
 * Abstract adapter for assistants configured through VS Code settings.
 *
 * Subclasses provide:
 *  - `extensionId` — marketplace ID used for both detection and key discovery
 *  - `assistantKey` — key used in plans (e.g. 'cline', 'kilo-code')
 *  - `getFallbackKeys()` — hardcoded setting keys as a last resort
 *  - `getGuidedSteps(profile)` — guided steps shown when no settings are found
 *  - `getKeyMatchPatterns()` — (optional) override for custom key-name matching
 */
export abstract class VscodeSettingsAdapter extends BaseExtensionAdapter {
  /** Key used in plan steps and assistant mappings (e.g. 'cline'). */
  protected abstract readonly assistantKey: string;

  /**
   * Patterns used to filter setting keys.
   * Default matches common base-URL naming conventions.
   */
  protected getKeyMatchPatterns(): RegExp {
    return /(baseurl|base_url|apibase|endpoint|customproviderendpoint)/;
  }

  /**
   * Returns fallback setting keys when dynamic discovery fails.
   */
  protected abstract getFallbackKeys(): string[];

  /**
   * Returns the guided steps shown when no settings keys are discovered.
   */
  protected abstract getGuidedSteps(profile: EndpointProfile): GuidedStepsData;

  /**
   * Discovers setting keys from the extension's contributed configuration.
   * Filters by key name patterns that look like base URL settings.
   *
   * Default behavior:
   *  - Extension not found → empty (triggers guided steps)
   *  - Extension found, no configuration section → fallback keys
   *  - Extension found, configuration found → dynamic discovery with fallback
   */
  async discoverSettingKeys(): Promise<string[]> {
    try {
      const extension = vscode.extensions.getExtension(this.extensionId);
      if (!extension) {
        return this.getKeysWhenExtensionNotFound();
      }

      const packageJson = extension.packageJSON;
      const contributes = packageJson?.contributes;
      const configuration = contributes?.configuration;

      if (!configuration) {
        return this.getKeysWhenNoConfiguration();
      }

      const properties = Array.isArray(configuration)
        ? configuration.flatMap((c: ExtensionConfiguration) => Object.keys(c.properties || {}))
        : Object.keys(configuration.properties || {});

      const pattern = this.getKeyMatchPatterns();
      const prefix = this.getSettingKeyPrefix();

      let baseUrlKeys = properties.filter((key: string) => pattern.test(key.toLowerCase()));

      if (prefix) {
        baseUrlKeys = baseUrlKeys.filter((key) => key.startsWith(prefix));
      }

      const uniqueKeys = [...new Set(baseUrlKeys)];

      if (uniqueKeys.length > 0) {
        return uniqueKeys;
      }

      return this.getKeysWhenNoConfiguration();
    } catch (error) {
      const formatted = formatThrowable(error);
      this.logger.warning(
        `Error discovering ${this.getDisplayName()} setting keys: ${formatted.message}`,
        formatted.context
      );
      return this.getKeysWhenNoConfiguration();
    }
  }

  /**
   * Optional prefix to filter keys by (e.g. 'kilocode.').
   * Return undefined to skip prefix filtering.
   */
  protected getSettingKeyPrefix(): string | undefined {
    return undefined;
  }

  /**
   * Returns keys when the extension is not found at all.
   * Default: empty array (causes guided steps to be shown).
   */
  protected getKeysWhenExtensionNotFound(): string[] {
    return [];
  }

  /**
   * Returns keys when the extension is installed but has no configuration section.
   * Default: fallback keys (so known settings are still written).
   */
  protected getKeysWhenNoConfiguration(): string[] {
    return this.getFallbackKeys();
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    let plan = createPlan(profile.id, [this.assistantKey]);
    const settingKeys = await this.discoverSettingKeys();

    for (const key of settingKeys) {
      plan = addStep(plan, {
        action: 'set-vscode-setting',
        description: `Set ${key} to ${profile.baseUrl}`,
        assistantKey: this.assistantKey,
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
        description: `Manual configuration required for ${this.getDisplayName()}`,
        assistantKey: this.assistantKey,
        data: this.getGuidedSteps(profile),
        reversible: false
      });
    }

    return plan;
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const config = vscode.workspace.getConfiguration();
    const settingKeys = await this.discoverSettingKeys();

    if (settingKeys.length === 0) {
      return {
        success: false,
        message: `No ${this.getDisplayName()} base URL settings configured`,
        details: { checkedKeys: [] }
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
        message: `No ${this.getDisplayName()} base URL settings configured`,
        details: { checkedKeys: settingKeys }
      };
    }

    return {
      success: true,
      message: `${this.getDisplayName()} configuration verified`,
      details: { configuredSettings: configuredKeys }
    };
  }
}
