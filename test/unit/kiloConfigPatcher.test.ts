/**
 * Unit tests for Kilo Code config patcher.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import {
  patchKiloConfig,
  getKiloConfigPath,
  buildKiloConfigContent
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
});