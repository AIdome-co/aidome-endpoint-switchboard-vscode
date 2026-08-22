/**
 * Unit tests for CodeGPT adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodeGptAdapter } from '../../src/adapters/codegpt/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

// Mock vscode module
const mockExtension = {
  packageJSON: {
    contributes: {
      configuration: { properties: {} }
    }
  }
};

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn()
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn() }))
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

// Mock the storage module so adapter tests don't hit a real ~/.codegpt DB.
vi.mock('../../src/adapters/codegpt/codegptStorage', () => ({
  writeCodeGptConnection: vi.fn(async () => '/tmp/backup'),
  writeCodeGptLocalFlavor: vi.fn(async () => true),
  readCodeGptConnection: vi.fn(),
  resolveCodeGptHome: vi.fn(() => '/home/test/.codegpt'),
  normalizeStorageBaseUrl: vi.fn((b: string) => b.replace(/\/v1$/, '').replace(/\/+$/, '')),
}));

import {
  readCodeGptConnection,
  normalizeStorageBaseUrl as mockNormalize,
} from '../../src/adapters/codegpt/codegptStorage';

const mockReadConnection = vi.mocked(readCodeGptConnection);

describe('CodeGptAdapter', () => {
  let adapter: CodeGptAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new CodeGptAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      baseUrl: 'http://80.240.29.183:8100/v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
    mockReadConnection.mockResolvedValue(undefined);
  });

  describe('detect', () => {
    it('should return true when CodeGPT extension is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('CodeGPT.codegpt');
    });

    it('should return false when extension is not detected', async () => {
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
    it('emits a single write-assistant-storage step with the normalized base URL and authRef', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('codegpt');
      expect(plan.steps).toHaveLength(1);

      const step = plan.steps[0];
      expect(step.action).toBe('write-assistant-storage');
      expect(step.assistantKey).toBe('codegpt');
      expect(step.data.baseUrl).toBe('http://80.240.29.183:8100');
      expect(step.data.authRef).toBeUndefined();
      expect(mockNormalize).toHaveBeenCalledWith('http://80.240.29.183:8100/v1');
    });

    it('passes the authRef through when set', async () => {
      const profile = { ...mockProfile, authRef: 'my-profile-name' };
      const plan = await adapter.buildPlan(profile);
      expect(plan.steps[0].data.authRef).toBe('my-profile-name');
    });
  });

  describe('verify', () => {
    it('should return failure when extension is not installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not installed');
    });

    it('should return failure when CodeGPT storage has no configured local provider', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      mockReadConnection.mockResolvedValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not configured');
      expect(result.details?.tier).toBe('B');
    });

    it('should return success when a valid base URL is stored in CodeGPT storage', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      mockReadConnection.mockResolvedValue({
        customLink: 'http://80.240.29.183:8100',
        apikey: 'some-key',
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.apiKeyConfigured).toBe(true);
      expect(result.details?.configurationStatus).toBe('endpoint-configured');
    });

    it('should return failure when the stored base URL is not a valid URL', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      mockReadConnection.mockResolvedValue({
        customLink: 'file:///etc/passwd',
        apikey: undefined,
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.configurationStatus).toBe('invalid-storage-value');
    });
  });

  describe('getDisplayName', () => {
    it('should return correct display name', () => {
      expect(adapter.getDisplayName()).toBe('CodeGPT');
    });
  });

  describe('getTier', () => {
    it('should return tier B', () => {
      expect(adapter.getTier()).toBe('B');
    });
  });
});
