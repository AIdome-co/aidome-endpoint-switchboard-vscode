/**
 * Unit tests for Kilo Code adapter (v7.4+ config-file-based approach).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KiloCodeAdapter } from '../../src/adapters/kilocode/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

const {
  mockGetExtension,
  mockFileExists,
  mockReadFileSafe,
  mockLoggerError,
  mockLoggerInfo,
  mockLoggerWarning,
  mockDiscoverModels,
  mockBuildModelEntries
} = vi.hoisted(() => ({
  mockGetExtension: vi.fn(),
  mockFileExists: vi.fn(),
  mockReadFileSafe: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarning: vi.fn(),
  mockDiscoverModels: vi.fn(),
  mockBuildModelEntries: vi.fn(() => ({}))
}));

vi.mock('vscode', () => ({
  extensions: {
    getExtension: mockGetExtension
  }
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: mockLoggerError,
      warning: mockLoggerWarning,
      info: mockLoggerInfo
    })
  }
}));

vi.mock('../../src/adapters/kilocode/kiloConfigPatcher', () => ({
  getKiloConfigPath: vi.fn(() => '/home/user/.config/kilo/kilo.jsonc'),
  discoverModels: mockDiscoverModels,
  buildModelEntries: mockBuildModelEntries
}));

vi.mock('../../src/util/fsSafe', () => ({
  fileExists: mockFileExists,
  readFileSafe: mockReadFileSafe
}));

describe('KiloCodeAdapter', () => {
  let adapter: KiloCodeAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new KiloCodeAdapter();
    mockProfile = {
      id: 'profile-1',
      name: 'Profile 1',
      profileType: 'custom',
      baseUrl: 'https://gateway.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    mockGetExtension.mockReset();
    mockFileExists.mockReset();
    mockReadFileSafe.mockReset();
    mockLoggerError.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarning.mockReset();
    mockDiscoverModels.mockReset();
    mockDiscoverModels.mockResolvedValue([]);
    mockBuildModelEntries.mockReset();
    mockBuildModelEntries.mockReturnValue({});
  });

  describe('detect', () => {
    it('returns true when Kilo Code extension is installed', async () => {
      mockGetExtension.mockReturnValue({ packageJSON: {} });

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(mockGetExtension).toHaveBeenCalledWith('kilocode.kilo-code');
    });

    it('returns false when extension is not installed', async () => {
      mockGetExtension.mockReturnValue(undefined);

      const result = await adapter.detect();

      expect(result).toBe(false);
    });

    it('returns false when extension lookup throws', async () => {
      mockGetExtension.mockImplementation(() => {
        throw new Error('lookup failed');
      });

      const result = await adapter.detect();

      expect(result).toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('creates backup-file and edit-config-file steps for Kilo Code config', async () => {
      mockFileExists.mockResolvedValue(true);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.assistantKeys).toEqual(['kilo-code']);

      const backupStep = plan.steps.find((s) => s.action === 'backup-file');
      expect(backupStep).toBeDefined();
      expect(backupStep?.targetPath).toContain('kilo.jsonc');
      expect(backupStep?.assistantKey).toBe('kilo-code');

      const editStep = plan.steps.find((s) => s.action === 'edit-config-file');
      expect(editStep).toBeDefined();
      expect(editStep?.targetPath).toContain('kilo.jsonc');
      expect(editStep?.newValue).toBe(mockProfile.baseUrl);
      expect(editStep?.assistantKey).toBe('kilo-code');
      expect(editStep?.data?.format).toBe('jsonc');
      expect(editStep?.data?.providerSlug).toBe('aidome-gateway');

      const verifyStep = plan.steps.find((s) => s.action === 'verify-endpoint');
      expect(verifyStep).toBeDefined();
    });

    it('creates steps without backup when config file does not exist', async () => {
      mockFileExists.mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      const backupStep = plan.steps.find((s) => s.action === 'backup-file');
      expect(backupStep).toBeUndefined();

      const editStep = plan.steps.find((s) => s.action === 'edit-config-file');
      expect(editStep).toBeDefined();
    });

    it('includes all required step types', async () => {
      mockFileExists.mockResolvedValue(true);

      const plan = await adapter.buildPlan(mockProfile);

      const actions = plan.steps.map((s) => s.action);
      expect(actions).toContain('backup-file');
      expect(actions).toContain('edit-config-file');
      expect(actions).toContain('verify-endpoint');
    });

    it('passes discovered models to the edit-config-file step when discovery returns slugs', async () => {
      mockFileExists.mockResolvedValue(true);
      mockDiscoverModels.mockResolvedValue(['gpt-4', 'claude-3-opus']);
      const discoveredEntries = {
        'gpt-4': { name: 'gpt-4' },
        'claude-3-opus': { name: 'claude-3-opus' }
      };
      mockBuildModelEntries.mockReturnValue(discoveredEntries);

      const plan = await adapter.buildPlan(mockProfile);

      expect(mockDiscoverModels).toHaveBeenCalledWith(mockProfile.baseUrl);
      expect(mockBuildModelEntries).toHaveBeenCalledWith(['gpt-4', 'claude-3-opus']);

      const editStep = plan.steps.find((s) => s.action === 'edit-config-file');
      expect(editStep?.data?.models).toEqual(discoveredEntries);

      const guidedStep = plan.steps.find((s) => s.action === 'show-guided-steps');
      expect(guidedStep).toBeUndefined();
    });

    it('adds guided-steps when no models are discovered and no config exists', async () => {
      mockFileExists.mockResolvedValue(false);
      mockDiscoverModels.mockResolvedValue([]);

      const plan = await adapter.buildPlan(mockProfile);

      const guidedStep = plan.steps.find((s) => s.action === 'show-guided-steps');
      expect(guidedStep).toBeDefined();
      expect(guidedStep?.data?.baseUrl).toBe(mockProfile.baseUrl);
      expect(Array.isArray(guidedStep?.data?.steps)).toBe(true);
      expect((guidedStep?.data?.steps as string[]).length).toBeGreaterThan(0);

      const editStep = plan.steps.find((s) => s.action === 'edit-config-file');
      expect(editStep?.data?.models).toBeUndefined();
    });
  });

  describe('verify', () => {
    it('returns success when config file has aidome-gateway provider with baseURL', async () => {
      mockReadFileSafe.mockResolvedValue(JSON.stringify({
        $schema: 'https://app.kilo.ai/config.json',
        provider: {
          'aidome-gateway': {
            name: 'AIdome Gateway',
            npm: '@ai-sdk/openai-compatible',
            options: { baseURL: 'https://gateway.example.com/v1' }
          }
        }
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('Kilo Code configuration verified');
      expect(result.details?.configPath).toContain('kilo.jsonc');
    });

    it('returns failure when config file is not found', async () => {
      mockReadFileSafe.mockResolvedValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('config file not found');
    });

    it('returns failure when config file lacks aidome-gateway provider', async () => {
      mockReadFileSafe.mockResolvedValue(JSON.stringify({
        provider: {
          'some-other-provider': {
            name: 'Other',
            options: { baseURL: 'https://other.example.com' }
          }
        }
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not have AIdome Gateway provider configured');
    });

    it('returns failure when config file exists but is empty', async () => {
      mockReadFileSafe.mockResolvedValue('{}');

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not have AIdome Gateway provider configured');
    });

    it('wraps unexpected errors into failed result', async () => {
      mockReadFileSafe.mockImplementation(() => {
        throw new Error('disk failure');
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying');
      expect(result.message).toContain('disk failure');
    });
  });

  describe('metadata', () => {
    it('returns display name', () => {
      expect(adapter.getDisplayName()).toBe('Kilo Code');
    });

    it('returns tier A', () => {
      expect(adapter.getTier()).toBe('A');
    });

    it('apply resolves without side effects', async () => {
      await expect(adapter.apply({
        profileId: 'profile-1',
        assistantKeys: ['kilo-code'],
        steps: []
      })).resolves.toBeUndefined();
    });
  });
});