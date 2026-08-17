import { describe, expect, it } from 'vitest';
import {
  buildGlobalStateContent,
  buildProviderSettingsContent,
  getClineConfigPaths,
  parseJsonObject,
  parseJsonObjectForVerification
} from '../../src/adapters/cline/clineConfigPatcher';

describe('Cline config patcher', () => {
  it('resolves the data directory from CLINE_DIR when CLINE_DATA_DIR is absent', () => {
    const originalDataDir = process.env.CLINE_DATA_DIR;
    const originalClineDir = process.env.CLINE_DIR;

    try {
      delete process.env.CLINE_DATA_DIR;
      process.env.CLINE_DIR = '/tmp/cline-home';

      expect(getClineConfigPaths()).toEqual({
        dataDir: '/tmp/cline-home/data',
        globalStatePath: '/tmp/cline-home/data/globalState.json',
        providerSettingsPath: '/tmp/cline-home/data/settings/providers.json'
      });
    } finally {
      if (originalDataDir === undefined) {
        delete process.env.CLINE_DATA_DIR;
      } else {
        process.env.CLINE_DATA_DIR = originalDataDir;
      }
      if (originalClineDir === undefined) {
        delete process.env.CLINE_DIR;
      } else {
        process.env.CLINE_DIR = originalClineDir;
      }
    }
  });

  it('returns empty objects for missing, malformed, or non-object JSON', () => {
    expect(parseJsonObject()).toEqual({});
    expect(parseJsonObject('{not-json')).toEqual({});
    expect(parseJsonObject('[]')).toEqual({});
    expect(parseJsonObject('null')).toEqual({});
  });

  it('rejects missing, malformed, null, and array verification documents', () => {
    expect(parseJsonObjectForVerification()).toBeUndefined();
    expect(parseJsonObjectForVerification('{not-json')).toBeUndefined();
    expect(parseJsonObjectForVerification('null')).toBeUndefined();
    expect(parseJsonObjectForVerification('[]')).toBeUndefined();
    expect(parseJsonObjectForVerification('{"ok":true}')).toEqual({ ok: true });
  });

  it('preserves unrelated provider and global-state fields', () => {
    const providers = JSON.parse(buildProviderSettingsContent(
      'https://gateway.example/v1',
      JSON.stringify({
        version: 1,
        modes: { voiceInput: { providerId: 'anthropic', modelId: 'claude' } },
        lastUsedProvider: 'anthropic',
        providers: {
          anthropic: { settings: { provider: 'anthropic', apiKey: 'keep' } }
        }
      }),
      '2026-08-01T00:00:00.000Z'
    ));
    const globalState = JSON.parse(buildGlobalStateContent(
      'https://gateway.example/v1',
      JSON.stringify({ unrelated: true })
    ));

    expect(providers.providers.anthropic.settings.apiKey).toBe('keep');
    expect(providers.modes.voiceInput).toEqual({ providerId: 'anthropic', modelId: 'claude' });
    expect(providers.lastUsedProvider).toBe('anthropic');
    expect(globalState.unrelated).toBe(true);
  });

  it('rejects unsafe URLs before producing either native document', () => {
    expect(() => buildProviderSettingsContent('javascript:alert(1)')).toThrow('Invalid Cline endpoint URL');
    expect(() => buildGlobalStateContent('data:text/plain,unsafe')).toThrow('Invalid Cline endpoint URL');
  });
});
