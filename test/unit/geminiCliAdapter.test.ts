/**
 * Unit tests for Gemini CLI adapter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiCliAdapter } from '../../src/adapters/geminiCli/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as detectCLIs from '../../src/core/detection/detectCLIs';
import * as fsSafe from '../../src/util/fsSafe';

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
    // Isolate verification's ~/.gemini file lookups: default to no files.
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
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

    it('guides instead of throwing for a plain http endpoint that is not localhost', async () => {
      const httpProfile = { ...mockProfile, baseUrl: 'http://gateway.example.com/v1' };
      const plan = await adapter.buildPlan(httpProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].action).toBe('show-guided-steps');
      expect(plan.steps[0].data).toMatchObject({
        limitation: 'gemini-cli-requires-https-base-url',
        baseUrl: 'http://gateway.example.com/v1'
      });
    });

    it('still rejects unsafe schemes outright', async () => {
      await expect(adapter.buildPlan({ ...mockProfile, baseUrl: 'javascript:alert(1)' }))
        .rejects.toThrow(/invalid or uses an unsupported scheme/);
      await expect(adapter.buildPlan({ ...mockProfile, baseUrl: 'file:///etc/passwd' }))
        .rejects.toThrow(/invalid or uses an unsupported scheme/);
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

    it('should handle errors gracefully', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockRejectedValue(new Error('Test error'));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying');
    });

  it('counts a base-URL variable persisted in the Gemini CLI .env file', async () => {
    vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
    vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('.env')) {
        return 'GOOGLE_GEMINI_BASE_URL=https://gateway.example.com\n';
      }
      return undefined;
    });

    const result = await adapter.verify();

    expect(result.success).toBe(true);
    expect(result.details?.configuredEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
    expect(JSON.stringify(result)).not.toContain('https://gateway.example.com');
  });

  it('does not treat a settings.json env object as a configuration surface', async () => {
    // The official settings schema (additionalProperties: false) has no
    // top-level env property, so settings.json cannot define variables.
    vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
    vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('settings.json')) {
        return JSON.stringify({ env: { GOOGLE_VERTEX_BASE_URL: 'https://gateway.example.com' } });
      }
      return undefined;
    });

    const result = await adapter.verify();

    expect(result.success).toBe(false);
    expect(result.details?.configurationStatus).toBe('manual-configuration-required');
  });

  it('treats an invalid base-URL value as not configured', async () => {
    vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
    vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('.env')) {
        return 'GOOGLE_GEMINI_BASE_URL=http://remote-host\n';
      }
      return undefined;
    });

    const result = await adapter.verify();

    expect(result.success).toBe(false);
    expect(result.details?.invalidEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
    expect(JSON.stringify(result)).not.toContain('http://remote-host');
  });

  it('rejects non-HTTP schemes even on loopback hosts', async () => {
    vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
    vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('.env')) {
        return 'GOOGLE_GEMINI_BASE_URL=ftp://localhost/v1\n';
      }
      return undefined;
    });

    const result = await adapter.verify();

    expect(result.success).toBe(false);
    expect(result.details?.invalidEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
  });

  it('parses single-quoted dotenv values like the CLI does', async () => {
    vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
    vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('.env')) {
        return "GOOGLE_GEMINI_BASE_URL='https://gateway.example.com'\n";
      }
      return undefined;
    });

    const result = await adapter.verify();

    expect(result.success).toBe(true);
    expect(result.details?.configuredEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
    expect(JSON.stringify(result)).not.toContain('gateway.example.com');
  });  });

  it('resolves the .env file under GEMINI_CLI_HOME/.gemini', async () => {
    vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
    const original = process.env['GEMINI_CLI_HOME'];
    process.env['GEMINI_CLI_HOME'] = '/alt/gemini-home';
    try {
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === '/alt/gemini-home/.gemini/.env') {
          return 'GOOGLE_VERTEX_BASE_URL="https://gateway.example.com"\n';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configuredEnvironmentVariables).toContain('GOOGLE_VERTEX_BASE_URL');
      expect(result.details?.fileBasedEnvironmentVariables).toContain('GOOGLE_VERTEX_BASE_URL');
      expect(result.details?.configurationStatus).toBe('base-url-configured-unverified-source');
    } finally {
      if (original === undefined) delete process.env['GEMINI_CLI_HOME'];
      else process.env['GEMINI_CLI_HOME'] = original;
    }
  });

  it('does not count a malformed settings.json as configuration', async () => {
    vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
    vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('settings.json')) {
        return '{ not json';
      }
      return undefined;
    });

    const result = await adapter.verify();

    expect(result.success).toBe(false);
    expect(result.details?.configurationStatus).toBe('manual-configuration-required');
  });

  it('ignores a malformed settings.json instead of failing verification', async () => {
    vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
    vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('settings.json')) {
        return '{ not json';
      }
      return undefined;
    });

    const result = await adapter.verify();

    expect(result.success).toBe(false);
    expect(result.details?.configurationStatus).toBe('manual-configuration-required');
  });  });

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
