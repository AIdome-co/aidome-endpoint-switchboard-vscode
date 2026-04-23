/**
 * Unit tests for Roo Code adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RooCodeAdapter } from '../../src/adapters/roocode/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

const mockExtension = {
  packageJSON: {}
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

describe('RooCodeAdapter', () => {
  let adapter: RooCodeAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new RooCodeAdapter();
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
    it('should return true when Roo Code is installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('RooVeterinaryInc.roo-cline');
    });

    it('should return false when Roo Code is not installed', async () => {
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
    it('should configure Roo Code to use the OpenAI-compatible gateway settings', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('roo-code');
      expect(plan.steps).toHaveLength(2);

      const baseUrlStep = plan.steps.find(step => step.targetPath === 'roo-cline.openAiBaseUrl');
      expect(baseUrlStep).toBeDefined();
      expect(baseUrlStep?.newValue).toBe(mockProfile.baseUrl);
      expect(baseUrlStep?.data.settingKey).toBe('roo-cline.openAiBaseUrl');

      const providerStep = plan.steps.find(step => step.targetPath === 'roo-cline.apiProvider');
      expect(providerStep).toBeDefined();
      expect(providerStep?.newValue).toBe('openai');
      expect(providerStep?.data.value).toBe('openai');
    });
  });

  describe('verify', () => {
    it('should succeed when openAiBaseUrl is configured', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'roo-cline.openAiBaseUrl') {
          return 'https://aidome.example.com/v1';
        }
        if (key === 'roo-cline.apiProvider') {
          return 'openai';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
      expect(result.details?.baseUrl).toBe('https://aidome.example.com/v1');
      expect(result.details?.apiProvider).toBe('openai');
      expect(result.details?.configured).toBe(true);
    });

    it('should fail when openAiBaseUrl is missing', async () => {
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'roo-cline.apiProvider') {
          return 'openai';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('openAiBaseUrl');
      expect(result.details?.apiProvider).toBe('openai');
    });

    it('should fail gracefully when configuration access throws', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementationOnce(() => {
        throw new Error('configuration unavailable');
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying Roo Code config');
    });
  });

  describe('apply', () => {
    it('should resolve without mutating the plan', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      await expect(adapter.apply(plan)).resolves.toBeUndefined();
    });
  });

  describe('getDisplayName', () => {
    it('should return the Roo Code display name', () => {
      expect(adapter.getDisplayName()).toBe('Roo Code');
    });
  });

  describe('getTier', () => {
    it('should return tier A', () => {
      expect(adapter.getTier()).toBe('A');
    });
  });
});