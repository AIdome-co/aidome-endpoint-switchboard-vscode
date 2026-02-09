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

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn()
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
      baseUrl: 'https://aidome.example.com/v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
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
    it('should create a plan with guided steps only', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan).toBeDefined();
      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('github-copilot');
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it('should include show-guided-steps actions', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const guidedSteps = plan.steps.filter(s => s.action === 'show-guided-steps');
      expect(guidedSteps.length).toBeGreaterThan(0);
      
      const mainGuidance = guidedSteps[0];
      expect(mainGuidance.assistantKey).toBe('github-copilot');
      expect(mainGuidance.data.limitation).toBe('proprietary-service-no-override');
      expect(mainGuidance.data.tier).toBe('C');
    });

    it('should include base URL in guidance', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const guidedStep = plan.steps[0];
      expect(guidedStep.data.baseUrl).toBe(mockProfile.baseUrl);
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

    it('should return success when Copilot extension is installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension')
        .mockReturnValueOnce(mockExtension as any)
        .mockReturnValueOnce(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('installed');
      expect(result.details?.copilot).toBe(true);
      expect(result.details?.tier).toBe('C');
    });

    it('should return success when Copilot Chat extension is installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension')
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(mockExtension as any);

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('installed');
      expect(result.details?.copilotChat).toBe(true);
      expect(result.details?.tier).toBe('C');
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
    it('should return tier C', () => {
      expect(adapter.getTier()).toBe('C');
    });
  });
});
