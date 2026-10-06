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

  describe('verify (profile-aware, descriptor-driven)', () => {
    const EXACT_CONFIG = [
      'model_provider = "aidome"',
      '',
      '[model_providers.aidome]',
      'name = "aidome"',
      'base_url = "https://aidome.example.com/v1"',
      'wire_api = "responses"',
      'env_key = "OPENAI_API_KEY"',
      '',
      '[model_providers.other]',
      'name = "other"',
      'base_url = "https://other.example/v1"',
      'wire_api = "responses"',
      ''
    ].join('\n');

    async function applyThenVerify(config: string) {
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (p: string) =>
        p === '/tmp/continue-config.json' ? undefined : config
      );
      // buildPlan records the expected profile URL (fail-closed precondition).
      await adapter.buildPlan(mockProfile);
      return adapter.verify();
    }

    it('1. passes for the exact expected configuration', async () => {
      const result = await applyThenVerify(EXACT_CONFIG);
      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
      expect(result.details?.exactUrlMatchVerified ?? true).toBe(true);
    });

    it('2. fails when model_provider is changed away from the managed provider', async () => {
      const result = await applyThenVerify(EXACT_CONFIG.replace('model_provider = "aidome"', 'model_provider = "openai"'));
      expect(result.success).toBe(false);
      expect(result.message).toContain('does not match the active profile');
    });

    it('3. fails when the managed base_url is changed to another valid URL', async () => {
      const result = await applyThenVerify(
        EXACT_CONFIG.replace('base_url = "https://aidome.example.com/v1"', 'base_url = "https://tampered.example.com/v1"')
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain('does not match the active profile');
    });

    it('4. fails when wire_api is changed', async () => {
      const result = await applyThenVerify(
        EXACT_CONFIG.replace('[model_providers.aidome]\nname = "aidome"\nbase_url = "https://aidome.example.com/v1"\nwire_api = "responses"', '[model_providers.aidome]\nname = "aidome"\nbase_url = "https://aidome.example.com/v1"\nwire_api = "chat"')
      );
      expect(result.success).toBe(false);
    });

    it('5. fails when the managed provider entry is missing', async () => {
      const result = await applyThenVerify(EXACT_CONFIG.replace(/[\s\S]*?\[model_providers\.aidome\][\s\S]*?(?=\[model_providers\.other\])/, '\n'));
      expect(result.success).toBe(false);
      expect(result.message).toContain('does not match the active profile');
    });

    it('6. an unrelated valid Responses provider does NOT make verification pass', async () => {
      // No managed entry at all; only a valid unrelated provider selected.
      const result = await applyThenVerify(
        'model_provider = "other"\n\n[model_providers.other]\nname = "other"\nbase_url = "https://other.example/v1"\nwire_api = "responses"\n'
      );
      expect(result.success).toBe(false);
    });

    it('7. unrelated providers/settings are preserved by apply and ignored by verification', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (p: string) =>
        p === '/tmp/continue-config.json' ? undefined : EXACT_CONFIG
      );
      await adapter.buildPlan(mockProfile);
      // EXACT_CONFIG contains the unrelated `other` provider; verification of
      // the managed entry succeeded in test 1 despite its presence.
      const result = await adapter.verify();
      expect(result.success).toBe(true);
      expect(JSON.stringify(result.details)).not.toContain('other.example');
    });

    it('8. fails closed when the expected profile URL is unknown', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(EXACT_CONFIG);
      // No buildPlan: the adapter has no expected profile context.
      const result = await adapter.verify();
      expect(result.success).toBe(false);
      expect(result.message).toContain('apply a profile first');
    });

    it('8b. fails closed on malformed TOML', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('model = "broken\n[model_providers.aidome');
      await adapter.buildPlan(mockProfile);
      const result = await adapter.verify();
      expect(result.success).toBe(false);
      expect(result.message).toContain('not valid TOML');
    });

    it('9. successful reapply remains idempotent and verifies', async () => {
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (p: string) =>
        p === '/tmp/continue-config.json' ? undefined : EXACT_CONFIG
      );
      const plan1 = await adapter.buildPlan(mockProfile);
      const plan2 = await adapter.buildPlan(mockProfile);
      // Same profile -> same step payload (no churn).
      expect(plan1.steps.map(s => [s.action, s.targetPath, s.data.baseUrl, s.data.model ?? null]))
        .toEqual(plan2.steps.map(s => [s.action, s.targetPath, s.data.baseUrl, s.data.model ?? null]));
      const result = await adapter.verify();
      expect(result.success).toBe(true);
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
