/**
 * Unit tests for GitHub Copilot adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubCopilotAdapter } from '../../src/adapters/githubCopilot/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

// Mock vscode module
const mockExtension = {
  packageJSON: {}
};

const mockConfig = {
  get: vi.fn(),
  update: vi.fn(),
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
      info: vi.fn(),
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
    // Default: no existing settings
    mockConfig.get.mockReturnValue(undefined);
  });

  describe('detect', () => {
    it('should return true when Copilot extension is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension')
        .mockReturnValueOnce(mockExtension as any)
        .mockReturnValueOnce(undefined);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('GitHub.copilot');
    });

    it('should return true when Copilot Chat extension is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension')
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(mockExtension as any);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('GitHub.copilot-chat');
    });

    it('should return true when both extensions are detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);

      const result = await adapter.detect();

      expect(result).toBe(true);
    });

    it('should return false when no extensions are detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

      const result = await adapter.detect();

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(() => {
        throw new Error('Test error');
      });

      const result = await adapter.detect();

      expect(result).toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('should create a plan with a single proxy-override step', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan).toBeDefined();
      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('github-copilot');
      expect(plan.steps).toHaveLength(1);
    });

    it('should include a set-vscode-setting step for the proxy override', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const proxyStep = plan.steps.find(
        (s) => s.action === 'set-vscode-setting' && s.data['method'] === 'proxy-override'
      );
      expect(proxyStep).toBeDefined();
      expect(proxyStep!.targetPath).toBe('github.copilot.advanced');
      expect(proxyStep!.reversible).toBe(true);

      const newValue = proxyStep!.newValue as Record<string, unknown>;
      expect(newValue['debug.overrideProxyUrl']).toBe(mockProfile.baseUrl);
    });

    it('should preserve existing advanced settings when adding proxy URL', async () => {
      const existingAdvanced = { 'someOtherKey': 'someValue' };
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced') {
          return existingAdvanced;
        }
        return undefined;
      });

      const plan = await adapter.buildPlan(mockProfile);

      const proxyStep = plan.steps.find((s) => s.data['method'] === 'proxy-override');
      const newValue = proxyStep!.newValue as Record<string, unknown>;
      expect(newValue['someOtherKey']).toBe('someValue');
      expect(newValue['debug.overrideProxyUrl']).toBe(mockProfile.baseUrl);
    });

    it('should capture the old advanced value for rollback', async () => {
      const existingAdvanced = { 'debug.overrideProxyUrl': 'https://old.example.com' };
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced') {
          return existingAdvanced;
        }
        return undefined;
      });

      const plan = await adapter.buildPlan(mockProfile);

      const proxyStep = plan.steps.find((s) => s.data['method'] === 'proxy-override');
      expect(proxyStep!.oldValue).toEqual(existingAdvanced);
    });
  });

  describe('apply', () => {
    it('should resolve without throwing', async () => {
      const plan = await adapter.buildPlan(mockProfile);
      await expect(adapter.apply(plan)).resolves.toBeUndefined();
    });
  });

  describe('verify', () => {
    it('should return failure when neither extension is installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not installed');
      expect(result.details?.copilot).toBe(false);
      expect(result.details?.copilotChat).toBe(false);
    });

    it('should return success when proxy override is configured', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced') {
          return { 'debug.overrideProxyUrl': 'https://aidome.example.com/v1' };
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('configured');
      expect(result.details?.proxyOverrideConfigured).toBe(true);
      expect(result.details?.tier).toBe('B');
    });

    it('should return not-configured when extension is installed but no settings are set', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      mockConfig.get.mockReturnValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not yet configured');
      expect(result.details?.proxyOverrideConfigured).toBe(false);
      expect(result.details?.tier).toBe('B');
    });

    it('should report both copilot and copilotChat extension presence', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension')
        .mockReturnValueOnce(mockExtension as any)
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

    it('should handle errors gracefully', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(() => {
        throw new Error('Test error');
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying');
    });
  });

  describe('getDisplayName', () => {
    it('should return correct display name', () => {
      expect(adapter.getDisplayName()).toBe('GitHub Copilot');
    });
  });

  describe('getTier', () => {
    it('should return tier B', () => {
      expect(adapter.getTier()).toBe('B');
    });
  });
});
