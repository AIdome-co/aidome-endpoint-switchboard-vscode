/**
 * Adapter resolver for getting the right adapter for an assistant.
 * Uses lazy loading via dynamic imports to minimize activation time.
 */

import { AssistantAdapter } from './AssistantAdapter';
import type { AdapterDependencies } from './adapterDependencies';

/**
 * Adapter registry mapping assistant keys to lazy loaders.
 */
const ADAPTER_REGISTRY: Record<string, (dependencies?: AdapterDependencies) => Promise<AssistantAdapter>> = {
  'cline': async (dependencies) => {
    const { ClineAdapter } = await import('./cline/adapter');
    return new ClineAdapter(dependencies);
  },
  'roo-code': async () => {
    const { RooCodeAdapter } = await import('./roocode/adapter');
    return new RooCodeAdapter();
  },
  'continue': async (dependencies) => {
    const { ContinueAdapter } = await import('./continue/adapter');
    return new ContinueAdapter(dependencies);
  },
  'kilo-code': async () => {
    const { KiloCodeAdapter } = await import('./kilocode/adapter');
    return new KiloCodeAdapter();
  },
  'openai-codex': async (dependencies) => {
    const { CodexAdapter } = await import('./codex/adapter');
    return new CodexAdapter(dependencies);
  },
  'claude-code': async () => {
    const { ClaudeCodeAdapter } = await import('./claudeCode/adapter');
    return new ClaudeCodeAdapter();
  },
  'gemini-cli': async () => {
    const { GeminiCliAdapter } = await import('./geminiCli/adapter');
    return new GeminiCliAdapter();
  },
  'codegpt': async () => {
    const { CodeGptAdapter } = await import('./codegpt/adapter');
    return new CodeGptAdapter();
  },
  'tabnine': async () => {
    const { TabnineAdapter } = await import('./tabnine/adapter');
    return new TabnineAdapter();
  },
  'github-copilot': async () => {
    const { GitHubCopilotAdapter } = await import('./githubCopilot/adapter');
    return new GitHubCopilotAdapter();
  },
  'anythingllm': async () => {
    const { AnythingLlmAdapter } = await import('./anythingllm/adapter');
    return new AnythingLlmAdapter();
  }
};

/**
 * Gets an adapter for an assistant using lazy loading.
 * @param assistantKey The assistant key
 * @returns Promise resolving to adapter instance or undefined
 */
export async function getAdapter(
  assistantKey: string,
  dependencies?: AdapterDependencies
): Promise<AssistantAdapter | undefined> {
  const factory = ADAPTER_REGISTRY[assistantKey];
  return factory ? factory(dependencies) : undefined;
}

/**
 * Gets all registered assistant keys.
 * @returns Array of assistant keys
 */
export function getAllAdapterKeys(): string[] {
  return Object.keys(ADAPTER_REGISTRY);
}

/**
 * Checks if an adapter exists for an assistant.
 * @param assistantKey The assistant key
 * @returns True if adapter exists
 */
export function hasAdapter(assistantKey: string): boolean {
  return assistantKey in ADAPTER_REGISTRY;
}

/**
 * Resolves which of the given assistants offer ACTIONABLE guided setup
 * (`show-guided-steps` plans the user can actually follow to route traffic).
 *
 * Tier C adapters declare their actionability via
 * `AssistantAdapter.getGuidedSetupStatus()`; adapters without the capability
 * are never eligible. Non-Tier-C keys are skipped without instantiating an
 * adapter.
 * @param assistantKeys Keys to evaluate (extension and CLI detections)
 * @param registryAssistants Registry entries used to resolve each key's tier
 * @returns Set of keys with actionable guided setup (a subset of Tier C keys)
 */
export async function getGuidedSetupEligibleKeys(
  assistantKeys: readonly string[],
  registryAssistants: ReadonlyArray<{ key: string; endpointSwitching: { tier: 'A' | 'B' | 'C' } }>
): Promise<Set<string>> {
  const tierByKey = new Map(registryAssistants.map(assistant => [assistant.key, assistant.endpointSwitching.tier]));
  const eligible = new Set<string>();
  for (const assistantKey of assistantKeys) {
    if (tierByKey.get(assistantKey) !== 'C') {
      continue;
    }
    const adapter = await getAdapter(assistantKey);
    if (adapter?.getGuidedSetupStatus?.() === 'actionable') {
      eligible.add(assistantKey);
    }
  }
  return eligible;
}
