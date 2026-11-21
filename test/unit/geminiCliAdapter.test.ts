/**
 * Unit tests for Gemini CLI adapter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiCliAdapter } from '../../src/adapters/geminiCli/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as detectCLIs from '../../src/core/detection/detectCLIs';
import * as fsSafe from '../../src/util/fsSafe';
import * as os from 'node:os';
import * as nodePath from 'node:path';

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
      profileType: 'custom',
      dialect: 'google.gemini.generate_content',
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
        baseUrl: 'http://gateway.example.com/v1',
        configurationStatus: 'unsupported'
      });
    });

    it('classifies non-loopback plain-http endpoints as unsupported in eligibility (Codex round 5, PR 118)', () => {
      const httpProfile = { ...mockProfile, baseUrl: 'http://gateway.example.com/v1' } as EndpointProfile;
      expect(adapter.getGuidedSetupStatus(httpProfile)).toBe('unsupported');
    });

    it('keeps loopback plain-http and HTTPS endpoints actionable in eligibility', () => {
      const loopbackProfile = { ...mockProfile, baseUrl: 'http://127.0.0.1:8080/v1' } as EndpointProfile;
      const localhostProfile = { ...mockProfile, baseUrl: 'http://localhost:8080/v1' } as EndpointProfile;
      const httpsProfile = { ...mockProfile, baseUrl: 'https://gateway.example.com/v1' } as EndpointProfile;

      expect(adapter.getGuidedSetupStatus(loopbackProfile)).toBe('actionable');
      expect(adapter.getGuidedSetupStatus(localhostProfile)).toBe('actionable');
      expect(adapter.getGuidedSetupStatus(httpsProfile)).toBe('actionable');
    });

    it('classifies unparseable base URLs as unsupported in eligibility (Codex round 5, PR 118)', () => {
      const invalidProfile = { ...mockProfile, baseUrl: 'not a url' } as EndpointProfile;
      expect(adapter.getGuidedSetupStatus(invalidProfile)).toBe('unsupported');
    });

    it('still rejects unsafe schemes outright', async () => {
      await expect(adapter.buildPlan({ ...mockProfile, baseUrl: 'javascript:alert(1)' }))
        .rejects.toThrow(/invalid or uses an unsupported scheme/);
      await expect(adapter.buildPlan({ ...mockProfile, baseUrl: 'file:///etc/passwd' }))
        .rejects.toThrow(/invalid or uses an unsupported scheme/);
    });

    it('classifies incompatible-dialect profiles as unsupported', async () => {
      const openaiProfile = { ...mockProfile, dialect: 'openai.chat_completions' } as EndpointProfile;

      const plan = await adapter.buildPlan(openaiProfile);

      const guidedStep = plan.steps[0];
      expect(guidedStep.action).toBe('show-guided-steps');
      expect(guidedStep.data.configurationStatus).toBe('unsupported');
      expect(guidedStep.data.limitation).toBe('unsupported-gemini-cli-dialect');
      expect(guidedStep.data.requestedDialect).toBe('openai.chat_completions');
      expect(String(guidedStep.data.message)).toContain('openai.chat_completions');
    });
  });

  describe('getGuidedSetupStatus', () => {
    it('is actionable for the declared Gemini dialect and dialect-agnostic callers', () => {
      expect(adapter.getGuidedSetupStatus()).toBe('actionable');
      expect(adapter.getGuidedSetupStatus(mockProfile)).toBe('actionable');
    });

    it('is unsupported for profile dialects the descriptor does not declare', () => {
      const openaiProfile = { ...mockProfile, dialect: 'openai.chat_completions' } as EndpointProfile;
      const anthropicProfile = { ...mockProfile, dialect: 'anthropic.messages' } as EndpointProfile;

      expect(adapter.getGuidedSetupStatus(openaiProfile)).toBe('unsupported');
      expect(adapter.getGuidedSetupStatus(anthropicProfile)).toBe('unsupported');
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
      // GOOGLE_GEMINI_BASE_URL applies only under Gemini API-key auth, so
      // full "configured" classification requires auth-mode evidence.
      process.env['GEMINI_API_KEY'] = 'pat-token';

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configurationStatus).toBe('environment-variable-configured');
      expect(result.details?.configuredEnvironmentVariables).toEqual(['GOOGLE_GEMINI_BASE_URL']);
      expect(JSON.stringify(result.details)).not.toContain('gateway.example.com');
      delete process.env['GEMINI_API_KEY'];
    });

    it('classifies a base-URL variable without matching auth evidence as unverified', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      process.env['GOOGLE_GEMINI_BASE_URL'] = 'https://gateway.example.com/v1beta';

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configurationStatus).toBe('base-url-configured-unverified-source');
      expect(result.details?.fileBasedEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
    });

    it('treats an explicitly empty inherited variable as an override that blocks the file value', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      process.env['GOOGLE_GEMINI_BASE_URL'] = '';
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.env')) {
          return 'GOOGLE_GEMINI_BASE_URL=https://gateway.example.com\n';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.invalidEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
      expect(result.details?.configurationStatus).toBe('manual-configuration-required');
    });

    it('strips unquoted inline comments from dotenv values', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.env')) {
          return 'GOOGLE_GEMINI_BASE_URL=https://gateway.example.com # corporate proxy\n';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configuredEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
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
      expect(result.details?.fileBasedEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
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
    });

    it('resolves the .env file under GEMINI_CLI_HOME/.gemini', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      const original = process.env['GEMINI_CLI_HOME'];
      // Mirror the adapter: it resolves GEMINI_CLI_HOME before joining.
      const overrideHome = nodePath.resolve('/alt/gemini-home');
      process.env['GEMINI_CLI_HOME'] = '/alt/gemini-home';
      try {
        const expectedPath = nodePath.join(overrideHome, '.gemini', '.env');
        vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
          if (filePath === expectedPath) {
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

    it('falls back to the ordinary home .env when the Gemini-specific one is absent', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      const realHome = os.homedir();
      const geminiEnvPath = nodePath.join(realHome, '.gemini', '.env');
      const homeEnvPath = nodePath.join(realHome, '.env');
      const readPaths: string[] = [];
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        readPaths.push(filePath);
        if (filePath === homeEnvPath) {
          return 'GOOGLE_GEMINI_BASE_URL="https://gateway.example.com"\n';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configuredEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
      // The Gemini-specific file must be consulted BEFORE the home .env.
      expect(readPaths.filter(p => p.endsWith('.env'))).toEqual([
        geminiEnvPath,
        homeEnvPath
      ]);
    });

    it('ignores a malformed user-level .env file instead of failing verification', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.env')) {
          return 'this is not valid dotenv syntax at all';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.configurationStatus).toBe('manual-configuration-required');
    });

    it('honors the last duplicate assignment of the same key in a .env file', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.env')) {
          return 'GOOGLE_GEMINI_BASE_URL=https://first.example.com\nGOOGLE_GEMINI_BASE_URL=http://second.example.com\n';
        }
        return undefined;
      });

      const result = await adapter.verify();

      // dotenv.parse assigns on every match, so the LAST value is effective.
      expect(result.success).toBe(false);
      expect(result.details?.invalidEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
      expect(JSON.stringify(result)).not.toContain('first.example.com');
    });

    it('does not fall back to the home .env when the Gemini .env exists but is unreadable', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      const realHome = os.homedir();
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
      vi.spyOn(fsSafe, 'fileExists').mockImplementation(async (filePath: string) => {
        // The Gemini-specific file exists on disk but the read failed.
        return filePath === nodePath.join(realHome, '.gemini', '.env');
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.configurationStatus).toBe('manual-configuration-required');
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
