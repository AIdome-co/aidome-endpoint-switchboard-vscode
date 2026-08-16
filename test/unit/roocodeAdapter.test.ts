/**
 * Unit tests for Roo Code adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RooCodeAdapter } from '../../src/adapters/roocode/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

const mockExtension = {
  packageJSON: { version: '3.54.0' },
};

const { getExtension, getConfiguration } = vi.hoisted(() => ({
  getExtension: vi.fn(),
  getConfiguration: vi.fn(),
}));

vi.mock('vscode', () => ({
  extensions: {
    getExtension,
  },
  workspace: {
    getConfiguration,
  },
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

describe('RooCodeAdapter', () => {
  let adapter: RooCodeAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new RooCodeAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      profileType: 'custom',
      baseUrl: 'https://aidome.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.clearAllMocks();
    getExtension.mockReturnValue(undefined);
  });

  describe('detect', () => {
    it('returns true when the final Roo Code extension is installed', async () => {
      getExtension.mockReturnValue(mockExtension);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(getExtension).toHaveBeenCalledWith('RooVeterinaryInc.roo-cline');
    });

    it('returns false when Roo Code is not installed', async () => {
      const result = await adapter.detect();

      expect(result).toBe(false);
    });

    it('returns false when extension lookup throws', async () => {
      getExtension.mockImplementation(() => {
        throw new Error('extension lookup failed');
      });

      const result = await adapter.detect();

      expect(result).toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('provides OpenAI-compatible in-extension guidance without writing VS Code settings', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toEqual(['roo-code']);
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0]).toMatchObject({
        action: 'show-guided-steps',
        assistantKey: 'roo-code',
        reversible: false,
      });
      expect(plan.steps[0].targetPath).toBeUndefined();
      expect(plan.steps[0].data).toMatchObject({
        baseUrl: mockProfile.baseUrl,
        configurationType: 'in-extension-ui',
        limitation: 'roo-code-provider-profiles-use-private-secret-storage',
        tier: 'C',
      });
      expect(plan.steps[0].data.steps).toEqual(expect.arrayContaining([
        expect.stringContaining('OpenAI Compatible'),
        expect.stringContaining(mockProfile.baseUrl),
      ]));
      expect(getConfiguration).not.toHaveBeenCalled();
    });

    it('guides the native Responses provider with the base URL shape Roo Code uses', async () => {
      const plan = await adapter.buildPlan({
        ...mockProfile,
        baseUrl: 'https://aidome.example.com/api/v1',
        dialect: 'openai.responses',
      });

      const data = plan.steps[0].data;
      expect(data.baseUrl).toBe('https://aidome.example.com/api');
      expect(data.steps).toEqual(expect.arrayContaining([
        expect.stringContaining('Choose "OpenAI"'),
        expect.stringContaining('custom Base URL'),
      ]));
      expect(data.steps).not.toEqual(expect.arrayContaining([
        expect.stringContaining('/api/v1'),
      ]));
    });

    it('removes a root /v1 suffix for the native Responses provider', async () => {
      const plan = await adapter.buildPlan({
        ...mockProfile,
        dialect: 'openai.responses',
      });

      expect(plan.steps[0].data.baseUrl).toBe('https://aidome.example.com');
    });

    it('returns an accurate guided fallback for unsupported dialects', async () => {
      const plan = await adapter.buildPlan({
        ...mockProfile,
        dialect: 'anthropic.messages',
      });

      expect(plan.steps[0].action).toBe('show-guided-steps');
      expect(plan.steps[0].data).toMatchObject({
        limitation: 'unsupported-roo-code-dialect',
        requestedDialect: 'anthropic.messages',
        tier: 'C',
      });
      expect(plan.steps[0].data.baseUrl).toBeUndefined();
    });

    it('rejects a missing endpoint URL', async () => {
      await expect(adapter.buildPlan({
        ...mockProfile,
        baseUrl: '',
      })).rejects.toThrow('endpoint URL is invalid');
    });

    it('rejects unsafe endpoint URL schemes', async () => {
      await expect(adapter.buildPlan({
        ...mockProfile,
        baseUrl: 'javascript:alert(1)',
      })).rejects.toThrow('endpoint URL is invalid');
    });
  });

  describe('verify', () => {
    it('reports that an installed Roo Code endpoint needs manual verification', async () => {
      getExtension.mockReturnValue(mockExtension);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('verified manually');
      expect(result.details).toMatchObject({
        extension: true,
        tier: 'C',
        automated: false,
        configured: 'unknown',
        verification: 'manual-request-required',
      });
      expect(getConfiguration).not.toHaveBeenCalled();
    });

    it('reports a missing Roo Code installation', async () => {
      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Roo Code is not installed');
      expect(result.details).toEqual({ extension: false, tier: 'C' });
    });

    it('wraps verification lookup failures', async () => {
      getExtension.mockImplementation(() => {
        throw new Error('configuration unavailable');
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying Roo Code config');
    });
  });

  describe('apply and metadata', () => {
    it('does not mutate the guided plan during apply', async () => {
      const plan = await adapter.buildPlan(mockProfile);
      const originalStep = { ...plan.steps[0] };

      await expect(adapter.apply(plan)).resolves.toBeUndefined();

      expect(plan.steps[0]).toEqual(originalStep);
    });

    it('reports Tier C because endpoint switching is not automatable', () => {
      expect(adapter.getDisplayName()).toBe('Roo Code');
      expect(adapter.getTier()).toBe('C');
    });
  });
});
