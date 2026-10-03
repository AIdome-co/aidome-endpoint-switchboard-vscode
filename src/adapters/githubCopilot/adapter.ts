/**
 * Adapter for GitHub Copilot assistant.
 *
 * Routes Copilot traffic through the AIdome gateway by setting the legacy proxy
 * override setting `github.copilot.advanced.debug.overrideProxyUrl`
 * (`ConfigKey.Shared.DebugOverrideProxyUrl`, defined as
 * `advanced.debug.overrideProxyUrl` in the active Copilot source under
 * `microsoft/vscode` — `extensions/copilot/src/platform/configuration/common/
 * configurationService.ts`). The setting maps to `internal.completionsUrl`,
 * routing all Copilot REST traffic (inline completions + chat) through the
 * configured URL.
 *
 * Upstream representation (configurationServiceImpl.ts, `getConfig`):
 *   1. Preferred flat style: a top-level setting keyed
 *      `github.copilot.advanced.debug.overrideProxyUrl`.
 *   2. Legacy object style: `github.copilot.advanced` object holding the
 *      subkey `debug.overrideProxyUrl` as ONE flat key — i.e.
 *      `{ "debug.overrideProxyUrl": "https://..." }`, NOT
 *      `{ "debug": { "overrideProxyUrl": "..." } }`.
 * The adapter writes the preferred flat style so unrelated object keys in
 * `github.copilot.advanced` are untouched, and reads both styles back.
 *
 * The proxy URL is used verbatim from the profile: this is a proxy contract
 * (a reverse-proxy endpoint masquerading as GitHub's API surface), NOT an
 * OpenAI `/v1` provider base URL, so `normalizeOpenAiBaseUrl` must not be
 * applied here.
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
 * Verified against: microsoft/vscode `extensions/copilot` source (2026-10-03).
 */

import * as vscode from 'vscode';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { getProviderConfigDescriptor } from '../../core/providerConfig/descriptors';
import { readObjectSetting } from '../../core/providerConfig/vscodeSettingDriver';

/** VS Code setting key for the proxy override object. */
const DESCRIPTOR = getProviderConfigDescriptor('github-copilot');

/**
 * Preferred flat-style setting key. Upstream reads
 * `github.copilot.advanced.debug.overrideProxyUrl` as a single dotted key.
 */
const FLAT_SETTING_KEY = DESCRIPTOR?.targets[0]?.settingKey ?? 'github.copilot.advanced.debug.overrideProxyUrl';

/** Object-style container key (`github.copilot.advanced`). */
const OBJECT_SETTING_KEY = 'github.copilot.advanced';

