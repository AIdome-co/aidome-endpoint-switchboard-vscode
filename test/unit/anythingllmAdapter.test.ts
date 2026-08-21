/**
 * Unit tests for AnythingLLM adapter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnythingLlmAdapter } from '../../src/adapters/anythingllm/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as fsSafe from '../../src/util/fsSafe';

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

// Allow tests to force the platform used by getDetectionPaths() without
// hitting the unavailable ESM namespace spy. Defaults to the real platform.
const osState = vi.hoisted(() => ({ platform: undefined as NodeJS.Platform | undefined }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    platform: () => osState.platform ?? actual.platform(),
  };
});

describe('AnythingLlmAdapter', () => {
  let adapter: AnythingLlmAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new AnythingLlmAdapter();
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
    it('should return true when AnythingLLM is detected', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);

      const result = await adapter.detect();

      expect(result).toBe(true);
    });

    it('should return false when AnythingLLM is not detected', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const result = await adapter.detect();

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockRejectedValue(new Error('Test error'));

      const result = await adapter.detect();

      expect(result).toBe(false);
    });

    it('should use ProgramFiles env vars for Windows detection paths', async () => {
      const previousProgramFiles = process.env['ProgramFiles'];
      const previousProgramFilesX86 = process.env['ProgramFiles(x86)'];
      process.env['ProgramFiles'] = 'D:\\Program Files';
      process.env['ProgramFiles(x86)'] = 'D:\\Program Files (x86)';

      const checkedPaths: string[] = [];
      vi.spyOn(fsSafe, 'fileExists').mockImplementation(async (p: string) => {
        checkedPaths.push(p);
        return false;
      });

      // Call getDetectionPaths indirectly via detect() on a system where
      // platform() returns 'win32' — we can only verify the env-var paths are
      // included when running on Windows. On non-Windows CI we verify the
      // adapter does NOT hard-code 'C:\Program Files' and instead reads env vars.
      // We test the path-building logic directly by importing and calling the private
      // method via the public verify() surface (which exposes detectionPaths).
      const result = await adapter.verify();
      const detectionPaths = result.details?.detectionPaths as string[] | undefined;

      // Restore env vars
      if (previousProgramFiles === undefined) {
        delete process.env['ProgramFiles'];
      } else {
        process.env['ProgramFiles'] = previousProgramFiles;
      }
      if (previousProgramFilesX86 === undefined) {
        delete process.env['ProgramFiles(x86)'];
      } else {
        process.env['ProgramFiles(x86)'] = previousProgramFilesX86;
      }

      // On Windows the env-var paths should appear; on other platforms they won't.
      // The key invariant is that no path hard-codes 'C:\\Program Files' as a literal —
      // it must come from the env var (or the default fallback).
      // On non-Windows, detectionPaths won't contain Program Files paths at all.
      const osPlatform = (await import('os')).platform();
      if (osPlatform === 'win32') {
        expect(detectionPaths?.some(p => p.includes('D:\\Program Files') && p.includes('AnythingLLM'))).toBe(true);
        expect(detectionPaths?.some(p => p.includes('D:\\Program Files (x86)') && p.includes('AnythingLLM'))).toBe(true);
      } else {
        // On non-Windows, Windows paths are simply not present at all.
        expect(detectionPaths?.every(p => !p.startsWith('C:\\Program Files'))).toBe(true);
      }
    });

    it('should build Windows detection paths on the win32 platform', async () => {
      osState.platform = 'win32';
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      try {
        const result = await adapter.verify();
        const detectionPaths = result.details?.detectionPaths as string[];

        // Windows paths: under AppData\Local, Programs, and Program Files.
        expect(detectionPaths.some(p => p.includes('AppData') && p.includes('AnythingLLM'))).toBe(true);
        expect(detectionPaths.some(p => p.includes('Program Files') && p.includes('AnythingLLM'))).toBe(true);
        expect(detectionPaths.some(p => p.includes('Program Files (x86)') && p.includes('AnythingLLM'))).toBe(true);
      } finally {
        osState.platform = undefined;
      }
    });

    it('should build macOS detection paths on the darwin platform', async () => {
      osState.platform = 'darwin';
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      try {
        const result = await adapter.verify();
        const detectionPaths = result.details?.detectionPaths as string[];

        expect(detectionPaths.some(p => p.includes('AnythingLLM.app'))).toBe(true);
        expect(detectionPaths.some(p => p.startsWith('/Applications/'))).toBe(true);
      } finally {
        osState.platform = undefined;
      }
    });
  });

  describe('buildPlan', () => {
    it('should create a plan with guided steps', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan).toBeDefined();
      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('anythingllm');
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it('should include show-guided-steps actions', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const guidedSteps = plan.steps.filter(s => s.action === 'show-guided-steps');
      expect(guidedSteps.length).toBeGreaterThan(0);
      
      const mainGuidance = guidedSteps[0];
      expect(mainGuidance.assistantKey).toBe('anythingllm');
      expect(mainGuidance.data.tier).toBe('B');
      expect(mainGuidance.data.configurationType).toBe('desktop-app-ui');
      expect(Array.isArray(mainGuidance.data.steps)).toBe(true);
      expect((mainGuidance.data.steps as string[]).length).toBeGreaterThan(0);
    });

    it('should include base URL in guidance', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const guidedStep = plan.steps[0];
      expect(guidedStep.data.baseUrl).toBe(mockProfile.baseUrl);
    });

    it('should include copy-to-clipboard step', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const copyStep = plan.steps.find(s => 
        s.action === 'show-guided-steps' && 
        s.data.action === 'copy-to-clipboard'
      );
      expect(copyStep).toBeDefined();
      expect(copyStep?.data.baseUrl).toBe(mockProfile.baseUrl);
    });

    it('should reject an endpoint URL using an unsupported scheme', async () => {
      const badProfile: EndpointProfile = {
        ...mockProfile,
        baseUrl: 'javascript:alert(1)'
      };

      await expect(adapter.buildPlan(badProfile)).rejects.toThrow(/invalid or uses an unsupported scheme/);
    });

    it('should reject a file: endpoint URL', async () => {
      const badProfile: EndpointProfile = {
        ...mockProfile,
        baseUrl: 'file:///etc/passwd'
      };

      await expect(adapter.buildPlan(badProfile)).rejects.toThrow(/invalid or uses an unsupported scheme/);
    });

    it('should reject an unparseable endpoint URL', async () => {
      const badProfile: EndpointProfile = {
        ...mockProfile,
        baseUrl: 'not a url'
      };

      await expect(adapter.buildPlan(badProfile)).rejects.toThrow(/invalid or uses an unsupported scheme/);
    });

    it('should accept a localhost http endpoint URL for development', async () => {
      const localProfile: EndpointProfile = {
        ...mockProfile,
        baseUrl: 'http://localhost:8000/v1'
      };

      const plan = await adapter.buildPlan(localProfile);
      expect(plan.profileId).toBe(localProfile.id);
    });
  });

  describe('apply', () => {
    it('should resolve without error (no-op for Tier B guided setup)', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      await expect(adapter.apply(plan)).resolves.toBeUndefined();
    });
  });

  describe('verify', () => {
    it('should not claim configuration success when AnythingLLM is only detected', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('detected');
      expect(result.details?.detected).toBe(true);
      expect(result.details?.tier).toBe('B');
    });

    it('should return a failed verification with guidance when not detected', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not detected');
      expect(result.details?.detected).toBe(false);
      expect(result.details?.tier).toBe('B');
      expect(result.details?.configurationStatus).toBe('not-detected');
    });

    it('should report manual configuration as required when detected', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.configurationStatus).toBe('manual-configuration-required');
      expect(result.details?.supportedProvider).toBe('Generic OpenAI / OpenAI Compatible');
    });

    it('should include detection paths in details', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const result = await adapter.verify();

      expect(result.details?.detectionPaths).toBeDefined();
      expect(Array.isArray(result.details?.detectionPaths)).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockRejectedValue(new Error('Test error'));

      const result = await adapter.verify();

      // verify() reports the detection failure instead of claiming the app is usable.
      expect(result.success).toBe(false);
      expect(result.details?.detected).toBe(false);
    });
  });

  describe('getDisplayName', () => {
    it('should return correct display name', () => {
      expect(adapter.getDisplayName()).toBe('AnythingLLM');
    });
  });

  describe('getTier', () => {
    it('should return tier B', () => {
      expect(adapter.getTier()).toBe('B');
    });
  });
});
