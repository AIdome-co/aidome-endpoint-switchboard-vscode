/**
 * Unit tests for Codex adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexAdapter } from '../../src/adapters/codex/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as detectCLIs from '../../src/core/detection/detectCLIs';
import * as fsSafe from '../../src/util/fsSafe';

// Mock the modules
vi.mock('../../src/core/detection/detectCLIs');
vi.mock('../../src/util/fsSafe');
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    })
  }
}));

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new CodexAdapter();
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
    it('should return true when codex CLI is detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(detectCLIs.detectCli).toHaveBeenCalledWith('codex');
    });

    it('should return false when codex CLI is not detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const result = await adapter.detect();

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockRejectedValue(new Error('Test error'));

      const result = await adapter.detect();

      expect(result).toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('should create a plan with backup step when config exists', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan).toBeDefined();
      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('openai-codex');
      expect(plan.steps.length).toBeGreaterThan(0);
      
      // Should have backup step
      const backupStep = plan.steps.find(s => s.action === 'backup-file');
      expect(backupStep).toBeDefined();
      expect(backupStep?.assistantKey).toBe('openai-codex');
    });

    it('should create a plan without backup step when config does not exist', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan).toBeDefined();
      expect(plan.profileId).toBe(mockProfile.id);
      
      // Should not have backup step
      const backupStep = plan.steps.find(s => s.action === 'backup-file');
      expect(backupStep).toBeUndefined();
    });

    it('should include edit-config-file step', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      const editStep = plan.steps.find(s => s.action === 'edit-config-file');
      expect(editStep).toBeDefined();
      expect(editStep?.newValue).toBe(mockProfile.baseUrl);
      expect(editStep?.data.format).toBe('toml');
    });

    it('should include set-env-var step for fallback', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      const envStep = plan.steps.find(s => s.action === 'set-env-var');
      expect(envStep).toBeDefined();
      expect(envStep?.targetPath).toBe('OPENAI_BASE_URL');
      expect(envStep?.newValue).toBe(mockProfile.baseUrl);
    });

    it('should include verify-endpoint step', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      const verifyStep = plan.steps.find(s => s.action === 'verify-endpoint');
      expect(verifyStep).toBeDefined();
      expect(verifyStep?.assistantKey).toBe('openai-codex');
    });
  });

  describe('verify', () => {
    it('should return success when config file exists with provider config', async () => {
      const mockConfig = `
[providers.aidome]
base_url = "https://aidome.example.com/v1"
api_key = "test-key"
      `;
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(mockConfig);

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
    });

    it('should return failure when config file does not exist', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should return failure when config file exists but has no provider config', async () => {
      const mockConfig = `
[general]
some_setting = "value"
      `;
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(mockConfig);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not have provider base_url');
    });

    it('should handle errors gracefully', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockRejectedValue(new Error('Read error'));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying');
    });
  });

  describe('getDisplayName', () => {
    it('should return correct display name', () => {
      expect(adapter.getDisplayName()).toBe('OpenAI Codex (CLI / IDE)');
    });
  });

  describe('getTier', () => {
    it('should return tier A', () => {
      expect(adapter.getTier()).toBe('A');
    });
  });
});