/** Flat subkey inside the object style. Upstream reads `advanced[advancedSubKey]`. */
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

  /** Proxy URL expected by the most recent buildPlan, for exact verification. */
  private expectedProxyUrl: string | undefined;

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
    // Copilot consumes the URL as a proxy endpoint verbatim. No /v1 suffix or
    // other OpenAI normalization is applied — the profile URL IS the proxy URL.
    const baseUrl = profile.baseUrl;
    this.expectedProxyUrl = baseUrl;
    let plan = createPlan(profile.id, ['github-copilot']);

    const config = vscode.workspace.getConfiguration();

    if (!supportsLegacyProxySetting(config)) {
      return addGuidedConfigurationPlan(profile);
    }

    const currentValue = config.get<unknown>(FLAT_SETTING_KEY);

    plan = addStep(plan, {
      action: 'set-vscode-setting',
      description: `Set GitHub Copilot proxy override URL to ${baseUrl}`,
      assistantKey: 'github-copilot',
      targetPath: FLAT_SETTING_KEY,
      oldValue: currentValue,
      newValue: baseUrl,
      data: {
        settingKey: FLAT_SETTING_KEY,
        value: baseUrl,
        method: 'proxy-override',
        driver: 'vscode-setting',
        descriptorKey: 'github-copilot',
        expectedProxyUrl: baseUrl,
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

    const proxyUrl = readConfiguredProxyUrl(config);
    const isConfigured = typeof proxyUrl === 'string' && proxyUrl.trim().length > 0;
    const expectedUrl = this.expectedProxyUrl;

    // Exact match verification: the configured proxy URL must equal the
    // expected profile URL. Merely checking that any URL exists is not
    // sufficient — a stale proxy from a previously applied profile would
    // silently route Copilot to the wrong endpoint.
    if (!isConfigured) {
      return {
        success: false,
        message: 'GitHub Copilot is installed but endpoint routing is not yet configured',
        details: {
          copilot: !!copilotExtension,
          copilotChat: !!copilotChatExtension,
          tier: 'B',
          proxyOverrideConfigured: false,
          proxyUrl: proxyUrl ?? null,
        },
      };
    }

    if (expectedUrl === undefined) {
      return {
        success: false,
        message: 'GitHub Copilot proxy URL is set, but the expected AIdome profile URL is unknown — apply a profile first to verify an exact match',
        details: {
          copilot: !!copilotExtension,
          copilotChat: !!copilotChatExtension,
          tier: 'B',
          proxyOverrideConfigured: true,
          proxyUrl,
          exactUrlMatchVerified: false,
        },
      };
    }

    const exactMatch = proxyUrl === expectedUrl;

    return {
      success: exactMatch,
      message: exactMatch
        ? 'GitHub Copilot is configured with AIdome endpoint routing'
        : `GitHub Copilot proxy URL (${proxyUrl}) does not match the expected profile URL (${expectedUrl})`,
      details: {
        copilot: !!copilotExtension,
        copilotChat: !!copilotChatExtension,
        tier: 'B',
        proxyOverrideConfigured: true,
        proxyUrl: proxyUrl ?? null,
        expectedProxyUrl: expectedUrl,
        exactUrlMatchVerified: exactMatch,
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

/**
 * Reads the configured proxy URL using upstream's read precedence:
 * 1. Flat style — `github.copilot.advanced.debug.overrideProxyUrl`.
 * 2. Object style — `github.copilot.advanced` object, subkey
 *    `debug.overrideProxyUrl` read as ONE flat key (upstream
 *    `advancedConfig?.[key.advancedSubKey]`).
 */
function readConfiguredProxyUrl(config: vscode.WorkspaceConfiguration): unknown {
  const flatValue = config.get<unknown>(FLAT_SETTING_KEY);
  if (flatValue !== undefined) {
    return flatValue;
  }
  const advanced = config.get<Record<string, unknown>>(OBJECT_SETTING_KEY) ?? {};
  return readObjectSetting(advanced, [PROXY_URL_PROPERTY]);
}

function supportsLegacyProxySetting(config: vscode.WorkspaceConfiguration): boolean {
  // Older test hosts and older Copilot releases do not expose inspect(). In
  // that case retain the legacy path and let the setting update report any
  // incompatibility. Current VS Code hosts expose inspect() and return
  // undefined for the removed/unregistered key.
  if (typeof config.inspect !== 'function') {
    return true;
  }
  return config.inspect(FLAT_SETTING_KEY) !== undefined
    || config.inspect(OBJECT_SETTING_KEY) !== undefined;
}

function addGuidedConfigurationPlan(profile: EndpointProfile): Plan {
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
        `Set the endpoint URL to ${profile.baseUrl}.`,
        'Choose a model returned by the gateway and enter the gateway token in Copilot’s secure UI.',
        'Reload VS Code, then send a test chat message.'
      ],
      baseUrl: profile.baseUrl,
      tier: 'B',
      limitation: 'The current Copilot extension manages custom endpoints through its language-model UI, not the removed github.copilot.advanced setting.',
      configurationType: 'copilot-custom-endpoint-ui',
      optional: false
    },
    reversible: false
  });
}
