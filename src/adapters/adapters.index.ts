/**
 * Adapter resolver for getting the right adapter for an assistant.
 * Uses lazy loading via dynamic imports to minimize activation time.
 */

import { AssistantAdapter } from './AssistantAdapter';

/**
 * Adapter registry mapping assistant keys to lazy loaders.
 */
const ADAPTER_REGISTRY: Record<string, () => Promise<AssistantAdapter>> = {
  'cline': async () => {
    const { ClineAdapter } = await import('./cline/adapter');
    return new ClineAdapter();
  },
  'roo-code': async () => {
    const { RooCodeAdapter } = await import('./roocode/adapter');
    return new RooCodeAdapter();
  },
  'continue': async () => {
    const { ContinueAdapter } = await import('./continue/adapter');
    return new ContinueAdapter();
  },
  'kilo-code': async () => {
    const { KiloCodeAdapter } = await import('./kilocode/adapter');
    return new KiloCodeAdapter();
  },
  'openai-codex': async () => {
    const { CodexAdapter } = await import('./codex/adapter');
    return new CodexAdapter();
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
export async function getAdapter(assistantKey: string): Promise<AssistantAdapter | undefined> {
  const factory = ADAPTER_REGISTRY[assistantKey];
  return factory ? factory() : undefined;
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
