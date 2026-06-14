/**
 * Unit tests for Kilo Code adapter.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KiloCodeAdapter } from '../../src/adapters/kilocode/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

const {
  mockGetExtension,
  mockConfigGet,
  mockLoggerError,
  mockLoggerInfo,
  mockLoggerWarning
} = vi.hoisted(() => ({
  mockGetExtension: vi.fn(),
  mockConfigGet: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarning: vi.fn()
}));

vi.mock('vscode', () => ({
  extensions: {
    getExtension: mockGetExtension
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: mockConfigGet
    }))
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
    mockConfigGet.mockReset();
    mockLoggerError.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarning.mockReset();
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
    it('creates set-vscode-setting steps for discovered registered keys only', async () => {
      mockGetExtension.mockReturnValue({
        packageJSON: {
          contributes: {
            configuration: {
              properties: {
                'kilocode.openaiBaseUrl': { type: 'string', description: 'OpenAI base URL' },
                'kilocode.customProviderEndpoint': { type: 'string', description: 'Custom provider endpoint' },
                'kilocode.openaiBaseUrlDuplicate': { type: 'string', description: 'another base URL' },
                'kilocode.baselineLabel': { type: 'string', description: 'Baseline label for snapshots' },
                'kilocode.databaseLabel': { type: 'string', description: 'Database label for snapshots' },
                'kilocode.nestedObj': { type: 'object', description: 'endpoint metadata object' },
                'otherext.baseUrl': { type: 'string', description: 'base url' },
                'kilocode.model': { type: 'string', description: 'Model name' }
              }
            }
          }
        }
      });

      const plan = await adapter.buildPlan(mockProfile);
      const setSteps = plan.steps.filter((s) => s.action === 'set-vscode-setting');

      const keys = setSteps.map((s) => s.targetPath);
      expect(keys).toContain('kilocode.openaiBaseUrl');
      expect(keys).toContain('kilocode.customProviderEndpoint');
      expect(keys).toContain('kilocode.openaiBaseUrlDuplicate');
      expect(keys).not.toContain('kilocode.baselineLabel');
      expect(keys).not.toContain('kilocode.databaseLabel');
      expect(keys).not.toContain('kilocode.nestedObj');
      expect(keys).not.toContain('otherext.baseUrl');
      expect(keys).not.toContain('kilocode.model');

      for (const step of setSteps) {
        expect(step.newValue).toBe(mockProfile.baseUrl);
      }
    });

    it('falls back to guided mode when extension is installed but no configuration is contributed', async () => {
      mockGetExtension.mockReturnValue({
        packageJSON: {
          contributes: {}
        }
      });

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.some((s) => s.action === 'set-vscode-setting')).toBe(false);
      const guidedStep = plan.steps.find((s) => s.action === 'show-guided-steps');
      expect(guidedStep).toBeDefined();
      expect(guidedStep?.assistantKey).toBe('kilo-code');
      expect(guidedStep?.data?.baseUrl).toBe(mockProfile.baseUrl);
      expect(Array.isArray(guidedStep?.data?.steps)).toBe(true);
      expect((guidedStep?.data?.steps as string[]).length).toBeGreaterThan(0);
    });

    it('supports array-form extension configuration metadata', async () => {
      mockGetExtension.mockReturnValue({
        packageJSON: {
          contributes: {
            configuration: [
              {
                properties: {
                  'kilocode.base_url': { type: ['string', 'null'], description: 'Base URL for provider' },
                  'kilocode.apibase': { type: 'string', description: 'API base' }
                }
              },
              {
                properties: {
                  'kilocode.customproviderendpoint': { type: 'string', description: 'Custom provider endpoint' },
                  'kilocode.noHint': { type: 'string', description: 'No matching hint text' },
                  'kilocode.descOnly': { type: 'string', description: 'Set the endpoint URL here' },
                  'kilocode.numberSetting': { type: 'number', description: 'base url as a number' }
                }
              }
            ]
          }
        }
      });

      const plan = await adapter.buildPlan(mockProfile);
      const setSteps = plan.steps.filter((s) => s.action === 'set-vscode-setting');
      const keys = setSteps.map((s) => s.targetPath);

      expect(keys).toContain('kilocode.base_url');
      expect(keys).toContain('kilocode.apibase');
      expect(keys).toContain('kilocode.customproviderendpoint');
      expect(keys).toContain('kilocode.descOnly');
      expect(keys).not.toContain('kilocode.noHint');
      expect(keys).not.toContain('kilocode.numberSetting');
    });

    it('handles sparse metadata entries without properties or descriptions', async () => {
      mockGetExtension.mockReturnValue({
        packageJSON: {
          contributes: {
            configuration: [
              {},
              {
                properties: {
                  'kilocode.undefinedProp': undefined,
                  'kilocode.emptyType': { type: [] },
                  'kilocode.onlyKeyHintEndpoint': { type: 'string' },
                  'kilocode.noTypeEndpoint': { description: 'endpoint override' }
                }
              }
            ]
          }
        }
      });

      const plan = await adapter.buildPlan(mockProfile);
      const setSteps = plan.steps.filter((s) => s.action === 'set-vscode-setting');
      const keys = setSteps.map((s) => s.targetPath);

      expect(keys).toContain('kilocode.onlyKeyHintEndpoint');
      expect(keys).not.toContain('kilocode.undefinedProp');
      expect(keys).not.toContain('kilocode.noTypeEndpoint');
      expect(keys).not.toContain('kilocode.emptyType');
    });

    it('falls back to guided mode when object configuration has no properties map', async () => {
      mockGetExtension.mockReturnValue({
        packageJSON: {
          contributes: {
            configuration: {}
          }
        }
      });

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.some((s) => s.action === 'set-vscode-setting')).toBe(false);
      expect(plan.steps.some((s) => s.action === 'show-guided-steps')).toBe(true);
    });

    it('uses fallback keys when extension is not installed', async () => {
      mockGetExtension.mockReturnValue(undefined);

      const plan = await adapter.buildPlan(mockProfile);
      const setSteps = plan.steps.filter((s) => s.action === 'set-vscode-setting');

      expect(setSteps.map((s) => s.targetPath)).toEqual([
        'kilocode.openaiBaseUrl',
        'kilocode.customProviderEndpoint',
        'kilocode.baseUrl'
      ]);
    });

    it('falls back to guided mode when discovery throws', async () => {
      mockGetExtension.mockImplementation(() => {
        throw new Error('boom');
      });

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.some((s) => s.action === 'set-vscode-setting')).toBe(false);
      expect(plan.steps.some((s) => s.action === 'show-guided-steps')).toBe(true);
      expect(mockLoggerWarning).toHaveBeenCalledWith(
        'Error discovering Kilo Code setting keys',
        expect.objectContaining({
          error: 'boom',
          errorDetails: expect.objectContaining({
            name: 'Error',
            message: 'boom',
            stack: expect.any(String)
          })
        })
      );
    });

    it('logs non-Error discovery failures as serializable context', async () => {
      mockGetExtension.mockImplementation(() => {
        throw 'boom';
      });

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.some((s) => s.action === 'set-vscode-setting')).toBe(false);
      expect(plan.steps.some((s) => s.action === 'show-guided-steps')).toBe(true);
      expect(mockLoggerWarning).toHaveBeenCalledWith(
        'Error discovering Kilo Code setting keys',
        { error: 'boom' }
      );
    });


    it('logs circular non-Error discovery failures as serializable strings', async () => {
      const circular: Record<string, unknown> = { reason: 'circular' };
      circular.self = circular;
      mockGetExtension.mockImplementation(() => {
        throw circular;
      });

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.some((s) => s.action === 'set-vscode-setting')).toBe(false);
      expect(plan.steps.some((s) => s.action === 'show-guided-steps')).toBe(true);
      expect(mockLoggerWarning).toHaveBeenCalledWith(
        'Error discovering Kilo Code setting keys',
        { error: '[object Object]' }
      );
      expect(() => JSON.stringify(mockLoggerWarning.mock.calls.at(-1)?.[1])).not.toThrow();
    });
  });

  describe('verify', () => {
    it('returns success when at least one discovered key is configured', async () => {
      mockGetExtension.mockReturnValue({
        packageJSON: {
          contributes: {
            configuration: {
              properties: {
                'kilocode.openaiBaseUrl': { type: 'string', description: 'base url' },
                'kilocode.customProviderEndpoint': { type: 'string', description: 'provider endpoint' }
              }
            }
          }
        }
      });

      mockConfigGet.mockImplementation((key: string) => {
        if (key === 'kilocode.openaiBaseUrl') {
          return 'https://gateway.example.com/v1';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configuredSettings).toEqual({
        'kilocode.openaiBaseUrl': 'https://gateway.example.com/v1'
      });
    });

    it('returns failure when no discovered key is configured', async () => {
      mockGetExtension.mockReturnValue({
        packageJSON: {
          contributes: {
            configuration: {
              properties: {
                'kilocode.openaiBaseUrl': { type: 'string', description: 'base url' }
              }
            }
          }
        }
      });

      mockConfigGet.mockReturnValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('No Kilo Code base URL settings configured');
      expect(result.details?.checkedKeys).toEqual(['kilocode.openaiBaseUrl']);
    });

    it('returns an actionable failure when no registered URL settings are discoverable', async () => {
      mockGetExtension.mockReturnValue({
        packageJSON: {
          contributes: {
            configuration: {}
          }
        }
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('No registered Kilo Code URL settings were discovered');
      expect(result.message).toContain('Configure the endpoint manually');
      expect(result.details).toEqual({
        checkedKeys: [],
        nextStep: 'Configure the endpoint manually in Kilo Code settings or update the Kilo Code extension.'
      });
    });

    it('returns failure with error details when configuration read throws', async () => {
      mockGetExtension.mockReturnValue({
        packageJSON: {
          contributes: {
            configuration: {
              properties: {
                'kilocode.openaiBaseUrl': { type: 'string', description: 'base url' }
              }
            }
          }
        }
      });

      mockConfigGet.mockImplementation(() => {
        throw new Error('config read failed');
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying Kilo Code config');
      expect(result.details?.error).toBe('config read failed');
      expect(result.details?.errorDetails).toEqual(expect.objectContaining({ message: 'config read failed' }));
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
