/**
 * Regression tests for Cline's native file-backed provider configuration.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ClineAdapter } from '../../src/adapters/cline/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import { getClineConfigPaths } from '../../src/adapters/cline/clineConfigPatcher';

const {
  mockGetExtension,
  mockFileExists,
  mockReadFileSafe,
  mockLoggerError,
  mockLoggerInfo,
  mockLoggerWarning
} = vi.hoisted(() => ({
  mockGetExtension: vi.fn(),
  mockFileExists: vi.fn(),
  mockReadFileSafe: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarning: vi.fn()
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

vi.mock('../../src/util/fsSafe', () => ({
  fileExists: mockFileExists,
  readFileSafe: mockReadFileSafe
}));

describe('ClineAdapter', () => {
  let adapter: ClineAdapter;
  let mockProfile: EndpointProfile;
  const originalDataDir = process.env.CLINE_DATA_DIR;
  const originalProviderSettingsPath = process.env.CLINE_PROVIDER_SETTINGS_PATH;

  beforeEach(() => {
    adapter = new ClineAdapter();
    mockProfile = {
      id: 'profile-1',
      name: 'Profile 1',
      profileType: 'custom',
      baseUrl: 'https://gateway.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    process.env.CLINE_DATA_DIR = '/tmp/cline-switchboard-test';
    delete process.env.CLINE_PROVIDER_SETTINGS_PATH;
    mockGetExtension.mockReset();
    mockFileExists.mockReset();
    mockFileExists.mockResolvedValue(true);
    mockReadFileSafe.mockReset();
    mockReadFileSafe.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('providers.json')) {
        return JSON.stringify({
          version: 1,
          modes: { voiceInput: { providerId: 'anthropic', modelId: 'claude' } },
          lastUsedProvider: 'anthropic',
          providers: {
            anthropic: {
              settings: { provider: 'anthropic', apiKey: 'keep-this-provider' },
              updatedAt: '2026-08-01T00:00:00.000Z',
              tokenSource: 'manual'
            },
            'openai-compatible': {
              settings: {
                provider: 'openai-compatible',
                apiKey: 'keep-this-key',
                model: 'keep-this-model',
                baseUrl: 'https://old.example/v1'
              },
              updatedAt: '2026-08-01T00:00:00.000Z',
              tokenSource: 'manual'
            }
          }
        });
      }

      return JSON.stringify({
        unrelatedSetting: true,
        openAiBaseUrl: 'https://old.example/v1',
        planModeApiProvider: 'anthropic',
        actModeApiProvider: 'anthropic',
        actModeOpenAiModelId: 'keep-this-model'
      });
    });
    mockLoggerError.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarning.mockReset();
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.CLINE_DATA_DIR;
    } else {
      process.env.CLINE_DATA_DIR = originalDataDir;
    }
    if (originalProviderSettingsPath === undefined) {
      delete process.env.CLINE_PROVIDER_SETTINGS_PATH;
    } else {
      process.env.CLINE_PROVIDER_SETTINGS_PATH = originalProviderSettingsPath;
    }
  });

  describe('detect', () => {
    it('detects the current Cline extension ID', async () => {
      mockGetExtension.mockReturnValue({ packageJSON: { name: 'claude-dev' } });

      await expect(adapter.detect()).resolves.toBe(true);
      expect(mockGetExtension).toHaveBeenCalledWith('saoudrizwan.claude-dev');
    });

    it('returns false when Cline is not installed', async () => {
      mockGetExtension.mockReturnValue(undefined);

      await expect(adapter.detect()).resolves.toBe(false);
    });

    it('returns false when extension detection throws', async () => {
      mockGetExtension.mockImplementation(() => {
        throw new Error('lookup failed');
      });

      await expect(adapter.detect()).resolves.toBe(false);
      expect(mockLoggerError).toHaveBeenCalled();
    });
  });

  describe('buildPlan', () => {
    it('plans native provider and active-state edits instead of VS Code settings', async () => {
      const plan = await adapter.buildPlan(mockProfile);
      const editSteps = plan.steps.filter((step) => step.action === 'edit-config-file');

      expect(plan.assistantKeys).toEqual(['cline']);
      expect(editSteps).toHaveLength(2);
      const paths = getClineConfigPaths();
      expect(editSteps.map((step) => step.targetPath)).toEqual([
        paths.providerSettingsPath,
        paths.globalStatePath
      ]);
      expect(plan.steps.some((step) => step.action === 'set-vscode-setting')).toBe(false);
      expect(plan.steps.some((step) => step.action === 'verify-endpoint')).toBe(true);

      expect(editSteps[0].newValue).toBe(mockProfile.baseUrl);
      expect(editSteps[0].data.driver).toBe('json-object');
      expect(editSteps[0].data.patches).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['providers', 'openai-compatible', 'settings', 'baseUrl'], source: 'baseUrl' })
      ]));
      expect(editSteps[1].newValue).toBe(mockProfile.baseUrl);
      expect(editSteps[1].data.driver).toBe('json-object');
      expect(JSON.stringify(plan)).not.toContain('keep-this-provider');
      expect(JSON.stringify(plan)).not.toContain('keep-this-key');
    });

    it('follows the VS Code host path even when the CLI-only provider path override is set', async () => {
      process.env.CLINE_PROVIDER_SETTINGS_PATH = '/custom/cline/providers.json';

      const plan = await adapter.buildPlan(mockProfile);
      const editSteps = plan.steps.filter((step) => step.action === 'edit-config-file');
      const paths = getClineConfigPaths();

      expect(editSteps[0].targetPath).toBe(paths.providerSettingsPath);
      expect(editSteps[1].targetPath).toBe(paths.globalStatePath);
    });

    it('creates native files without explicit backup steps when files are missing', async () => {
      mockFileExists.mockResolvedValue(false);
      mockReadFileSafe.mockResolvedValue(undefined);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.filter((step) => step.action === 'backup-file')).toHaveLength(0);
      expect(plan.steps.filter((step) => step.action === 'edit-config-file')).toHaveLength(2);
      expect(plan.steps[0].newValue).toBe(mockProfile.baseUrl);
      expect(plan.steps[0].data.driver).toBe('json-object');
      expect(plan.steps[0].data.patches).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['version'], value: 1 })
      ]));
    });

    it('does not read native files or embed their content while building a plan', async () => {
      mockReadFileSafe.mockResolvedValue('{not-json');

      const plan = await adapter.buildPlan(mockProfile);
      const editSteps = plan.steps.filter((step) => step.action === 'edit-config-file');

      expect(editSteps).toHaveLength(2);
      expect(editSteps.every((step) => step.newValue === mockProfile.baseUrl)).toBe(true);
      expect(mockReadFileSafe).not.toHaveBeenCalled();
    });

    it('rejects unsafe or unsupported endpoint URLs before reading native files', async () => {
      await expect(adapter.buildPlan({ ...mockProfile, baseUrl: 'javascript:alert(1)' }))
        .rejects.toThrow('Invalid Cline endpoint URL');
      expect(mockReadFileSafe).not.toHaveBeenCalled();
    });

    it('redacts URL query secrets from the plan description', async () => {
      const profileWithSecretQuery = {
        ...mockProfile,
        baseUrl: 'https://gateway.example.com/v1?token=do-not-display'
      };

      const plan = await adapter.buildPlan(profileWithSecretQuery);
      const endpointStep = plan.steps.find((step) => step.action === 'edit-config-file');

      expect(endpointStep?.description).toContain('https://gateway.example.com/v1');
      expect(endpointStep?.description).not.toContain('do-not-display');
    });
  });

  describe('verify', () => {
    it('verifies provider ID, active mode selection, and matching endpoint values', async () => {
      mockReadFileSafe.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('providers.json')) {
          return JSON.stringify({
            version: 1,
            modes: {},
            providers: {
              'openai-compatible': {
                settings: { provider: 'openai-compatible', baseUrl: mockProfile.baseUrl },
                updatedAt: '2026-08-01T00:00:00.000Z',
                tokenSource: 'manual'
              }
            }
          });
        }
        return JSON.stringify({
          openAiBaseUrl: mockProfile.baseUrl,
          planModeApiProvider: 'openai',
          actModeApiProvider: 'openai'
        });
      });

      const result = await adapter.verify();

      expect(result).toEqual(expect.objectContaining({
        success: true,
        message: 'Cline native provider configuration verified'
      }));
      expect(result.details).toMatchObject({
        providerId: 'openai-compatible',
        planModeApiProvider: 'openai',
        actModeApiProvider: 'openai',
        baseUrlConfigured: true
      });
    });

    it('accepts the SDK provider spelling in global state for compatibility', async () => {
      mockReadFileSafe.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('providers.json')) {
          return JSON.stringify({
            version: 1,
            modes: {},
            providers: {
              'openai-compatible': {
                settings: { provider: 'openai-compatible', baseUrl: mockProfile.baseUrl },
                updatedAt: '2026-08-01T00:00:00.000Z',
                tokenSource: 'manual'
              }
            }
          });
        }
        return JSON.stringify({
          openAiBaseUrl: mockProfile.baseUrl,
          planModeApiProvider: 'openai-compatible',
          actModeApiProvider: 'openai-compatible'
        });
      });

      await expect(adapter.verify()).resolves.toMatchObject({ success: true });
    });

    it('fails when either native file is missing', async () => {
      mockReadFileSafe.mockResolvedValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('files are missing');
    });

    it('fails closed for malformed native JSON', async () => {
      mockReadFileSafe.mockResolvedValue('{not-json');

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('invalid JSON');
    });

    it('fails when the native provider or active mode selection is wrong', async () => {
      mockReadFileSafe.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('providers.json')) {
          return JSON.stringify({
            version: 1,
            modes: {},
            providers: {
              'openai-compatible': {
                settings: { provider: 'openai-compatible', baseUrl: mockProfile.baseUrl },
                updatedAt: '2026-08-01T00:00:00.000Z',
                tokenSource: 'manual'
              }
            }
          });
        }
        return JSON.stringify({
          openAiBaseUrl: mockProfile.baseUrl,
          planModeApiProvider: 'anthropic',
          actModeApiProvider: 'anthropic'
        });
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not select');
    });

    it('fails when provider and legacy endpoint values diverge', async () => {
      mockReadFileSafe.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('providers.json')) {
          return JSON.stringify({
            version: 1,
            modes: {},
            providers: {
              'openai-compatible': {
                settings: {
                  provider: 'openai-compatible',
                  baseUrl: 'https://provider.example/v1?token=provider-secret'
                },
                updatedAt: '2026-08-01T00:00:00.000Z',
                tokenSource: 'manual'
              }
            }
          });
        }
        return JSON.stringify({
          openAiBaseUrl: 'https://different.example/v1?token=global-secret',
          planModeApiProvider: 'openai',
          actModeApiProvider: 'openai'
        });
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('do not match');
      expect(result.details).toMatchObject({
        providerBaseUrl: 'https://provider.example/v1',
        globalBaseUrl: 'https://different.example/v1'
      });
      expect(JSON.stringify(result.details)).not.toContain('provider-secret');
      expect(JSON.stringify(result.details)).not.toContain('global-secret');
    });

    it('fails when the provider base URL is invalid', async () => {
      mockReadFileSafe.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('providers.json')) {
          return JSON.stringify({
            version: 1,
            modes: {},
            providers: {
              'openai-compatible': {
                settings: { provider: 'openai-compatible', baseUrl: 'javascript:alert(1)' },
                updatedAt: '2026-08-01T00:00:00.000Z',
                tokenSource: 'manual'
              }
            }
          });
        }
        return JSON.stringify({
          openAiBaseUrl: mockProfile.baseUrl,
          planModeApiProvider: 'openai',
          actModeApiProvider: 'openai'
        });
      });

      await expect(adapter.verify()).resolves.toMatchObject({
        success: false,
        message: 'Cline providers.json has no valid OpenAI-compatible base URL'
      });
    });

    it('fails when the native provider entry does not select OpenAI-compatible', async () => {
      mockReadFileSafe.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('providers.json')) {
          return JSON.stringify({
            version: 1,
            modes: {},
            providers: {
              'openai-compatible': {
                settings: { provider: 'anthropic', baseUrl: mockProfile.baseUrl },
                updatedAt: '2026-08-01T00:00:00.000Z',
                tokenSource: 'manual'
              }
            }
          });
        }
        return JSON.stringify({
          openAiBaseUrl: mockProfile.baseUrl,
          planModeApiProvider: 'openai',
          actModeApiProvider: 'openai'
        });
      });

      await expect(adapter.verify()).resolves.toMatchObject({
        success: false,
        message: 'Cline providers.json does not select the OpenAI-compatible provider'
      });
    });

    it('fails when the global-state base URL is invalid', async () => {
      mockReadFileSafe.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('providers.json')) {
          return JSON.stringify({
            version: 1,
            modes: {},
            providers: {
              'openai-compatible': {
                settings: { provider: 'openai-compatible', baseUrl: mockProfile.baseUrl },
                updatedAt: '2026-08-01T00:00:00.000Z',
                tokenSource: 'manual'
              }
            }
          });
        }
        return JSON.stringify({
          openAiBaseUrl: 'javascript:alert(1)',
          planModeApiProvider: 'openai',
          actModeApiProvider: 'openai'
        });
      });

      await expect(adapter.verify()).resolves.toMatchObject({
        success: false,
        message: 'Cline globalState.json has no valid OpenAI-compatible base URL'
      });
    });

    it('fails closed for unsupported provider document versions', async () => {
      mockReadFileSafe.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('providers.json')) {
          return JSON.stringify({
            version: 2,
            providers: {}
          });
        }
        return JSON.stringify({
          openAiBaseUrl: mockProfile.baseUrl,
          planModeApiProvider: 'openai',
          actModeApiProvider: 'openai'
        });
      });

      await expect(adapter.verify()).resolves.toMatchObject({
        success: false,
        message: 'Cline native provider configuration contains invalid JSON'
      });
    });

    it('fails closed when the provider document has no OpenAI-compatible entry', async () => {
      mockReadFileSafe.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('providers.json')) {
          return JSON.stringify({ version: 1, providers: {} });
        }
        return JSON.stringify({
          openAiBaseUrl: mockProfile.baseUrl,
          planModeApiProvider: 'openai',
          actModeApiProvider: 'openai'
        });
      });

      await expect(adapter.verify()).resolves.toMatchObject({
        success: false,
        message: 'Cline native provider configuration contains invalid JSON'
      });
    });

    it('fails closed when provider metadata is invalid', async () => {
      mockReadFileSafe.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('providers.json')) {
          return JSON.stringify({
            version: 1,
            providers: {
              'openai-compatible': {
                settings: { provider: 'openai-compatible', baseUrl: mockProfile.baseUrl },
                updatedAt: 'not-a-date',
                tokenSource: 'unknown'
              }
            }
          });
        }
        return JSON.stringify({
          openAiBaseUrl: mockProfile.baseUrl,
          planModeApiProvider: 'openai',
          actModeApiProvider: 'openai'
        });
      });

      await expect(adapter.verify()).resolves.toMatchObject({
        success: false,
        message: 'Cline native provider configuration contains invalid JSON'
      });
    });

    it('accepts each supported provider token source', async () => {
      let tokenSource: 'oauth' | 'migration' = 'oauth';
      mockReadFileSafe.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('providers.json')) {
          return JSON.stringify({
            version: 1,
            providers: {
              'openai-compatible': {
                settings: { provider: 'openai-compatible', baseUrl: mockProfile.baseUrl },
                updatedAt: '2026-08-01T00:00:00.000Z',
                tokenSource
              }
            }
          });
        }
        return JSON.stringify({
          openAiBaseUrl: mockProfile.baseUrl,
          planModeApiProvider: 'openai',
          actModeApiProvider: 'openai'
        });
      });

      await expect(adapter.verify()).resolves.toMatchObject({ success: true });
      tokenSource = 'migration';
      await expect(adapter.verify()).resolves.toMatchObject({ success: true });
    });

    it('fails closed when an active provider mode is not a string', async () => {
      mockReadFileSafe.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('providers.json')) {
          return JSON.stringify({
            version: 1,
            modes: {},
            providers: {
              'openai-compatible': {
                settings: { provider: 'openai-compatible', baseUrl: mockProfile.baseUrl },
                updatedAt: '2026-08-01T00:00:00.000Z',
                tokenSource: 'manual'
              }
            }
          });
        }
        return JSON.stringify({
          openAiBaseUrl: mockProfile.baseUrl,
          planModeApiProvider: 1,
          actModeApiProvider: 'openai'
        });
      });

      await expect(adapter.verify()).resolves.toMatchObject({
        success: false,
        message: 'Cline globalState.json does not select the OpenAI-compatible provider for both modes'
      });
    });
  });

  it('reports Tier A and the current display name', () => {
    expect(adapter.getTier()).toBe('A');
    expect(adapter.getDisplayName()).toBe('Cline');
  });
});
