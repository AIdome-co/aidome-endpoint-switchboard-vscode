/**
 * Unit tests for Continue adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContinueAdapter } from '../../src/adapters/continue/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as fsSafe from '../../src/util/fsSafe';
import * as continuePaths from '../../src/adapters/continue/paths';

const mockExtension = {
  packageJSON: {}
};

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn()
  }
}));

vi.mock('../../src/util/fsSafe');
vi.mock('../../src/adapters/continue/paths');
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    })
  }
}));

describe('ContinueAdapter', () => {
  let adapter: ContinueAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new ContinueAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      profileType: 'custom',
      baseUrl: 'https://aidome.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    vi.clearAllMocks();
    vi.spyOn(continuePaths, 'getContinueConfigPath').mockReturnValue('/tmp/continue/config.json');
  });

  describe('detect', () => {
    it('should return true when Continue extension is installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('Continue.continue');
    });

    it('should return false when Continue extension is not installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

      const result = await adapter.detect();

      expect(result).toBe(false);
    });

    it('should return false when extension lookup throws', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(() => {
        throw new Error('extension lookup failed');
      });

      const result = await adapter.detect();

      expect(result).toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('should create config-file steps that set the Continue apiBase', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('continue');
      expect(plan.steps).toHaveLength(2);

      // The applier guarantees the backup automatically; the plan carries
      // backupRequired metadata instead of a duplicate mutation step.
      const editStep = plan.steps.find(step => step.action === 'edit-config-file');
      expect(editStep).toBeDefined();
      expect(editStep?.targetPath).toBe('/tmp/continue/config.json');
      expect(editStep?.newValue).toBe(mockProfile.baseUrl);
      expect(editStep?.data.baseUrl).toBe(mockProfile.baseUrl);
      expect(editStep?.data.backupRequired).toBe(true);
      expect(editStep?.data.identity).toBe('AIdome Gateway');
      expect(editStep?.data.driver).toBe('yaml-model-array');

      const verifyStep = plan.steps.find(step => step.action === 'verify-endpoint');
      expect(verifyStep).toBeDefined();
      expect(verifyStep?.data.baseUrl).toBe(mockProfile.baseUrl);
    });

    it('should emit no duplicate backup step (applier owns backup)', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.find(step => step.action === 'backup-file')).toBeUndefined();
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps.find(step => step.action === 'edit-config-file')).toBeDefined();
    });

    it('should declare the yaml format when the config path is a YAML file', async () => {
      vi.spyOn(continuePaths, 'getContinueConfigPath').mockReturnValue('/tmp/continue/config.yaml');
      const plan = await adapter.buildPlan(mockProfile);

      const editStep = plan.steps.find(step => step.action === 'edit-config-file');
      expect(editStep?.data.format).toBe('yaml');
    });
  });

  describe('verify', () => {
    it('should fail when the Continue config file does not exist', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
      expect(result.details?.configPath).toBe('/tmp/continue/config.json');
    });

    it('should succeed when the Switchboard-managed entry matches the profile exactly', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [
          {
            title: 'AIdome Gateway',
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiBase: 'https://aidome.example.com/v1'
          }
        ]
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
      expect(result.details?.configPath).toBe('/tmp/continue/config.json');
      expect(result.details?.modelCount).toBe(1);
    });

    it('should fail when the managed entry has no apiBase', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [{ title: 'AIdome Gateway', provider: 'openai' }]
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('no apiBase');
    });

    it('should fail closed when the expected profile URL is unknown', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [{ title: 'AIdome Gateway', provider: 'openai', apiBase: 'https://someone-else.example.com/v1' }]
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('apply a profile first');
    });

    it('should fail when the managed entry apiBase does not match the profile', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [{ title: 'AIdome Gateway', provider: 'openai', apiBase: 'https://stale.example.com/v1' }]
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not match');
    });

    it('should fail when an unrelated OpenAI model exists but no AIdome entry does', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [
          {
            title: 'User own model',
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiBase: 'https://api.openai.com/v1'
          }
        ]
      }));

      const result = await adapter.verify();

      // An unrelated OpenAI model with an apiBase is NOT a configured state.
      expect(result.success).toBe(false);
      expect(result.message).toContain('AIdome Gateway');
      expect(result.details?.modelCount).toBe(1);
    });

    it('should parse YAML config for a .yaml path', async () => {
      vi.spyOn(continuePaths, 'getContinueConfigPath').mockReturnValue('/tmp/continue/config.yaml');
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(
        'models:\n  - name: AIdome Gateway\n    title: AIdome Gateway\n    provider: openai\n    apiBase: https://aidome.example.com/v1\n'
      );

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.format).toBe('yaml');
      expect(result.details?.modelCount).toBe(1);
    });

    it('should fail YAML config without apiBase', async () => {
      vi.spyOn(continuePaths, 'getContinueConfigPath').mockReturnValue('/tmp/continue/config.yaml');
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('models:\n  - name: Other\n    provider: openai\n');

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.format).toBe('yaml');
    });

    it('should fail gracefully when reading the Continue config throws', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockRejectedValue(new Error('read failed'));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying Continue.dev config');
      expect(result.details?.error).toBe('read failed');
    });
  });

  describe('apply', () => {
    it('should resolve without mutating the plan', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      await expect(adapter.apply(plan)).resolves.toBeUndefined();
    });
  });

  describe('getDisplayName', () => {
    it('should return the Continue display name', () => {
      expect(adapter.getDisplayName()).toBe('Continue.dev');
    });
  });

  describe('getTier', () => {
    it('should return tier A', () => {
      expect(adapter.getTier()).toBe('A');
    });
  });
});

describe('ContinueAdapter with missing descriptor', () => {
  it('fails fast when the provider descriptor is unavailable', async () => {
    vi.resetModules();
    vi.doMock('../../src/core/providerConfig/descriptors', () => ({
      getProviderConfigDescriptor: () => undefined
    }));
    const { ContinueAdapter: FallbackAdapter } = await import('../../src/adapters/continue/adapter');
    const fallback = new FallbackAdapter();

    const fallbackProfile: EndpointProfile = {
      id: 'fallback-profile',
      name: 'Fallback Profile',
      profileType: 'custom',
      baseUrl: 'https://aidome.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await expect(fallback.buildPlan(fallbackProfile)).rejects.toThrow('Continue provider descriptor is missing');

    vi.doUnmock('../../src/core/providerConfig/descriptors');
    vi.resetModules();
  });
});
