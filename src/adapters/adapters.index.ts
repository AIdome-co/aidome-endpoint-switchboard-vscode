/**
 * Adapter resolver for getting the right adapter for an assistant.
 */

import { AssistantAdapter } from './AssistantAdapter';
import { ClineAdapter } from './cline/adapter';
import { RooCodeAdapter } from './roocode/adapter';
import { ContinueAdapter } from './continue/adapter';
import { KiloCodeAdapter } from './kilocode/adapter';
import { CodexAdapter } from './codex/adapter';
import { ClaudeCodeAdapter } from './claudeCode/adapter';
import { GeminiCliAdapter } from './geminiCli/adapter';
import { CodeGptAdapter } from './codegpt/adapter';
import { TabnineAdapter } from './tabnine/adapter';
import { GitHubCopilotAdapter } from './githubCopilot/adapter';
import { AnythingLlmAdapter } from './anythingllm/adapter';

/**
 * Adapter registry mapping assistant keys to adapter constructors.
 */
const ADAPTER_REGISTRY: Record<string, () => AssistantAdapter> = {
  'cline': () => new ClineAdapter(),
  'roo-code': () => new RooCodeAdapter(),
  'continue': () => new ContinueAdapter(),
  'kilo-code': () => new KiloCodeAdapter(),
  'openai-codex': () => new CodexAdapter(),
  'claude-code': () => new ClaudeCodeAdapter(),
  'gemini-cli': () => new GeminiCliAdapter(),
  'codegpt': () => new CodeGptAdapter(),
  'tabnine': () => new TabnineAdapter(),
  'github-copilot': () => new GitHubCopilotAdapter(),
  'anythingllm': () => new AnythingLlmAdapter()
};

/**
 * Gets an adapter for an assistant.
 * @param assistantKey The assistant key
 * @returns Adapter instance or undefined
 */
export function getAdapter(assistantKey: string): AssistantAdapter | undefined {
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
