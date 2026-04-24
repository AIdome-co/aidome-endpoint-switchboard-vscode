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

  describe('TLS verification metadata', () => {
    const VALID_SUPPORT_LEVELS = ['native', 'env-var', 'vscode-global', 'none'] as const;

    it('every assistant should have a tlsVerification entry', async () => {
      const registry = await loadRegistry();

      for (const assistant of registry.assistants) {
        expect(assistant.tlsVerification, `${assistant.key} missing tlsVerification`).toBeDefined();
        expect(assistant.tlsVerification.support, `${assistant.key} missing support level`).toBeDefined();
        expect(
          VALID_SUPPORT_LEVELS.includes(assistant.tlsVerification.support as typeof VALID_SUPPORT_LEVELS[number]),
          `${assistant.key} has invalid support level: ${assistant.tlsVerification.support}`
        ).toBe(true);
        expect(
          typeof assistant.tlsVerification.notes === 'string' && assistant.tlsVerification.notes.length > 0,
          `${assistant.key} should have a non-empty notes string`
        ).toBe(true);
      }
    });

    it('should map Continue.dev as native TLS support', async () => {
      const registry = await loadRegistry();
      const cont = findAssistant(registry, 'continue');
      expect(cont?.tlsVerification.support).toBe('native');
      expect(cont?.tlsVerification.settingHint).toBeDefined();
    });

    it('should map Claude Code as env-var TLS support', async () => {
      const registry = await loadRegistry();
      const claude = findAssistant(registry, 'claude-code');
      expect(claude?.tlsVerification.support).toBe('env-var');
      expect(claude?.tlsVerification.settingHint).toContain('ANTHROPIC_DISABLE_TLS_VERIFY');
    });

    it('should map Codex CLI as env-var TLS support', async () => {
      const registry = await loadRegistry();
      const codex = findAssistant(registry, 'openai-codex');
      expect(codex?.tlsVerification.support).toBe('env-var');
      expect(codex?.tlsVerification.settingHint).toContain('CODEX_CA_CERTIFICATE');
    });

    it('should map Gemini CLI as none (no TLS control)', async () => {
      const registry = await loadRegistry();
      const gemini = findAssistant(registry, 'gemini-cli');
      expect(gemini?.tlsVerification.support).toBe('none');
    });

    it('should map VS Code extensions without native TLS as vscode-global', async () => {
      const registry = await loadRegistry();
      const vsCodeGlobal = ['github-copilot', 'cline', 'roo-code', 'kilo-code', 'codegpt', 'tabnine'];

      for (const key of vsCodeGlobal) {
        const assistant = findAssistant(registry, key);
        expect(assistant?.tlsVerification.support, `${key} should be vscode-global`).toBe('vscode-global');
      }
    });

    it('should map AnythingLLM as env-var TLS support', async () => {
      const registry = await loadRegistry();
      const allm = findAssistant(registry, 'anythingllm');
      expect(allm?.tlsVerification.support).toBe('env-var');
      expect(allm?.tlsVerification.settingHint).toContain('NODE_TLS_REJECT_UNAUTHORIZED');
    });
  });
});
