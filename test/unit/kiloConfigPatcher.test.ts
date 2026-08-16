/**
 * Unit tests for Kilo Code config patcher.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import {
  patchKiloConfig,
  getKiloConfigPath,
  buildKiloConfigContent,
  buildModelEntries,
  discoverModels,
  inspectKiloConfigContent
} from '../../src/adapters/kilocode/kiloConfigPatcher';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as fsSafe from '../../src/util/fsSafe';

/**
 * Mutable mock-state for the `os` module. We mock the whole module via
 * vi.mock because Node's `os.platform` is non-configurable in ESM, which
 * makes vi.spyOn throw "Cannot redefine property: platform".
 */
const mockOs = {
  platform: 'linux',
  homedir: '/home/testuser'
};

vi.mock('os', () => ({
  platform: () => mockOs.platform,
  homedir: () => mockOs.homedir
}));

vi.mock('../../src/util/fsSafe');
vi.mock('../../src/util/paths', () => ({
  getConfigDir: vi.fn(() => '/home/user/.config/kilo')
}));
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

describe('Kilo Config Patcher', () => {
  let mockProfile: EndpointProfile;
  let originalAppData: string | undefined;
  let originalXdgConfigHome: string | undefined;
  let originalKiloConfigDir: string | undefined;
  let originalKiloConfig: string | undefined;

  beforeEach(() => {
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      baseUrl: 'https://aidome.example.com/v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
    mockOs.platform = 'linux';
    mockOs.homedir = '/home/testuser';
    originalAppData = process.env.APPDATA;
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
    originalKiloConfigDir = process.env.KILO_CONFIG_DIR;
    originalKiloConfig = process.env.KILO_CONFIG;
  });

  afterEach(() => {
    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
    if (originalKiloConfigDir === undefined) {
      delete process.env.KILO_CONFIG_DIR;
    } else {
      process.env.KILO_CONFIG_DIR = originalKiloConfigDir;
    }
    if (originalKiloConfig === undefined) {
      delete process.env.KILO_CONFIG;
    } else {
      process.env.KILO_CONFIG = originalKiloConfig;
    }
  });

  describe('getKiloConfigPath', () => {
    it('returns APPDATA-based path on win32', () => {
      mockOs.platform = 'win32';
      process.env.APPDATA = 'C:\\Users\\testuser\\AppData\\Roaming';

      expect(getKiloConfigPath()).toBe(
        path.join('C:\\Users\\testuser\\AppData\\Roaming', 'Kilo', 'kilo.jsonc')
      );
    });

    it('falls back to homedir when APPDATA is unset on win32', () => {
      mockOs.platform = 'win32';
      delete process.env.APPDATA;

      expect(getKiloConfigPath()).toBe(
        path.join('/home/testuser', 'AppData', 'Roaming', 'Kilo', 'kilo.jsonc')
      );
    });

    it('returns Library/Application Support path on darwin', () => {
      mockOs.platform = 'darwin';

      expect(getKiloConfigPath()).toBe(
        path.join('/home/testuser', 'Library', 'Application Support', 'kilo', 'kilo.jsonc')
      );
    });

    it('honors XDG_CONFIG_HOME when set on linux', () => {
      mockOs.platform = 'linux';
      process.env.XDG_CONFIG_HOME = '/custom/config';

      expect(getKiloConfigPath()).toBe(
        path.join('/custom/config', 'kilo', 'kilo.jsonc')
      );
    });

    it('falls back to ~/.config/kilo on linux when XDG_CONFIG_HOME is unset', () => {
      mockOs.platform = 'linux';
      delete process.env.XDG_CONFIG_HOME;

      expect(getKiloConfigPath()).toBe(
        path.join('/home/testuser', '.config', 'kilo', 'kilo.jsonc')
      );
    });

    it('uses KILO_CONFIG_DIR as the upstream global config directory override', () => {
      process.env.KILO_CONFIG_DIR = '/managed/kilo-config';

      expect(getKiloConfigPath()).toBe(path.join('/managed/kilo-config', 'kilo.jsonc'));
    });

    it('uses KILO_CONFIG when an explicit config file is selected', () => {
      process.env.KILO_CONFIG = '/managed/explicit.jsonc';

      expect(getKiloConfigPath()).toBe('/managed/explicit.jsonc');
    });
  });

  describe('buildKiloConfigContent', () => {
    it('should create a minimal config when no existing content', () => {
      const result = buildKiloConfigContent('https://gateway.example.com/v1');

      const parsed = JSON.parse(result);
      expect(parsed.provider['aidome-gateway']).toBeDefined();
      expect(parsed.provider['aidome-gateway'].name).toBe('AIdome Gateway');
      expect(parsed.provider['aidome-gateway'].npm).toBe('@ai-sdk/openai-compatible');
      expect(parsed.provider['aidome-gateway'].options.baseURL).toBe('https://gateway.example.com/v1');
    });

    it('should preserve existing fields when provider already exists', () => {
      const existing = JSON.stringify({
        $schema: 'https://app.kilo.ai/config.json',
        provider: {
          'aidome-gateway': {
            name: 'maort-gateway',
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://old-url:8100/v1',
              headers: { 'custom-header': 'value' }
            },
            models: {
              'testing-dp-ordered': { name: 'testing-dp-ordered' }
            }
          }
        },
        permission: { bash: 'allow' }
      });

      const result = buildKiloConfigContent('https://new-gateway.example.com/v1', existing);
      const parsed = JSON.parse(result);

      // baseURL should be updated
      expect(parsed.provider['aidome-gateway'].options.baseURL).toBe('https://new-gateway.example.com/v1');
      // Existing fields preserved
      expect(parsed.provider['aidome-gateway'].name).toBe('maort-gateway');
      expect(parsed.provider['aidome-gateway'].options.headers).toEqual({ 'custom-header': 'value' });
      expect(parsed.provider['aidome-gateway'].models['testing-dp-ordered'].name).toBe('testing-dp-ordered');
      // Other sections preserved
      expect(parsed.$schema).toBe('https://app.kilo.ai/config.json');
      expect(parsed.permission.bash).toBe('allow');
    });

    it('preserves upstream-compatible model entries that omit optional names', () => {
      const existing = JSON.stringify({
        provider: {
          'aidome-gateway': {
            options: { baseURL: 'https://old-gateway.example.com/v1' },
            models: { 'unnamed-model': { vision: true } }
          }
        }
      });

      const result = buildKiloConfigContent(
        'https://new-gateway.example.com/v1',
        existing,
        undefined,
        buildModelEntries(['discovered-model'])
      );
      const provider = JSON.parse(result).provider['aidome-gateway'];

      expect(provider.models['unnamed-model']).toEqual({ vision: true });
      expect(provider.models['discovered-model']).toEqual({ name: 'discovered-model' });
    });

    it('does not serialize the SecretStorage API key and preserves native auth references', () => {
      const existing = JSON.stringify({
        provider: {
          'aidome-gateway': {
            options: {
              apiKey: '{env:OPENAI_API_KEY}',
              headers: { 'X-Tenant': 'engineering' }
            },
            models: {
              'manual-model': { name: 'Manual model', reasoning: true }
            }
          }
        }
      });

      const result = buildKiloConfigContent(
        'https://new-gateway.example.com/v1',
        existing,
        'profile-secret',
        buildModelEntries(['discovered-model', 'manual-model'])
      );
      const parsed = JSON.parse(result);
      const provider = parsed.provider['aidome-gateway'];

      expect(result).not.toContain('profile-secret');
      expect(provider.options.apiKey).toBe('{env:OPENAI_API_KEY}');
      expect(provider.options.headers).toEqual({ 'X-Tenant': 'engineering' });
      expect(provider.models['manual-model']).toEqual({ name: 'Manual model', reasoning: true });
      expect(provider.models['discovered-model']).toEqual({ name: 'discovered-model' });
    });

    it('creates a schema-compatible provider with discovered models and no plaintext auth', () => {
      const result = buildKiloConfigContent(
        'https://gateway.example.com/v1',
        undefined,
        'profile-secret',
        buildModelEntries(['gpt-4'])
      );
      const provider = JSON.parse(result).provider['aidome-gateway'];

      expect(provider).toEqual({
        name: 'AIdome Gateway',
        npm: '@ai-sdk/openai-compatible',
        options: { baseURL: 'https://gateway.example.com/v1' },
        models: { 'gpt-4': { name: 'gpt-4' } }
      });
      expect(result).not.toContain('OPENAI_API_KEY=');
      expect(result).not.toContain('profile-secret');
    });

    it('should add new provider alongside existing unrelated providers', () => {
      const existing = JSON.stringify({
        provider: {
          'existing-provider': {
            name: 'Existing',
            npm: '@ai-sdk/openai-compatible',
            options: { baseURL: 'https://existing.example.com' }
          }
        }
      });

      const result = buildKiloConfigContent('https://new-gateway.example.com/v1', existing);
      const parsed = JSON.parse(result);

      expect(parsed.provider['aidome-gateway']).toBeDefined();
      expect(parsed.provider['aidome-gateway'].options.baseURL).toBe('https://new-gateway.example.com/v1');
      // Existing provider preserved
      expect(parsed.provider['existing-provider']).toBeDefined();
      expect(parsed.provider['existing-provider'].options.baseURL).toBe('https://existing.example.com');
    });

    it('should handle empty config gracefully', () => {
      const result = buildKiloConfigContent('https://gateway.example.com/v1', '{}');
      const parsed = JSON.parse(result);
      expect(parsed.provider['aidome-gateway'].options.baseURL).toBe('https://gateway.example.com/v1');
    });

    it('should handle invalid JSONC gracefully', () => {
      // Should not throw, should create fresh config
      const result = buildKiloConfigContent('https://gateway.example.com/v1', 'not valid json{{{');
      const parsed = JSON.parse(result);
      expect(parsed.provider['aidome-gateway'].options.baseURL).toBe('https://gateway.example.com/v1');
    });
  });

  describe('patchKiloConfig', () => {
    it('should write new config when file does not exist', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

      await patchKiloConfig(mockProfile, '/path/to/kilo.jsonc');

      expect(fsSafe.writeFileAtomic).toHaveBeenCalled();
      const writtenContent = (fsSafe.writeFileAtomic as any).mock.calls[0][1];
      expect(writtenContent).toContain('aidome-gateway');
      expect(writtenContent).toContain(mockProfile.baseUrl);
    });

    it('should update existing config preserving other fields', async () => {
      const existing = JSON.stringify({
        provider: {
          'other-provider': { name: 'Other', npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://other.com' } }
        }
      });

      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(existing);
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

      await patchKiloConfig(mockProfile, '/path/to/kilo.jsonc');

      const writtenContent = (fsSafe.writeFileAtomic as any).mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed.provider['aidome-gateway'].options.baseURL).toBe(mockProfile.baseUrl);
      expect(parsed.provider['other-provider'].options.baseURL).toBe('https://other.com');
    });
  });

  describe('discoverModels', () => {
    it('uses the upstream /models path with bearer auth and returns unique sorted IDs', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'z-model' },
            { id: ' a-model ' },
            { id: 'z-model' },
            { id: 42 },
            {}
          ]
        })
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(discoverModels('https://gateway.example.com/v1', ' secret-token ')).resolves.toEqual([
        'a-model',
        'z-model'
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://gateway.example.com/v1/models',
        expect.objectContaining({
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer secret-token'
          }
        })
      );
    });

    it('returns an empty list for invalid URLs, failed responses, malformed payloads, and fetch errors', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: false, json: vi.fn() })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'not-an-array' } }) })
        .mockRejectedValueOnce(new Error('network failure'));
      vi.stubGlobal('fetch', fetchMock);

      await expect(discoverModels('javascript:alert(1)', 'secret-token')).resolves.toEqual([]);
      await expect(discoverModels('https://gateway.example.com/v1', 'secret-token')).resolves.toEqual([]);
      await expect(discoverModels('https://gateway.example.com/v1', 'secret-token')).resolves.toEqual([]);
      await expect(discoverModels('https://gateway.example.com/v1', 'secret-token')).resolves.toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('inspectKiloConfigContent', () => {
    it('recognizes the native provider, models, base URL, and auth reference', () => {
      expect(inspectKiloConfigContent(`{
        // Kilo accepts JSONC comments.
        "provider": {
          "aidome-gateway": {
            "options": { "baseURL": "https://gateway.example.com/v1", "apiKey": "{env:OPENAI_API_KEY}" },
            "env": ["OPENAI_API_KEY"],
            "models": { "gpt-4": { "name": "GPT-4" } }
          }
        }
      }`)).toEqual({
        hasProvider: true,
        baseUrl: 'https://gateway.example.com/v1',
        modelCount: 1,
        hasAuthReference: true
      });
    });

    it('rejects malformed JSONC and unsupported provider shapes', () => {
      expect(inspectKiloConfigContent('{not-json')).toBeUndefined();
      expect(inspectKiloConfigContent('{ "provider": [] }')).toEqual({
        hasProvider: false,
        modelCount: 0,
        hasAuthReference: false
      });
    });
  });
});
