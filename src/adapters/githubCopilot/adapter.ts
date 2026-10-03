/**
 * Adapter for GitHub Copilot assistant.
 *
 * Routes Copilot traffic through the AIdome gateway by setting the proxy override
 * in `github.copilot.advanced`.  The key `debug.overrideProxyUrl` is the legacy
 * setting (still read by the extension) that maps to `internal.completionsUrl`,
 * which tells Copilot to route ALL REST traffic (inline completions + chat) through
 * the configured URL.  This is confirmed in the official VS Code Copilot Chat source
 * (`src/extension/completions-core/vscode-node/lib/src/config.ts`).
 *
 * Note: There is no publicly available settings.json key for registering a custom
 * BYOK model directly in Copilot Chat via workspace settings.  Custom model
 * providers in the official extension are registered via the VS Code
 * `languageModelChatProviders` contribution point, not via a user-settable key.
 *
 * ⚠️ RISK: `debug.overrideProxyUrl` is NOT documented in the official GitHub
 * Copilot extension docs.  It is an internal/undocumented setting discovered via
 * source inspection.  It may be removed, renamed, or change behaviour in any
 * future Copilot update.  After major Copilot extension updates, re-verify that
 * this adapter still functions correctly.
 * Verified against: Copilot Chat extension source as of 2026-04-24.
 */

import * as vscode from 'vscode';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { getProviderConfigDescriptor } from '../../core/providerConfig/descriptors';
import { mergeObjectSetting, readObjectSetting } from '../../core/providerConfig/vscodeSettingDriver';
import { normalizeOpenAiBaseUrl } from '../../core/providerConfig/endpointUrl';

/** VS Code setting key for the proxy override object. */
const DESCRIPTOR = getProviderConfigDescriptor('github-copilot');
const ADVANCED_SETTING_KEY = DESCRIPTOR?.targets[0]?.settingKey ?? 'github.copilot.advanced';

/**
 * Nested property within `github.copilot.advanced` that sets the proxy URL.
 * Legacy key — maps to `internal.completionsUrl` in the Copilot Chat extension
 * source.  Routes all Copilot REST traffic through the configured URL.
 */
const PROXY_URL_PROPERTY = DESCRIPTOR?.fields[0]?.path ?? 'debug.overrideProxyUrl';

/**
 * GitHub Copilot assistant adapter.
 *
 * Tier B — automatic configuration of VS Code settings.
 * Sets `github.copilot.advanced.debug.overrideProxyUrl` so that all Copilot
 * REST calls (inline completions + chat) are routed through the AIdome gateway.
 */
export class GitHubCopilotAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'GitHub.copilot';

  async detect(): Promise<boolean> {
    try {
      const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
      const copilotChatExtension = vscode.extensions.getExtension('GitHub.copilot-chat');
      return copilotExtension !== undefined || copilotChatExtension !== undefined;
    } catch (error) {
      this.logger.error('Error detecting GitHub Copilot', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    const baseUrl = normalizeOpenAiBaseUrl(profile.baseUrl);
    let plan = createPlan(profile.id, ['github-copilot']);

    const config = vscode.workspace.getConfiguration();

    if (!supportsLegacyProxySetting(config)) {
      return addGuidedConfigurationPlan(profile);
    }

    const currentAdvanced =
      config.get<Record<string, unknown>>(ADVANCED_SETTING_KEY) ?? {};
    const newAdvanced = mergeObjectSetting(currentAdvanced, PROXY_URL_PROPERTY.split('.'), baseUrl);

    plan = addStep(plan, {
      action: 'set-vscode-setting',
      description: `Set GitHub Copilot proxy override URL to ${baseUrl}`,
      assistantKey: 'github-copilot',
      targetPath: ADVANCED_SETTING_KEY,
      oldValue: currentAdvanced,
      newValue: newAdvanced,
      data: {
        settingKey: ADVANCED_SETTING_KEY,
        value: newAdvanced,
        method: 'proxy-override',
        driver: 'vscode-setting',
        descriptorKey: 'github-copilot',
      },
      reversible: true,
    });

    return plan;
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
    const copilotChatExtension = vscode.extensions.getExtension('GitHub.copilot-chat');

    if (!copilotExtension && !copilotChatExtension) {
      return {
        success: false,
        message: 'GitHub Copilot is not installed',
        details: {
          copilot: false,
          copilotChat: false,
        },
      };
    }

    const config = vscode.workspace.getConfiguration();

    if (!supportsLegacyProxySetting(config)) {
      return {
        success: false,
        message: 'GitHub Copilot is installed, but this version requires Custom Endpoint setup in the Copilot UI',
        details: {
          copilot: !!copilotExtension,
          copilotChat: !!copilotChatExtension,
          tier: 'B',
          proxyOverrideConfigured: false,
          requiresGuidedCustomEndpoint: true
        }
      };
    }

    const advancedSettings =
      config.get<Record<string, unknown>>(ADVANCED_SETTING_KEY) ?? {};
    const proxyUrl = readObjectSetting(advancedSettings, PROXY_URL_PROPERTY.split('.'));

    const isConfigured = typeof proxyUrl === 'string' && proxyUrl.trim().length > 0;

    return {
      success: isConfigured,
      message: isConfigured
        ? 'GitHub Copilot is configured with AIdome endpoint routing'
        : 'GitHub Copilot is installed but endpoint routing is not yet configured',
      details: {
        copilot: !!copilotExtension,
        copilotChat: !!copilotChatExtension,
        tier: 'B',
        proxyOverrideConfigured: isConfigured,
        proxyUrl: proxyUrl ?? null,
      },
    };
  }

  getDisplayName(): string {
    return 'GitHub Copilot';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'B';
  }
}

function supportsLegacyProxySetting(config: vscode.WorkspaceConfiguration): boolean {
  // Older test hosts and older Copilot releases do not expose inspect(). In
  // that case retain the legacy path and let the setting update report any
  // incompatibility. Current VS Code hosts expose inspect() and return
  // undefined for the removed/unregistered key.
  if (typeof config.inspect !== 'function') {
    return true;
  }
  return config.inspect(ADVANCED_SETTING_KEY) !== undefined;
}

function addGuidedConfigurationPlan(profile: EndpointProfile): Plan {
  const baseUrl = normalizeOpenAiBaseUrl(profile.baseUrl);
  const plan = createPlan(profile.id, ['github-copilot']);
  return addStep(plan, {
    action: 'show-guided-steps',
    description: 'Configure GitHub Copilot Custom Endpoint',
    assistantKey: 'github-copilot',
    data: {
      message: 'This Copilot installation does not expose the legacy proxy setting.',
      steps: [
        'Open Chat: Manage Language Models from the Command Palette.',
        'Add or select a Custom Endpoint and choose the API type supported by the AIdome profile.',
        `Set the endpoint URL to ${baseUrl}.`,
        'Choose a model returned by the gateway and enter the gateway token in Copilot’s secure UI.',
        'Reload VS Code, then send a test chat message.'
      ],
      baseUrl,
      tier: 'B',
      limitation: 'The current Copilot extension manages custom endpoints through its language-model UI, not the removed github.copilot.advanced setting.',
      configurationType: 'copilot-custom-endpoint-ui',
      optional: false
    },
    reversible: false
  });
}
