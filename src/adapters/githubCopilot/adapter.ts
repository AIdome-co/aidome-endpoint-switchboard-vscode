/**
 * Adapter for GitHub Copilot assistant.
 *
 * Supports two interception mechanisms:
 *   1. Proxy Override — sets `github.copilot.advanced.debug.overrideProxyUrl` so all
 *      Copilot REST traffic is routed through the configured gateway.
 *   2. Native BYOK — sets `github.copilot.chat.customOAIModels` (VS Code ≥ 1.104) to
 *      register the AIdome gateway as a custom OpenAI-compatible model in Copilot Chat.
 */

import * as vscode from 'vscode';
import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { Logger } from '../../util/log';

/** The `id` used to identify the AIdome entry inside `customOAIModels`. */
const AIDOME_MODEL_ID = 'aidome-gateway';

/** VS Code setting key for the proxy override object. */
const ADVANCED_SETTING_KEY = 'github.copilot.advanced';

/** Nested property within `github.copilot.advanced` that holds the proxy URL. */
const PROXY_URL_PROPERTY = 'debug.overrideProxyUrl';

/** VS Code setting key for the native BYOK custom model list (VS Code ≥ 1.104). */
const CUSTOM_OAI_MODELS_KEY = 'github.copilot.chat.customOAIModels';

/**
 * GitHub Copilot assistant adapter.
 *
 * Tier B — automatic configuration of VS Code settings with guided context.
 * Two mechanisms are applied in a single plan:
 *   - Proxy override (all Copilot traffic incl. inline completions)
 *   - Custom OpenAI model entry in Copilot Chat (VS Code ≥ 1.104)
 */
export class GitHubCopilotAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

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

    const config = vscode.workspace.getConfiguration();

    // ── Method 1: Proxy Override ────────────────────────────────────────────
    // Sets github.copilot.advanced.debug.overrideProxyUrl so that ALL Copilot
    // REST calls (inline completions + chat) are routed through the gateway.
    const currentAdvanced =
      config.get<Record<string, unknown>>(ADVANCED_SETTING_KEY) ?? {};
    const newAdvanced: Record<string, unknown> = {
      ...currentAdvanced,
      [PROXY_URL_PROPERTY]: profile.baseUrl,
    };

    plan = addStep(plan, {
      action: 'set-vscode-setting',
      description: `Set GitHub Copilot proxy override URL to ${profile.baseUrl}`,
      assistantKey: 'github-copilot',
      targetPath: ADVANCED_SETTING_KEY,
      oldValue: currentAdvanced,
      newValue: newAdvanced,
      data: {
        settingKey: ADVANCED_SETTING_KEY,
        value: newAdvanced,
        method: 'proxy-override',
      },
      reversible: true,
    });

    // ── Method 2: Native BYOK (VS Code ≥ 1.104) ─────────────────────────────
    // Registers the AIdome gateway as a custom OpenAI-compatible model entry
    // inside Copilot Chat's model picker.
    const currentModels =
      config.get<Record<string, unknown>[]>(CUSTOM_OAI_MODELS_KEY) ?? [];

    // Remove any pre-existing AIdome entry to avoid duplicates.
    const filteredModels = currentModels.filter(
      (m) => m['id'] !== AIDOME_MODEL_ID,
    );
    const aidomeModelEntry: Record<string, unknown> = {
      id: AIDOME_MODEL_ID,
      name: 'AIdome Gateway',
      url: `${profile.baseUrl}/chat/completions`,
      // 'version' is VS Code's field name for the model identifier sent to the endpoint.
      version: 'gpt-4o',
    };
    const newModels = [...filteredModels, aidomeModelEntry];

    plan = addStep(plan, {
      action: 'set-vscode-setting',
      description: 'Register AIdome Gateway as a custom OpenAI model in Copilot Chat (VS Code ≥ 1.104)',
      assistantKey: 'github-copilot',
      targetPath: CUSTOM_OAI_MODELS_KEY,
      oldValue: currentModels,
      newValue: newModels,
      data: {
        settingKey: CUSTOM_OAI_MODELS_KEY,
        value: newModels,
        method: 'native-byok',
        requiresVSCodeVersion: '1.104.0',
      },
      reversible: true,
    });

    return plan;
  }

  async apply(_plan: Plan): Promise<void> {
    // Steps are executed by the PlanApplier; nothing extra needed here.
    return Promise.resolve();
  }

  async verify(): Promise<VerificationResult> {
    try {
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

      const advancedSettings =
        config.get<Record<string, unknown>>(ADVANCED_SETTING_KEY) ?? {};
      const proxyUrl = advancedSettings[PROXY_URL_PROPERTY];

      const customModels =
        config.get<Record<string, unknown>[]>(CUSTOM_OAI_MODELS_KEY) ?? [];
      const hasAidomeModel = customModels.some((m) => m['id'] === AIDOME_MODEL_ID);

      const isConfigured = !!proxyUrl || hasAidomeModel;

      return {
        success: isConfigured,
        message: isConfigured
          ? 'GitHub Copilot is configured with AIdome endpoint routing'
          : 'GitHub Copilot is installed but endpoint routing is not yet configured',
        details: {
          copilot: !!copilotExtension,
          copilotChat: !!copilotChatExtension,
          tier: 'B',
          proxyOverrideConfigured: !!proxyUrl,
          customModelsConfigured: hasAidomeModel,
          proxyUrl: proxyUrl ?? null,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Error verifying GitHub Copilot: ${(error as Error).message}`,
        details: { error: (error as Error).message },
      };
    }
  }

  getDisplayName(): string {
    return 'GitHub Copilot';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'B';
  }
}
