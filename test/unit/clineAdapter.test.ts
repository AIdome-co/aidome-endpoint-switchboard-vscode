/**
 * Unit tests for Cline adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClineAdapter } from '../../src/adapters/cline/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

const mockExtension = {
  packageJSON: {
    contributes: {
      configuration: {
        properties: {
          'cline.openAiBaseUrl': { type: 'string' },
          'cline.apiProvider': { type: 'string' },
          'cline.model': { type: 'string' }
        }
      }
    }
  }
};

const mockConfig = {
  get: vi.fn(),
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
      info: vi.fn(),
    })
  }
}));

describe('ClineAdapter', () => {
  let adapter: ClineAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new ClineAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      profileType: 'custom',
      baseUrl: 'https://aidome.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    vi.clearAllMocks();
    mockConfig.get.mockReturnValue(undefined);
  });

  describe('detect', () => {
    it('should return true when Cline is installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('saoudrizwan.claude-dev');
    });

    it('should return false when Cline is not installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

      const result = await adapter.detect();

      expect(result).toBe(false);
    });

    it('should return false when extension lookup throws', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(() => {
        throw new Error('extension lookup failed');
      });

      const result = await adapter.detect();

      expect(result).toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('should configure Cline using discovered setting keys', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('cline');
      expect(plan.steps.length).toBeGreaterThan(0);

      const baseUrlStep = plan.steps.find(step =>
        step.targetPath?.includes('openAiBaseUrl') || step.targetPath?.includes('baseUrl')
      );
      expect(baseUrlStep).toBeDefined();
      expect(baseUrlStep?.newValue).toBe(mockProfile.baseUrl);
    });

    it('should use fallback setting keys when extension is installed but exposes no configuration', async () => {
      const vscode = await import('vscode');
      const noConfigExtension = {
        packageJSON: {}
      };
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(noConfigExtension as never);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      // Extension found but no contributes.configuration → getFallbackKeys() is used, not guided mode
      const settingSteps = plan.steps.filter((s) => s.action === 'set-vscode-setting');
      expect(settingSteps.length).toBeGreaterThan(0);
      expect(plan.steps.some((s) => s.action === 'show-guided-steps')).toBe(false);
    });

    it('should use fallback setting keys when setting discovery throws', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(() => {
        throw new Error('metadata unavailable');
      });

      const plan = await adapter.buildPlan(mockProfile);

      const settingSteps = plan.steps.filter((s) => s.action === 'set-vscode-setting');
      expect(settingSteps.length).toBeGreaterThan(0);
      expect(plan.steps.some((s) => s.action === 'show-guided-steps')).toBe(false);
    });

    it('should fall back to default keys when extension is not found', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      // Extension not found → guided steps with steps array
      const guidedStep = plan.steps.find((s) => s.action === 'show-guided-steps');
      expect(guidedStep).toBeDefined();
      expect(Array.isArray(guidedStep?.data?.steps)).toBe(true);
      expect((guidedStep?.data?.steps as string[]).length).toBeGreaterThan(0);
    });

    it('should handle array configuration format', async () => {
      const vscode = await import('vscode');
      const arrayConfigExtension = {
        packageJSON: {
          contributes: {
            configuration: [
              {
                properties: {
                  'cline.openAiBaseUrl': { type: 'string' }
                }
              },
              {
                properties: {
                  'cline.apiProvider': { type: 'string' }
                }
              }
            ]
          }
        }
      };
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(arrayConfigExtension as never);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.steps.length).toBeGreaterThan(0);
    });
  });

  describe('verify', () => {
    it('should succeed when Cline base URL is configured', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);

      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'cline.openAiBaseUrl') {
          return 'https://aidome.example.com/v1';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
    });

    it('should fail when no Cline settings are configured', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);

      mockConfig.get.mockReturnValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
    });

    it('should fail gracefully when configuration access throws', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementationOnce(() => {
        throw new Error('configuration unavailable');
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error');
    });
  });

  describe('getDisplayName', () => {
    it('should return "Cline"', () => {
      expect(adapter.getDisplayName()).toBe('Cline');
    });
  });

  describe('getTier', () => {
    it('should return Tier A', () => {
      expect(adapter.getTier()).toBe('A');
    });
  });
});
