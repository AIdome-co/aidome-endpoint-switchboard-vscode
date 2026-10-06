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
  inspect: undefined as any,
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
    mockConfig.inspect = undefined;
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
      expect(proxyStep!.targetPath).toBe('github.copilot.advanced.debug.overrideProxyUrl');
      expect(proxyStep!.reversible).toBe(true);
      expect(proxyStep!.newValue).toBe(mockProfile.baseUrl);
    });

    it('should NOT normalize the proxy URL into an OpenAI /v1 base', async () => {
      const plan = await adapter.buildPlan({
        ...mockProfile,
        baseUrl: 'https://gateway.example.com/proxy'
      });

      const proxyStep = plan.steps.find((s) => s.data['method'] === 'proxy-override');
      expect(proxyStep!.newValue).toBe('https://gateway.example.com/proxy');
    });

    it('should preserve existing advanced object settings when writing the flat key', async () => {
      const existingAdvanced = { 'debug.overrideProxyUrl': 'https://old.example.com', 'someOtherKey': 'someValue' };
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced') {
          return existingAdvanced;
        }
        return undefined;
      });

      const plan = await adapter.buildPlan(mockProfile);

      const proxyStep = plan.steps.find((s) => s.data['method'] === 'proxy-override');
      // Flat style writes a separate top-level key; the object's keys are untouched.
      expect(proxyStep!.targetPath).toBe('github.copilot.advanced.debug.overrideProxyUrl');
      expect(proxyStep!.oldValue).toBeUndefined();
      expect(proxyStep!.newValue).toBe(mockProfile.baseUrl);
      // The unrelated object keys are never rewritten by the flat style.
      expect(mockConfig.get).not.toHaveBeenCalledWith('github.copilot.advanced');
    });

    it('lets the applier capture the old flat value for rollback at apply time', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      // The engine does not read VS Code state; applyVSCodeSetting records
      // the previous value into the applied step for rollback.
      const proxyStep = plan.steps.find((s) => s.data['method'] === 'proxy-override');
      expect(proxyStep).toBeDefined();
      expect(proxyStep!.oldValue).toBeUndefined();
      expect(proxyStep!.reversible).toBe(true);
    });

    it('should provide Custom Endpoint guidance when the legacy setting is unregistered', async () => {
      mockConfig.inspect = vi.fn().mockReturnValue(undefined);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].action).toBe('show-guided-steps');
      expect(plan.steps[0].data.configurationType).toBe('copilot-custom-endpoint-ui');
      expect(plan.steps[0].data.steps).toEqual(expect.arrayContaining([
        expect.stringContaining('Custom Endpoint')
      ]));
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

    it('should succeed with exact URL match after buildPlan (flat style)', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      await adapter.buildPlan(mockProfile);
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced.debug.overrideProxyUrl') {
          return mockProfile.baseUrl;
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('configured');
      expect(result.details?.proxyOverrideConfigured).toBe(true);
      expect(result.details?.exactUrlMatchVerified).toBe(true);
      expect(result.details?.tier).toBe('B');
    });

    it('should read the legacy object style as ONE flat subkey and match exactly', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      await adapter.buildPlan(mockProfile);
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced') {
          return { 'debug.overrideProxyUrl': mockProfile.baseUrl, 'someOtherKey': 'kept' };
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.exactUrlMatchVerified).toBe(true);
    });

    it('should fail when the configured proxy URL does not match the expected profile URL', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      await adapter.buildPlan(mockProfile);
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced.debug.overrideProxyUrl') {
          return 'https://stale.example.com/v1';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not match');
      expect(result.details?.exactUrlMatchVerified).toBe(false);
      expect(result.details?.expectedProxyUrl).toBe(mockProfile.baseUrl);
    });

    it('should not claim exact verification when no profile has been applied', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'github.copilot.advanced.debug.overrideProxyUrl') {
          return 'https://someone-elses.example.com';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.proxyOverrideConfigured).toBe(true);
      expect(result.details?.exactUrlMatchVerified).toBe(false);
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
      mockConfig.get.mockReturnValue(undefined);

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
