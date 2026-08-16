/**
 * Adapter for GitHub Copilot assistant.
 *
 * Routes Copilot completion and chat API traffic that uses the Copilot proxy
 * endpoint through the AIdome gateway by setting the legacy
 * `github.copilot.advanced.debug.overrideProxyUrl` setting. Current Copilot
 * Chat source still consumes this key for domain selection, and the
 * completions network configuration still accepts it as a fallback for its
 * newer internal endpoint key.
 *
 * Copilot BYOK is a separate VS Code feature. The adapter does not write BYOK
 * provider records, model metadata, or API keys. Those are configured through
 * VS Code's Language Models UI and its `chatLanguageModels.json` data.
 *
 * The override is undocumented and may change or be removed. The original
 * upstream repository was archived after moving active development into the
 * VS Code repository, so this adapter must be rechecked after Copilot/VS Code
 * updates.
 *
 * Upstream evidence (first pass, reread after implementation):
 * - Archived repo: https://github.com/microsoft/vscode-copilot-chat
 * - Active repo after the move: https://github.com/microsoft/vscode
 * - Archived checkout: commit 5863f5a7088958050792b5dccbe8b46c6e13eccc,
 *   package version 0.44.0 (2026-05-20)
 * - Inspected source files: configurationService.ts, domainServiceImpl.ts,
 *   completions-core/vscode-node/lib/src/config.ts, and networkConfiguration.ts.
 */

import * as vscode from 'vscode';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { validateUrl } from '../../core/profiles/profileValidator';
import { GuidedStepsData, Plan, addStep, createPlan } from '../../core/orchestration/planBuilder';
import { redactUrl } from '../../util/redact';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';

/** VS Code setting namespace used by Copilot's advanced settings. */
const ADVANCED_SETTING_KEY = 'github.copilot.advanced';

/** Legacy property still consumed by current Copilot Chat source. */
const PROXY_URL_PROPERTY = 'debug.overrideProxyUrl';

/** Fully qualified setting key for the proxy override. */
const PROXY_SETTING_KEY = `${ADVANCED_SETTING_KEY}.${PROXY_URL_PROPERTY}`;

interface ProxyOverrideReading {
  value: unknown;
  source: 'direct' | 'advanced-object' | 'missing';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads both VS Code representations observed for this legacy setting.
 *
 * VS Code normally exposes a fully qualified setting directly, while older
 * settings files and test fixtures may expose the `advanced` object. Supporting
 * both keeps verification compatible without replacing unrelated Copilot keys.
 */
function readProxyOverride(config: vscode.WorkspaceConfiguration): ProxyOverrideReading {
  const directValue = config.get<unknown>(PROXY_SETTING_KEY);
  if (directValue !== undefined) {
    return { value: directValue, source: 'direct' };
  }

  const advancedValue = config.get<unknown>(ADVANCED_SETTING_KEY);
  if (isRecord(advancedValue) && PROXY_URL_PROPERTY in advancedValue) {
    return { value: advancedValue[PROXY_URL_PROPERTY], source: 'advanced-object' };
  }

  return { value: undefined, source: 'missing' };
}

function isRegisteredProxySetting(config: vscode.WorkspaceConfiguration): boolean {
  return config.inspect<unknown>(PROXY_SETTING_KEY) !== undefined;
}

function buildGuidedFallback(profile: EndpointProfile): GuidedStepsData {
  return {
    message: 'GitHub Copilot proxy override requires manual setup on this installation.',
    steps: [
      'Open Preferences: Open User Settings (JSON).',
      `Add or update "${PROXY_SETTING_KEY}" with the validated endpoint URL from the selected profile, preserving unrelated settings.`,
      'Reload VS Code or restart GitHub Copilot so the endpoint override is re-read.',
      'Run AIdome: Verify All Profile Routes to confirm the override has a valid HTTP(S) URL.',
      'This fallback configures proxy routing only; it does not configure Copilot BYOK providers, model records, or API keys.'
    ],
    baseUrl: profile.baseUrl,
    tier: 'B',
    limitation: 'proxy-override-setting-not-registered',
    configurationType: 'vscode-settings'
  };
}

/**
 * GitHub Copilot assistant adapter.
 *
 * Tier B — automatic configuration when the proxy override is registered,
 * with a guided settings.json fallback for installations that do not expose
 * the undocumented setting through the VS Code configuration API.
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
    let plan = createPlan(profile.id, ['github-copilot']);
    const endpointUrl = profile.baseUrl.trim();

    if (!validateUrl(endpointUrl)) {
      throw new Error('Invalid GitHub Copilot proxy override URL');
    }

    const config = vscode.workspace.getConfiguration();
    if (!isRegisteredProxySetting(config)) {
      return addStep(plan, {
        action: 'show-guided-steps',
        description: 'Show GitHub Copilot proxy override setup guidance',
        assistantKey: 'github-copilot',
        data: buildGuidedFallback({ ...profile, baseUrl: endpointUrl }),
        reversible: false
      });
    }

    const currentProxy = readProxyOverride(config);
    plan = addStep(plan, {
      action: 'set-vscode-setting',
      description: `Set GitHub Copilot proxy override URL to ${redactUrl(endpointUrl)}`,
      assistantKey: 'github-copilot',
      targetPath: PROXY_SETTING_KEY,
      oldValue: currentProxy.value,
      newValue: endpointUrl,
      data: {
        settingKey: PROXY_SETTING_KEY,
        value: endpointUrl,
        method: 'proxy-override'
      },
      reversible: true
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
          copilotChat: false
        }
      };
    }

    const proxyOverride = readProxyOverride(vscode.workspace.getConfiguration());
    const proxyUrl = typeof proxyOverride.value === 'string'
      ? proxyOverride.value.trim()
      : undefined;
    const isConfigured = proxyUrl !== undefined && validateUrl(proxyUrl);
    const validation = proxyOverride.source === 'missing'
      ? 'missing'
      : isConfigured
        ? 'valid'
        : 'invalid';

    return {
      success: isConfigured,
      message: isConfigured
        ? 'GitHub Copilot is configured with AIdome endpoint routing'
        : validation === 'missing'
          ? 'GitHub Copilot is installed but endpoint routing is not yet configured'
          : 'GitHub Copilot has an invalid proxy override URL; endpoint routing is not verified',
      details: {
        copilot: !!copilotExtension,
        copilotChat: !!copilotChatExtension,
        tier: 'B',
        proxyOverrideConfigured: isConfigured,
        proxyOverrideValidation: validation,
        proxyOverrideSource: proxyOverride.source,
        proxyUrl: isConfigured && proxyUrl ? redactUrl(proxyUrl) : null
      }
    };
  }

  getDisplayName(): string {
    return 'GitHub Copilot';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'B';
  }
}
