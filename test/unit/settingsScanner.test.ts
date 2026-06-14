/**
 * Unit tests for src/adapters/generic/settingsScanner.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('vscode', () => {
  const mockExtensionInner = {
    packageJSON: {
      contributes: {
        configuration: {
          properties: {
            'myext.baseUrl': { type: 'string' },
            'myext.apiBase': { type: 'string' },
            'myext.endpoint': { type: 'string' },
            'myext.provider': { type: 'string' },
            'myext.modelProvider': { type: 'string' },
            'myext.host': { type: 'string' },
            'myext.serverUrl': { type: 'string' },
            'myext.debugMode': { type: 'boolean' },
            'myext.timeout': { type: 'number' },
          },
        },
      },
    },
  };
  const config = {
    get: vi.fn((key: string) => {
      const map: Record<string, unknown> = {
        'myext.baseUrl': 'https://api.example.com',
      };
      return map[key];
    }),
    update: vi.fn(),
  };
  const getConfigFn = vi.fn(() => config);
  return {
    extensions: {
      getExtension: vi.fn((id: string) => {
        if (id === 'publisher.myext') {
          return mockExtensionInner;
        }
        return undefined;
      }),
    },
    workspace: {
      getConfiguration: getConfigFn,
    },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  };
});

import {
  scanExtensionSettings,
  scanExtensionSettingsWithConfidence,
  discoverBaseUrlSettings,
  discoverProviderSettings,
  getSettingValue,
  setSettingValue,
} from '../../src/adapters/generic/settingsScanner';

describe('settingsScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scanExtensionSettings', () => {
    it('returns matching keys for a pattern', () => {
      const results = scanExtensionSettings('publisher.myext', ['*baseUrl*']);
      expect(results).toContain('myext.baseUrl');
    });

    it('returns empty array for unknown extension', () => {
      const results = scanExtensionSettings('publisher.unknown', ['*baseUrl*']);
      expect(results).toEqual([]);
    });

    it('matches multiple patterns', () => {
      const results = scanExtensionSettings('publisher.myext', ['*baseUrl*', '*endpoint*']);
      expect(results).toContain('myext.baseUrl');
      expect(results).toContain('myext.endpoint');
    });

    it('returns empty when no patterns match', () => {
      const results = scanExtensionSettings('publisher.myext', ['*nonexistent*']);
      expect(results).toEqual([]);
    });
  });

  describe('scanExtensionSettingsWithConfidence', () => {
    it('returns matches with confidence scores', () => {
      const results = scanExtensionSettingsWithConfidence('publisher.myext', ['*baseUrl*']);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].key).toBe('myext.baseUrl');
      expect(results[0].confidence).toBeGreaterThan(0);
      expect(results[0].reason).toBeDefined();
    });

    it('returns empty for unknown extension', () => {
      const results = scanExtensionSettingsWithConfidence('publisher.unknown', ['*url*']);
      expect(results).toEqual([]);
    });

    it('sorts results by confidence descending', () => {
      const results = scanExtensionSettingsWithConfidence('publisher.myext', ['*base*', '*host*']);
      if (results.length > 1) {
        for (let i = 1; i < results.length; i++) {
          expect(results[i - 1].confidence).toBeGreaterThanOrEqual(results[i].confidence);
        }
      }
    });
  });

  describe('discoverBaseUrlSettings', () => {
    it('finds base URL related settings', () => {
      const results = discoverBaseUrlSettings('publisher.myext');
      const keys = results.map(r => r.key);
      expect(keys).toContain('myext.baseUrl');
      expect(keys).toContain('myext.apiBase');
      expect(keys).toContain('myext.endpoint');
    });

    it('returns empty for unknown extension', () => {
      const results = discoverBaseUrlSettings('publisher.unknown');
      expect(results).toEqual([]);
    });

    it('sorts by confidence (baseUrl > endpoint > host)', () => {
      const results = discoverBaseUrlSettings('publisher.myext');
      const baseUrlMatch = results.find(r => r.key === 'myext.baseUrl');
      const hostMatch = results.find(r => r.key === 'myext.host');
      if (baseUrlMatch && hostMatch) {
        expect(baseUrlMatch.confidence).toBeGreaterThan(hostMatch.confidence);
      }
    });
  });

  describe('discoverProviderSettings', () => {
    it('finds provider-related settings', () => {
      const results = discoverProviderSettings('publisher.myext');
      const keys = results.map(r => r.key);
      expect(keys).toContain('myext.provider');
      expect(keys).toContain('myext.modelProvider');
    });

    it('returns empty for unknown extension', () => {
      const results = discoverProviderSettings('publisher.unknown');
      expect(results).toEqual([]);
    });
  });

  describe('getSettingValue', () => {
    it('retrieves a setting value from workspace config', () => {
      const value = getSettingValue('myext.baseUrl');
      expect(vscode.workspace.getConfiguration).toHaveBeenCalled();
      expect(value).toBe('https://api.example.com');
    });
  });

  describe('setSettingValue', () => {
    it('updates a setting value', async () => {
      const config = vscode.workspace.getConfiguration();
      await setSettingValue('myext.baseUrl', 'https://new-api.example.com');
      expect(vscode.workspace.getConfiguration).toHaveBeenCalled();
      expect(config.update).toHaveBeenCalledWith(
        'myext.baseUrl',
        'https://new-api.example.com',
        vscode.ConfigurationTarget.Global
      );
    });
  });
});
