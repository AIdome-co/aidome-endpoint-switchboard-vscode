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
      const plan = await adapter.buildPlan(mockProfile, { authSecret: 'aid_pat_test' });

      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('continue');
      expect(plan.steps).toHaveLength(2);

      const editStep = plan.steps.find(step => step.action === 'edit-config-file');
      expect(editStep).toBeDefined();
      expect(editStep?.newValue).toBe(mockProfile.baseUrl);
      expect(editStep?.data.baseUrl).toBe(mockProfile.baseUrl);
      expect(editStep?.data.dialect).toBe(mockProfile.dialect);
      expect(editStep?.data.authSecret).toBe('aid_pat_test');

      const verifyStep = plan.steps.find(step => step.action === 'verify-endpoint');
      expect(verifyStep).toBeDefined();
      expect(verifyStep?.data.baseUrl).toBe(mockProfile.baseUrl);
    });

    it('does not emit an explicit backup step', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.find(step => step.action === 'backup-file')).toBeUndefined();
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

    it('should succeed when any Continue model has apiBase configured', async () => {
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
      expect(result.details?.models).toHaveLength(1);
    });

    it('should fail when the Continue config is invalid JSON', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{not-valid-json');

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not valid JSON');
      expect(result.details?.configPath).toBe('/tmp/continue/config.json');
    });

    it('should succeed when a YAML config defines model apiBase', async () => {
      vi.spyOn(continuePaths, 'getContinueConfigPath').mockReturnValue('/tmp/continue/config.yaml');
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue([
        'models:',
        '  - provider: openai',
        '    model: gpt-4o-mini',
        '    apiBase: https://aidome.example.com/v1',
      ].join('\n'));

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
      expect(result.details?.configPath).toBe('/tmp/continue/config.yaml');
    });

    it('should fail when the Continue config omits the models array', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({}));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('apiBase');
      expect(result.details?.models).toEqual([]);
    });

    it('should fail when models do not define apiBase', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [
          {
            title: 'OpenAI without gateway',
            provider: 'openai',
            model: 'gpt-4o-mini'
          }
        ]
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('apiBase');
      expect(result.details?.models).toHaveLength(1);
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