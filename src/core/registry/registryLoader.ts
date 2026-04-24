/**
 * Registry loader for assistants.registry.json.
 * Loads and validates the assistant registry data.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { AssistantRegistry, AssistantEntry } from './registryTypes';
import { withRetry } from '../../util/retry';

/**
 * Hardcoded minimal fallback registry for when the main registry is corrupted.
 */
const FALLBACK_REGISTRY: AssistantRegistry = {
  $schemaVersion: '1.0',
  updatedAt: new Date().toISOString(),
  dialectCatalog: {
    'openai.chat_completions': 'OpenAI-style /v1/chat/completions'
  },
  assistants: [
    {
      key: 'continue',
      displayName: 'Continue',
      kind: 'vscode-extension',
      detection: {
        vscodeExtensionIds: ['Continue.continue']
      },
      dialect: {
        primary: 'openai.chat_completions',
        alsoPossible: []
      },
      endpointSwitching: {
        supported: true,
        tier: 'A',
        configurationModes: ['settings'],
        notes: ['Fallback registry entry']
      },
      tlsVerification: {
        support: 'native',
        notes: 'Fallback entry — see full registry for details'
      },
      sources: []
    },
    {
      key: 'cline',
      displayName: 'Cline',
      kind: 'vscode-extension',
      detection: {
        vscodeExtensionIds: ['saoudrizwan.claude-dev']
      },
      dialect: {
        primary: 'openai.chat_completions',
        alsoPossible: []
      },
      endpointSwitching: {
        supported: true,
        tier: 'A',
        configurationModes: ['settings'],
        notes: ['Fallback registry entry']
      },
      tlsVerification: {
        support: 'vscode-global',
        notes: 'Fallback entry — see full registry for details'
      },
      sources: []
    }
  ]
};

/**
 * Loads the assistant registry from disk.
 * Falls back to hardcoded minimal registry if file is corrupted.
 * Retries the read once on transient I/O errors before giving up.
 * @returns Promise resolving to the validated registry
 * @throws Error if registry file is not found or invalid
 */
export async function loadRegistry(): Promise<AssistantRegistry> {
  const registryPath = path.join(__dirname, 'assistants.registry.json');
  
  try {
    const content = await withRetry(
      () => fs.readFile(registryPath, 'utf-8'),
      {
        maxAttempts: 2,
        baseDelayMs: 100,
        maxDelayMs: 500,
        isRetryable: (e) => {
          // Retry on transient I/O errors (EAGAIN, EMFILE) but not on
          // ENOENT (file missing) — that would never succeed on retry.
          const code = (e as NodeJS.ErrnoException).code;
          return code !== 'ENOENT';
        }
      }
    );
    const registry = JSON.parse(content) as AssistantRegistry;
    
    // Basic validation
    if (!registry.$schemaVersion || !registry.assistants || !Array.isArray(registry.assistants)) {
      throw new Error('Invalid registry structure');
    }
    
    return registry;
  } catch (error) {
    const logger = await import('../../util/log').then(m => m.Logger.getInstance());
    logger.error('Failed to load registry, using fallback', error instanceof Error ? error : undefined);
    
    // Return fallback registry instead of throwing
    return FALLBACK_REGISTRY;
  }
}

/**
 * Finds an assistant entry by key.
 * @param registry The assistant registry
 * @param key The assistant key to find
 * @returns The assistant entry or undefined
 */
export function findAssistant(registry: AssistantRegistry, key: string): AssistantEntry | undefined {
  return registry.assistants.find(a => a.key === key);
}

/**
 * Gets all assistants of a specific tier.
 * @param registry The assistant registry
 * @param tier The tier to filter by (A, B, or C)
 * @returns Array of assistant entries
 */
export function getAssistantsByTier(registry: AssistantRegistry, tier: 'A' | 'B' | 'C'): AssistantEntry[] {
  return registry.assistants.filter(a => a.endpointSwitching.tier === tier);
}

/**
 * Gets all assistants that support endpoint switching.
 * @param registry The assistant registry
 * @returns Array of assistant entries
 */
export function getSwitchableAssistants(registry: AssistantRegistry): AssistantEntry[] {
  return registry.assistants.filter(a => 
    a.endpointSwitching.supported === true || a.endpointSwitching.supported === 'partially'
  );
}
