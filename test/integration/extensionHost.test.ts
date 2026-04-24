/**
 * Integration tests for extension host.
 * Verifies adapter registry, lazy loading, and command registration.
 */

import { describe, it, expect, vi } from 'vitest';
import { getAdapter, getAllAdapterKeys, hasAdapter } from '../../src/adapters/adapters.index';

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn()
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() }))
  },
  window: {
    createWebviewPanel: vi.fn(),
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn()
    })),
    showInformationMessage: vi.fn()
  },
  ViewColumn: { One: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2 }
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    })
  }
}));

describe('Extension Host Integration', () => {
  describe('Adapter Registry', () => {
    it('should register all expected adapter keys', () => {
      const keys = getAllAdapterKeys();
      expect(keys).toContain('cline');
      expect(keys).toContain('roo-code');
      expect(keys).toContain('continue');
      expect(keys).toContain('kilo-code');
      expect(keys).toContain('openai-codex');
      expect(keys).toContain('claude-code');
      expect(keys).toContain('gemini-cli');
      expect(keys).toContain('codegpt');
      expect(keys).toContain('tabnine');
      expect(keys).toContain('github-copilot');
      expect(keys).toContain('anythingllm');
    });

    it('should return true for registered adapters', () => {
      expect(hasAdapter('cline')).toBe(true);
      expect(hasAdapter('continue')).toBe(true);
      expect(hasAdapter('kilo-code')).toBe(true);
    });

    it('should return false for unregistered adapters', () => {
      expect(hasAdapter('nonexistent-adapter')).toBe(false);
    });

    it('should lazy-load the Cline adapter', async () => {
      const adapter = await getAdapter('cline');
      expect(adapter).toBeDefined();
      expect(adapter!.getDisplayName()).toBe('Cline');
      expect(adapter!.getTier()).toBe('A');
    });

    it('should lazy-load the Continue adapter', async () => {
      const adapter = await getAdapter('continue');
      expect(adapter).toBeDefined();
      expect(adapter!.getDisplayName()).toBe('Continue.dev');
    });

    it('should lazy-load the Kilo Code adapter', async () => {
      const adapter = await getAdapter('kilo-code');
      expect(adapter).toBeDefined();
      expect(adapter!.getDisplayName()).toBe('Kilo Code');
    });

    it('should return undefined for unknown adapters', async () => {
      const adapter = await getAdapter('nonexistent');
      expect(adapter).toBeUndefined();
    });

    it('should not include genericSettingsAdapter in registry', () => {
      expect(hasAdapter('generic')).toBe(false);
    });
  });
});
