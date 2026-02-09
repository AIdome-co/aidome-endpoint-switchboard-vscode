/**
 * Unit tests for Gemini CLI adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiCliAdapter } from '../../src/adapters/geminiCli/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as detectCLIs from '../../src/core/detection/detectCLIs';

vi.mock('../../src/core/detection/detectCLIs');
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    })
  }
}));

describe('GeminiCliAdapter', () => {
  let adapter: GeminiCliAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new GeminiCliAdapter();
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
    it('should return true when Gemini CLI is detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(detectCLIs.detectCli).toHaveBeenCalledWith('gemini');
    });

    it('should return false when CLI is not detected', async () => {
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
    it('should create a plan with guided steps only', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan).toBeDefined();
      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('gemini-cli');
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it('should include show-guided-steps actions', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const guidedSteps = plan.steps.filter(s => s.action === 'show-guided-steps');
      expect(guidedSteps.length).toBeGreaterThan(0);
      
      const mainGuidance = guidedSteps[0];
      expect(mainGuidance.assistantKey).toBe('gemini-cli');
      expect(mainGuidance.data.limitation).toBe('no-base-url-override');
      expect(mainGuidance.data.tier).toBe('C');
    });

    it('should include base URL in guidance', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const guidedStep = plan.steps[0];
      expect(guidedStep.data.baseUrl).toBe(mockProfile.baseUrl);
    });
  });

  describe('verify', () => {
    it('should return failure when CLI is not detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not installed');
    });

    it('should return success when CLI is detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('installed');
      expect(result.details?.tier).toBe('C');
      expect(result.details?.cli).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockRejectedValue(new Error('Test error'));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying');
    });
  });

  describe('getDisplayName', () => {
    it('should return correct display name', () => {
      expect(adapter.getDisplayName()).toBe('Gemini CLI');
    });
  });

  describe('getTier', () => {
    it('should return tier C', () => {
      expect(adapter.getTier()).toBe('C');
    });
  });
});
