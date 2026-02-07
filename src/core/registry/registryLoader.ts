/**
 * Registry loader for assistants.registry.json.
 * Loads and validates the assistant registry data.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { AssistantRegistry, AssistantEntry } from './registryTypes';

/**
 * Loads the assistant registry from disk.
 * @returns Promise resolving to the validated registry
 * @throws Error if registry file is not found or invalid
 */
export async function loadRegistry(): Promise<AssistantRegistry> {
  const registryPath = path.join(__dirname, 'assistants.registry.json');
  
  try {
    const content = await fs.readFile(registryPath, 'utf-8');
    const registry = JSON.parse(content) as AssistantRegistry;
    
    // Basic validation
    if (!registry.$schemaVersion || !registry.assistants || !Array.isArray(registry.assistants)) {
      throw new Error('Invalid registry structure');
    }
    
    return registry;
  } catch (error) {
    throw new Error(`Failed to load registry: ${error instanceof Error ? error.message : String(error)}`);
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
