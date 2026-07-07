/**
 * Unit tests for Kilo Code config patcher.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  patchKiloConfig,
  getKiloConfigPath,
  buildKiloConfigContent
} from '../../src/adapters/kilocode/kiloConfigPatcher';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as fsSafe from '../../src/util/fsSafe';

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

  beforeEach(() => {
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      baseUrl: 'https://aidome.example.com/v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
  });

  describe('getKiloConfigPath', () => {
    it('should return the correct config path', () => {
      const path = getKiloConfigPath();
      expect(path).toContain('.config/kilo/kilo.jsonc');
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