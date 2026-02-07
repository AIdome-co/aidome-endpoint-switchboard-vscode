/**
 * Unit tests for registry loader.
 */

import { describe, it, expect } from 'vitest';
import { loadRegistry, findAssistant, getAssistantsByTier, getSwitchableAssistants } from '../../src/core/registry/registryLoader';

describe('Registry Loader', () => {
  it('should load the registry successfully', async () => {
    const registry = await loadRegistry();
    
    expect(registry).toBeDefined();
    expect(registry.$schemaVersion).toBe('0.1.0');
    expect(registry.assistants).toBeInstanceOf(Array);
    expect(registry.assistants.length).toBeGreaterThan(0);
  });

  it('should have the correct number of assistants', async () => {
    const registry = await loadRegistry();
    expect(registry.assistants.length).toBe(11);
  });

  it('should find an assistant by key', async () => {
    const registry = await loadRegistry();
    const cline = findAssistant(registry, 'cline');
    
    expect(cline).toBeDefined();
    expect(cline?.displayName).toBe('Cline');
    expect(cline?.endpointSwitching.tier).toBe('A');
  });

  it('should get assistants by tier', async () => {
    const registry = await loadRegistry();
    const tierA = getAssistantsByTier(registry, 'A');
    
    expect(tierA.length).toBeGreaterThan(0);
    expect(tierA.every(a => a.endpointSwitching.tier === 'A')).toBe(true);
  });

  it('should get switchable assistants', async () => {
    const registry = await loadRegistry();
    const switchable = getSwitchableAssistants(registry);
    
    expect(switchable.length).toBeGreaterThan(0);
    expect(switchable.every(a => 
      a.endpointSwitching.supported === true || a.endpointSwitching.supported === 'partially'
    )).toBe(true);
  });

  it('should have valid dialect catalog', async () => {
    const registry = await loadRegistry();
    
    expect(registry.dialectCatalog).toBeDefined();
    expect(Object.keys(registry.dialectCatalog).length).toBeGreaterThan(0);
    expect(registry.dialectCatalog['openai.chat_completions']).toBeDefined();
  });
});
