/**
 * Unit tests for Gemini CLI adapter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiCliAdapter } from '../../src/adapters/geminiCli/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as detectCLIs from '../../src/core/detection/detectCLIs';

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
  let originalGeminiBaseUrl: string | undefined;
  let originalVertexBaseUrl: string | undefined;

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
    originalGeminiBaseUrl = process.env['GOOGLE_GEMINI_BASE_URL'];
    originalVertexBaseUrl = process.env['GOOGLE_VERTEX_BASE_URL'];
    delete process.env['GOOGLE_GEMINI_BASE_URL'];
    delete process.env['GOOGLE_VERTEX_BASE_URL'];
  });

  afterEach(() => {
    if (originalGeminiBaseUrl === undefined) delete process.env['GOOGLE_GEMINI_BASE_URL'];
    else process.env['GOOGLE_GEMINI_BASE_URL'] = originalGeminiBaseUrl;
    if (originalVertexBaseUrl === undefined) delete process.env['GOOGLE_VERTEX_BASE_URL'];
    else process.env['GOOGLE_VERTEX_BASE_URL'] = originalVertexBaseUrl;
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
      expect(mainGuidance.data.limitation).toBe('environment-variable-configuration-required');
      expect(mainGuidance.data.tier).toBe('C');
      expect(Array.isArray(mainGuidance.data.steps)).toBe(true);
      expect((mainGuidance.data.steps as string[]).length).toBeGreaterThan(0);
      expect((mainGuidance.data.steps as string[]).join('\n')).toContain('GOOGLE_GEMINI_BASE_URL');
      expect((mainGuidance.data.steps as string[]).join('\n')).toContain('GOOGLE_VERTEX_BASE_URL');
    });

    it('should include base URL in guidance', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const guidedStep = plan.steps[0];
      expect(guidedStep.data.baseUrl).toBe(mockProfile.baseUrl);
    });

    it('should reject a base URL using a dangerous or unsupported scheme', async () => {
      const unsafeSchemes = [
        'javascript:alert(1)',
        'data:text/plain;base64,SGVsbG8=',
        'file:///etc/passwd',
        'ftp://example.com'
      ];

      for (const url of unsafeSchemes) {
        const unsafeProfile = { ...mockProfile, baseUrl: url };
        await expect(adapter.buildPlan(unsafeProfile)).rejects.toThrow(/invalid or uses an unsupported scheme/);
      }
    });

    it('should reject a plain http endpoint that is not localhost', async () => {
      const httpProfile = { ...mockProfile, baseUrl: 'http://gateway.example.com/v1' };
      await expect(adapter.buildPlan(httpProfile)).rejects.toThrow(/invalid or uses an unsupported scheme/);
    });
  });

  describe('verify', () => {
    it('should return failure when CLI is not detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not installed');
    });

    it('should require a gateway environment variable when CLI is only detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('installed');
      expect(result.details?.tier).toBe('C');
      expect(result.details?.cli).toBe(true);
      expect(result.details?.configurationStatus).toBe('manual-configuration-required');
      expect(result.details?.supportedEnvironmentVariables).toEqual([
        'GOOGLE_GEMINI_BASE_URL',
        'GOOGLE_VERTEX_BASE_URL'
      ]);
    });

    it('should verify a configured gateway environment variable without exposing its value', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      process.env['GOOGLE_GEMINI_BASE_URL'] = 'https://gateway.example.com/v1beta';

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configurationStatus).toBe('environment-variable-configured');
      expect(result.details?.configuredEnvironmentVariables).toEqual(['GOOGLE_GEMINI_BASE_URL']);
      expect(JSON.stringify(result.details)).not.toContain('gateway.example.com');
    });

    it('should verify a Vertex AI gateway environment variable without exposing its value', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      process.env['GOOGLE_VERTEX_BASE_URL'] = 'https://vertex.example.com/v1';

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configurationStatus).toBe('environment-variable-configured');
      expect(result.details?.configuredEnvironmentVariables).toEqual(['GOOGLE_VERTEX_BASE_URL']);
      expect(JSON.stringify(result.details)).not.toContain('vertex.example.com');
    });

    it('should report both supported environment variables when both are configured', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      process.env['GOOGLE_GEMINI_BASE_URL'] = 'https://gemini.example.com/v1beta';
      process.env['GOOGLE_VERTEX_BASE_URL'] = 'https://vertex.example.com/v1';

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configurationStatus).toBe('environment-variable-configured');
      expect(result.details?.configuredEnvironmentVariables).toEqual([
        'GOOGLE_GEMINI_BASE_URL',
        'GOOGLE_VERTEX_BASE_URL'
      ]);
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
