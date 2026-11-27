/**
 * Unit tests for the OpenCode adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenCodeAdapter } from '../../src/adapters/opencode/adapter';
import { normalizeOpenAiBaseUrl } from '../../src/core/providerConfig/endpointUrl';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as detectCLIs from '../../src/core/detection/detectCLIs';
import * as fsSafe from '../../src/util/fsSafe';
import * as modelDiscovery from '../../src/core/providerConfig/modelDiscovery';

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn()
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
      update: vi.fn()
    }))
  },
  ConfigurationTarget: {
    Global: 1
  }
}));

vi.mock('../../src/core/detection/detectCLIs');
vi.mock('../../src/util/fsSafe');
vi.mock('../../src/util/paths', () => ({
  expandTilde: (path: string) => path.replace('~', '/home/user'),
  getConfigDir: (appName: string) => `/home/user/.${appName.toLowerCase()}`
}));
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    })
  }
}));

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    delete process.env.OPENCODE_CONFIG_PATH;
    delete process.env.OPENCODE_CONFIG;
    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.SNAP_USER_COMMON;
    adapter = new OpenCodeAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      profileType: 'aidome',
      dialect: 'openai.chat_completions',
      baseUrl: 'https://aidome.example.com/v1',
      authRef: 'test-profile',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
    vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
    vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);
    vi.spyOn(modelDiscovery, 'getCachedOpenAiModels').mockReturnValue([]);
    vi.spyOn(modelDiscovery, 'discoverOpenAiModels').mockResolvedValue([]);
  });

  describe('detect', () => {
    it('should return true when the CLI is detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      expect(await adapter.detect()).toBe(true);
      expect(detectCLIs.detectCli).toHaveBeenCalledWith('opencode');
    });

    it('should return true when only the config file exists', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);

      expect(await adapter.detect()).toBe(true);
    });

    it('should return false when neither CLI nor config file is present', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);
      expect(await adapter.detect()).toBe(false);
    });

    it('should return false on error', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockRejectedValue(new Error('Test error'));
      expect(await adapter.detect()).toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('creates a plan with a typed json-object driver step and no embedded content', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('opencode');
      expect(plan.steps.find(s => s.action === 'backup-file')).toBeUndefined();

      const editStep = plan.steps.find(s => s.action === 'edit-config-file');
      expect(editStep?.targetPath).toBe('/home/user/.config/opencode/opencode.json');
      expect(editStep?.reversible).toBe(true);
      expect(editStep?.data.driver).toBe('json-object');
      expect(editStep?.data.format).toBe('json');
      expect(editStep?.data.backupRequired).toBe(true);
      expect(editStep?.data.secretPolicy).toBe('target-persisted-at-apply');
      expect(editStep?.newValue).toBe(normalizeOpenAiBaseUrl(mockProfile.baseUrl));
    });

    it('targets the managed provider options paths and never embeds a secret', async () => {
      const plan = await adapter.buildPlan(mockProfile);
      const editStep = plan.steps.find(s => s.action === 'edit-config-file');

      expect(editStep?.data.patches).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['provider', 'aidome', 'npm'], value: '@ai-sdk/openai-compatible' }),
        expect.objectContaining({ path: ['provider', 'aidome', 'name'], value: 'AIdome Gateway' }),
        expect.objectContaining({ path: ['provider', 'aidome', 'options', 'baseURL'], source: 'baseUrl' }),
        expect.objectContaining({ path: ['provider', 'aidome', 'options', 'apiKey'], source: 'secret', removeWhenMissing: true })
      ]));

      const serialized = JSON.stringify(plan);
      expect(serialized.includes('aid_pat_')).toBe(false);
    });

    it('replaces the managed models map with every discovered model', async () => {
      vi.spyOn(modelDiscovery, 'getCachedOpenAiModels').mockReturnValue([
        { id: 'model-a' } as never,
        { id: 'model-b' } as never
      ]);

      const plan = await adapter.buildPlan(mockProfile);
      const editStep = plan.steps.find(s => s.action === 'edit-config-file');

      expect(editStep?.data.patches).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: ['provider', 'aidome', 'models'],
          value: { 'model-a': {}, 'model-b': {} }
        })
      ]));
      // Authoritative reconcile: no mergeObject, so stale models from a
      // previously applied endpoint cannot survive the switch.
      expect(editStep?.data.patches.find((p: { path: string[] }) => p.path.at(-1) === 'models').mergeObject).toBeUndefined();
    });

    it('writes no models patch when discovery returns nothing (empty probe never rewrites)', async () => {
      const plan = await adapter.buildPlan(mockProfile);
      const editStep = plan.steps.find(s => s.action === 'edit-config-file');

      expect(editStep?.data.patches.find((p: { path: string[] }) => p.path.at(-1) === 'models')).toBeUndefined();
    });

    it('uses the jsonc format for .jsonc config targets', async () => {
      process.env.OPENCODE_CONFIG_PATH = '/home/user/.config/opencode/opencode.jsonc';

      const plan = await adapter.buildPlan(mockProfile);
      const editStep = plan.steps.find(s => s.action === 'edit-config-file');

      expect(editStep?.data.format).toBe('jsonc');
    });

    it('clears the managed key with guidance when no secret is saved', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const editStep = plan.steps.find(s => s.action === 'edit-config-file');
      expect(editStep?.data.clearAuthWhenMissing).toBe(true);
      expect(editStep?.data.authRef).toBe(mockProfile.authRef);
      expect(editStep?.data.missingSecretMessage).toContain('Test Profile');

      const guidedStep = plan.steps.find(s => s.action === 'show-guided-steps');
      expect(guidedStep?.data.tier).toBe('A');
      expect(guidedStep?.data.optional).toBe(true);
      expect((guidedStep?.data.steps as string[])[0]).toContain('/home/user/.config/opencode/opencode.json');
    });

    it('writes no apiKey patch and keeps guidance credential-free for an intentionally unauthenticated profile', async () => {
      const unauthenticated = { ...mockProfile, authRef: undefined } as typeof mockProfile;

      const plan = await adapter.buildPlan(unauthenticated);
      const editStep = plan.steps.find(s => s.action === 'edit-config-file') as unknown as {
        data: { patches: Array<{ path: string[] }>; clearAuthWhenMissing?: boolean; missingSecretMessage?: string }
      };

      expect(editStep.data.patches.find((p: { path: string[] }) => p.path.at(-1) === 'apiKey')).toBeUndefined();
      expect(editStep.data.clearAuthWhenMissing).toBeUndefined();
      expect(editStep.data.missingSecretMessage).toBeUndefined();

      const guidedStep = plan.steps.find(s => s.action === 'show-guided-steps');
      expect((guidedStep?.data.steps as string[]).join(' ')).toContain('no saved credential');
    });

    it('includes a verify-endpoint step', async () => {
      const plan = await adapter.buildPlan(mockProfile);
      const verifyStep = plan.steps.find(s => s.action === 'verify-endpoint');
      expect(verifyStep?.assistantKey).toBe('opencode');
    });

    it('rejects invalid endpoint URLs before planning', async () => {
      await expect(adapter.buildPlan({ ...mockProfile, baseUrl: 'javascript:alert(1)' } as EndpointProfile))
        .rejects.toThrow(/Invalid OpenCode endpoint URL/);
    });
  });

  describe('apply', () => {
    it('leaves execution to the shared plan applier', async () => {
      const plan = await adapter.buildPlan(mockProfile);
      await expect(adapter.apply(plan)).resolves.toBeUndefined();
      expect(fsSafe.createBackup).not.toHaveBeenCalled();
      expect(fsSafe.writeFileAtomic).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    const managedConfig = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      provider: {
        aidome: {
          npm: '@ai-sdk/openai-compatible',
          name: 'AIdome Gateway',
          options: {
            baseURL: normalizeOpenAiBaseUrl('https://aidome.example.com/v1'),
            apiKey: 'aid_pat_TEST'
          },
          models: { 'test-model': {} }
        }
      }
    });

    it('returns success for an exact managed provider match', async () => {
      const plan = await adapter.buildPlan(mockProfile);
      void plan;
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(managedConfig);

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
      expect(result.details?.baseUrlConfigured).toBe(true);
      expect(result.details?.apiKeyConfigured).toBe(true);
      expect(result.details?.exactUrlMatchVerified).toBe(true);
    });

    it('fails closed when no profile was planned (unknown expected URL)', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(managedConfig);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('expected AIdome profile URL is unknown');
    });

    it('rejects a config pointing at a different endpoint', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        provider: {
          aidome: { options: { baseURL: 'https://other.example.com/v1', apiKey: 'aid_pat_TEST' } }
        }
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('different endpoint');
    });

    it('fails when the managed API key is missing', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        provider: { aidome: { options: { baseURL: normalizeOpenAiBaseUrl(mockProfile.baseUrl) } } }
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('options.apiKey');
    });

    it('fails when the managed provider is absent', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{"provider":{"other":{}}}');

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('managed AIdome provider');
    });

    it('fails when neither CLI nor config file is present', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);
      const result = await adapter.verify();
      expect(result.success).toBe(false);
      expect(result.message).toContain('not installed');
    });

    it('fails when the config file is missing', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);
      const result = await adapter.verify();
      expect(result.success).toBe(false);
      expect(result.message).toContain('config file not found');
    });

    it('fails closed on a malformed config document', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{ not json');

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not valid JSON');
    });

    it('fails when the stored base URL is invalid', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        provider: { aidome: { options: { baseURL: 'javascript:alert(1)', apiKey: 'aid_pat_TEST' } } }
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('invalid provider.aidome.options.baseURL');
    });

    it('handles errors gracefully', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockRejectedValue(new Error('Test error'));
      const result = await adapter.verify();
      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying');
    });
  });

  describe('getDisplayName', () => {
    it('should return the correct display name', () => {
      expect(adapter.getDisplayName()).toBe('OpenCode');
    });
  });

  describe('getTier', () => {
    it('should return tier A', () => {
      expect(adapter.getTier()).toBe('A');
    });
  });
});
