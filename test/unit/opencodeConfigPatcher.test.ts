/**
 * Unit tests for the OpenCode config patcher.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OPENCODE_PROVIDER_ID,
  buildOpenCodeConfigContent,
  parseOpenCodeConfigForVerification,
  patchOpenCodeConfig
} from '../../src/adapters/opencode/opencodeConfigPatcher';
import { normalizeOpenAiBaseUrl } from '../../src/core/providerConfig/endpointUrl';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as fsSafe from '../../src/util/fsSafe';

vi.mock('../../src/util/fsSafe');
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    })
  }
}));

describe('opencodeConfigPatcher', () => {
  const gatewayUrl = 'https://aidome.example.com/v1';
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      profileType: 'aidome',
      dialect: 'openai.chat_completions',
      baseUrl: gatewayUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
  });

  describe('buildOpenCodeConfigContent', () => {
    it('builds the legacy provider.<id> shape on an empty document', () => {
      const content = buildOpenCodeConfigContent(gatewayUrl);
      const parsed = JSON.parse(content);

      expect(parsed.$schema).toBeUndefined();
      expect(parsed.provider.aidome.npm).toBe('@ai-sdk/openai-compatible');
      expect(parsed.provider.aidome.name).toBe('AIdome Gateway');
      expect(parsed.provider.aidome.options.baseURL).toBe(gatewayUrl);
      expect(parsed.provider.aidome.options.apiKey).toBeUndefined();
    });

    it('does not double-append /v1 when the gateway URL already ends with it', () => {
      const content = buildOpenCodeConfigContent('https://aidome.example.com/v1');
      const parsed = JSON.parse(content);
      expect(parsed.provider.aidome.options.baseURL).toBe('https://aidome.example.com/v1');
      expect(parsed.provider.aidome.options.baseURL).not.toContain('/v1/v1');
    });

    it('appends /v1 exactly once for a root gateway URL', () => {
      const content = buildOpenCodeConfigContent('https://aidome.example.com');
      const parsed = JSON.parse(content);
      expect(parsed.provider.aidome.options.baseURL).toBe(normalizeOpenAiBaseUrl('https://aidome.example.com'));
    });

    it('writes the API key only into options.apiKey', () => {
      const content = buildOpenCodeConfigContent(gatewayUrl, undefined, { apiKey: 'aid_pat_TEST' });
      const parsed = JSON.parse(content);
      expect(parsed.provider.aidome.options.apiKey).toBe('aid_pat_TEST');
      const serialized = Object.keys(parsed);
      expect(serialized).not.toContain('apiKey');
    });

    it('removes a stale managed API key when no credential is provided', () => {
      const existing = JSON.stringify({
        provider: {
          aidome: {
            npm: '@ai-sdk/openai-compatible',
            options: { baseURL: 'https://old.example.com/v1', apiKey: 'aid_pat_OLD' }
          }
        }
      });

      const content = buildOpenCodeConfigContent(gatewayUrl, existing);
      const parsed = JSON.parse(content);
      expect(parsed.provider.aidome.options.apiKey).toBeUndefined();
      expect(parsed.provider.aidome.options.baseURL).toBe(gatewayUrl);
    });

    it('merges a discovered model into the managed models map without dropping prior models', () => {
      const existing = JSON.stringify({
        provider: {
          aidome: {
            npm: '@ai-sdk/openai-compatible',
            options: { baseURL: gatewayUrl },
            models: { 'old-model': {} }
          }
        }
      });

      const content = buildOpenCodeConfigContent(gatewayUrl, existing, { model: 'new-model' });
      const parsed = JSON.parse(content);
      expect(Object.keys(parsed.provider.aidome.models).sort()).toEqual(['new-model', 'old-model']);
    });

    it('preserves unrelated providers and top-level fields', () => {
      const existing = JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        theme: 'dark',
        provider: {
          anthropic: { options: { apiKey: 'user-key' } },
          aidome: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'https://old.example.com/v1' } }
        }
      });

      const content = buildOpenCodeConfigContent(gatewayUrl, existing, { apiKey: 'aid_pat_TEST' });
      const parsed = JSON.parse(content);
      expect(parsed.$schema).toBe('https://opencode.ai/config.json');
      expect(parsed.theme).toBe('dark');
      expect(parsed.provider.anthropic).toEqual({ options: { apiKey: 'user-key' } });
      expect(parsed.provider.aidome.options.baseURL).toBe(gatewayUrl);
    });

    it('fails closed on a malformed existing config', () => {
      expect(() => buildOpenCodeConfigContent(gatewayUrl, '{ not json')).toThrow(/parse error|root must be a JSON object/);
    });

    it('rejects invalid endpoint URLs', () => {
      expect(() => buildOpenCodeConfigContent('javascript:alert(1)')).toThrow(/Invalid OpenCode endpoint URL/);
    });
  });

  describe('parseOpenCodeConfigForVerification', () => {
    it('parses valid documents', () => {
      const parsed = parseOpenCodeConfigForVerification('{"provider":{}}');
      expect(parsed.provider).toEqual({});
    });

    it('throws on non-object roots', () => {
      expect(() => parseOpenCodeConfigForVerification('[]')).toThrow(/root must be a JSON object/);
    });
  });

  describe('patchOpenCodeConfig', () => {
    beforeEach(() => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);
      vi.spyOn(fsSafe, 'createBackup').mockResolvedValue('/tmp/backup');
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);
    });

    it('creates a backup before modifying an existing file', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{"provider":{}}');

      await patchOpenCodeConfig(mockProfile, '/home/user/.config/opencode/opencode.json', { apiKey: 'aid_pat_TEST' });

      expect(fsSafe.createBackup).toHaveBeenCalledWith('/home/user/.config/opencode/opencode.json');
      expect(fsSafe.writeFileAtomic).toHaveBeenCalledTimes(1);
    });

    it('writes without a backup when the file does not exist yet', async () => {
      await patchOpenCodeConfig(mockProfile, '/home/user/.config/opencode/opencode.json');

      expect(fsSafe.createBackup).not.toHaveBeenCalled();
      expect(fsSafe.writeFileAtomic).toHaveBeenCalledWith(
        '/home/user/.config/opencode/opencode.json',
        expect.stringContaining(OPENCODE_PROVIDER_ID)
      );
    });

    it('throws when the backup cannot be created', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{"provider":{}}');
      vi.spyOn(fsSafe, 'createBackup').mockResolvedValue(undefined);

      await expect(
        patchOpenCodeConfig(mockProfile, '/home/user/.config/opencode/opencode.json')
      ).rejects.toThrow(/Failed to create backup/);
      expect(fsSafe.writeFileAtomic).not.toHaveBeenCalled();
    });

    it('throws when the atomic write fails', async () => {
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(false);

      await expect(
        patchOpenCodeConfig(mockProfile, '/home/user/.config/opencode/opencode.json')
      ).rejects.toThrow(/Failed to write OpenCode config/);
    });
  });
});
