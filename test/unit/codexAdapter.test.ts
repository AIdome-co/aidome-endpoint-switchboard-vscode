/**
 * Unit tests for Codex adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexAdapter } from '../../src/adapters/codex/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as detectCLIs from '../../src/core/detection/detectCLIs';
import * as fsSafe from '../../src/util/fsSafe';

const mockHttpRequest = vi.hoisted(() => vi.fn());

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn()
    }))
  },
  window: {
    showWarningMessage: vi.fn()
  }
}));

// Mock the modules
vi.mock('../../src/core/detection/detectCLIs');
vi.mock('../../src/util/fsSafe');
vi.mock('../../src/util/http', () => ({
  httpRequest: mockHttpRequest
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
    it('should create an edit step with backupRequired metadata and no duplicate backup step', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan).toBeDefined();
      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('openai-codex');
      expect(plan.steps.length).toBeGreaterThan(0);

      // The applier creates the backup automatically for edit-config-file;
      // the plan declares backupRequired instead of a duplicate mutation.
      const backupStep = plan.steps.find(s => s.action === 'backup-file');
      expect(backupStep).toBeUndefined();
      const editStep = plan.steps.find(s => s.action === 'edit-config-file');
      expect(editStep).toBeDefined();
      expect(editStep?.data.backupRequired).toBe(true);
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

    it('should include guided process authentication instructions', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      const guidedStep = plan.steps.find(s => s.action === 'show-guided-steps');
      expect(guidedStep).toBeDefined();
      expect(guidedStep?.data.envVarName).toBe('OPENAI_API_KEY');
      expect(guidedStep?.data.steps).toEqual(expect.arrayContaining([
        expect.stringContaining('OPENAI_API_KEY')
      ]));
    });

    it('should include verify-endpoint step', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      const verifyStep = plan.steps.find(s => s.action === 'verify-endpoint');
      expect(verifyStep).toBeDefined();
      expect(verifyStep?.assistantKey).toBe('openai-codex');
    });

    it('should use a discovered gateway model while keeping the token out of the plan', async () => {
      mockHttpRequest.mockResolvedValue({
        status: 200,
        statusText: 'OK',
        headers: {},
        body: { data: [{ id: 'anthropic/claude-haiku-4-5-20251001' }] }
      });
      const getSecret = vi.fn().mockResolvedValue('profile-secret');
      const discoveredAdapter = new CodexAdapter({ profileSecrets: { getSecret } });
      const profile = { ...mockProfile, authRef: 'test-profile', baseUrl: 'https://aidome.example.com' };

      const plan = await discoveredAdapter.buildPlan(profile);
      const editStep = plan.steps.find(step => step.action === 'edit-config-file');

      expect(editStep?.data.baseUrl).toBe('https://aidome.example.com/v1');
      expect(editStep?.data.model).toBe('anthropic/claude-haiku-4-5-20251001');
      expect(JSON.stringify(plan)).not.toContain('profile-secret');
      expect(mockHttpRequest).toHaveBeenCalledWith(
        'https://aidome.example.com/v1/models',
        expect.objectContaining({ headers: { Authorization: 'Bearer profile-secret' } })
      );
    });
  });

  describe('verify', () => {
    it('should return success when config file exists with provider config', async () => {
      const mockConfig = `
model_provider = "aidome"

[model_providers.aidome]
base_url = "https://aidome.example.com/v1"
wire_api = "responses"
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
      expect(result.message).toContain('valid selected Responses provider');
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
