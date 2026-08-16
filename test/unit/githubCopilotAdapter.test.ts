/**
 * Unit tests for GitHub Copilot adapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubCopilotAdapter } from '../../src/adapters/githubCopilot/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

const mockExtension = { packageJSON: {} };

const mockConfig = {
  get: vi.fn(),
  inspect: vi.fn(),
  update: vi.fn()
};

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn()
  },
  workspace: {
    getConfiguration: vi.fn(() => mockConfig)
  }
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn()
    })
  }
}));

describe('GitHubCopilotAdapter', () => {
  let adapter: GitHubCopilotAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new GitHubCopilotAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      profileType: 'custom',
      baseUrl: 'https://aidome.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    } as EndpointProfile;
    vi.clearAllMocks();
    mockConfig.get.mockReturnValue(undefined);
    mockConfig.inspect.mockReturnValue({});
  });

  describe('detect', () => {
    it('returns true when Copilot is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension')
        .mockReturnValueOnce(mockExtension as never)
        .mockReturnValueOnce(undefined);

      await expect(adapter.detect()).resolves.toBe(true);
      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('GitHub.copilot');
    });

    it('returns true when only Copilot Chat is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension')
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(mockExtension as never);

      await expect(adapter.detect()).resolves.toBe(true);
      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('GitHub.copilot-chat');
    });

    it('returns false when neither extension is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

      await expect(adapter.detect()).resolves.toBe(false);
    });

    it('returns false when extension detection throws', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(() => {
        throw new Error('Test error');
      });

      await expect(adapter.detect()).resolves.toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('creates a reversible direct proxy-setting step', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('github-copilot');
      expect(plan.steps).toHaveLength(1);

      const proxyStep = plan.steps[0];
      expect(proxyStep.action).toBe('set-vscode-setting');
      expect(proxyStep.targetPath).toBe('github.copilot.advanced.debug.overrideProxyUrl');
      expect(proxyStep.newValue).toBe(mockProfile.baseUrl);
      expect(proxyStep.reversible).toBe(true);
      expect(proxyStep.data['method']).toBe('proxy-override');
    });

    it('preserves unrelated advanced settings by updating only the proxy leaf', async () => {
      const existingAdvanced = {
        someOtherKey: 'someValue',
        'debug.overrideProxyUrl': 'https://old.example.com'
      };
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced') {
          return existingAdvanced;
        }
        return undefined;
      });

      const plan = await adapter.buildPlan(mockProfile);
      const proxyStep = plan.steps[0];

      expect(proxyStep.targetPath).toBe('github.copilot.advanced.debug.overrideProxyUrl');
      expect(proxyStep.oldValue).toBe('https://old.example.com');
      expect(proxyStep.newValue).toBe(mockProfile.baseUrl);
    });

    it('uses an existing direct setting value for rollback', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced.debug.overrideProxyUrl') {
          return 'https://old.example.com';
        }
        return undefined;
      });

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps[0].oldValue).toBe('https://old.example.com');
      expect(plan.steps[0].reversible).toBe(true);
    });

    it('falls back to guided settings.json instructions when the setting is not registered', async () => {
      mockConfig.inspect.mockReturnValue(undefined);

      const plan = await adapter.buildPlan(mockProfile);
      const guidedStep = plan.steps[0];

      expect(guidedStep.action).toBe('show-guided-steps');
      expect(guidedStep.reversible).toBe(false);
      expect(guidedStep.data['tier']).toBe('B');
      expect(guidedStep.data['limitation']).toBe('proxy-override-setting-not-registered');
      expect(guidedStep.data['steps']).toEqual(expect.arrayContaining([
        expect.stringContaining('github.copilot.advanced.debug.overrideProxyUrl'),
        expect.stringContaining('does not configure Copilot BYOK')
      ]));
    });

    it('rejects unsafe or malformed endpoint URLs before creating a plan', async () => {
      for (const baseUrl of ['javascript:alert(1)', 'data:text/plain,unsafe', 'not a URL']) {
        await expect(adapter.buildPlan({ ...mockProfile, baseUrl })).rejects.toThrow(
          'Invalid GitHub Copilot proxy override URL'
        );
      }
    });
  });

  describe('apply', () => {
    it('leaves execution to the shared plan applier', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      await expect(adapter.apply(plan)).resolves.toBeUndefined();
    });
  });

  describe('verify', () => {
    it('returns failure when neither extension is installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not installed');
      expect(result.details?.copilot).toBe(false);
      expect(result.details?.copilotChat).toBe(false);
    });

    it('verifies a valid direct proxy override', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced.debug.overrideProxyUrl') {
          return 'https://aidome.example.com/v1';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('configured');
      expect(result.details?.proxyOverrideConfigured).toBe(true);
      expect(result.details?.proxyOverrideValidation).toBe('valid');
      expect(result.details?.proxyOverrideSource).toBe('direct');
      expect(result.details?.tier).toBe('B');
    });

    it('verifies the legacy advanced object representation', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced') {
          return { 'debug.overrideProxyUrl': 'https://aidome.example.com/v1' };
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.proxyOverrideSource).toBe('advanced-object');
    });

    it('rejects malformed, non-string, and unsafe proxy override values', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);

      for (const value of [true, '   ', 'javascript:alert(1)', 'http://gateway.example.com']) {
        mockConfig.get.mockImplementation((key: string) => {
          if (key === 'github.copilot.advanced') {
            return { 'debug.overrideProxyUrl': value };
          }
          return undefined;
        });

        const result = await adapter.verify();

        expect(result.success).toBe(false);
        expect(result.details?.proxyOverrideConfigured).toBe(false);
        expect(result.details?.proxyOverrideValidation).toBe('invalid');
        expect(result.details?.proxyUrl).toBeNull();
      }
    });

    it('returns not-configured when the setting is missing', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);
      mockConfig.get.mockReturnValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not yet configured');
      expect(result.details?.proxyOverrideConfigured).toBe(false);
      expect(result.details?.proxyOverrideValidation).toBe('missing');
      expect(result.details?.tier).toBe('B');
    });

    it('reports extension presence independently from configuration state', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension')
        .mockReturnValueOnce(mockExtension as never)
        .mockReturnValueOnce(undefined);
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced') {
          return { 'debug.overrideProxyUrl': 'https://aidome.example.com/v1' };
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.details?.copilot).toBe(true);
      expect(result.details?.copilotChat).toBe(false);
    });

    it('redacts credentials and query parameters from verification details', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced') {
          return { 'debug.overrideProxyUrl': 'https://user:secret@aidome.example.com/v1?token=hidden' };
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.proxyUrl).toBe('https://aidome.example.com/v1 [credentials & query params redacted]');
      expect(result.details?.proxyUrl).not.toContain('secret');
      expect(result.details?.proxyUrl).not.toContain('hidden');
    });

    it('handles verification errors gracefully', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(() => {
        throw new Error('Test error');
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying');
    });
  });

  it('reports its display name and Tier B support', () => {
    expect(adapter.getDisplayName()).toBe('GitHub Copilot');
    expect(adapter.getTier()).toBe('B');
  });
});
