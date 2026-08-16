/**
 * Unit tests for Codex config.toml patching.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildCodexConfigContent,
  getCodexConfigPath,
  patchCodexConfig
} from '../../src/adapters/codex/codexConfigPatcher';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as fsSafe from '../../src/util/fsSafe';

vi.mock('../../src/util/fsSafe');
vi.mock('../../src/util/paths', () => ({
  expandTilde: (filePath: string) => filePath.replace('~', '/home/user')
}));

describe('Codex Config Patcher', () => {
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
    vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);
  });

  function writtenContent(): string {
    const call = vi.mocked(fsSafe.writeFileAtomic).mock.calls[0];
    expect(call).toBeDefined();
    return call![1];
  }

  describe('getCodexConfigPath', () => {
    it('returns the user-level Codex config path', () => {
      expect(getCodexConfigPath()).toBe('/home/user/.codex/config.toml');
    });
  });

  describe('patchCodexConfig', () => {
    it('writes the current model_providers schema without inventing a model', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);

      await patchCodexConfig(mockProfile, '/path/to/config.toml');

      const content = writtenContent();
      expect(content).toContain('model_provider = "aidome"');
      expect(content).toContain('[model_providers.aidome]');
      expect(content).toContain('name = "AIdome Gateway"');
      expect(content).toContain(`base_url = "${mockProfile.baseUrl}"`);
      expect(content).toContain('wire_api = "responses"');
      expect(content).not.toContain('[providers.aidome]');
      expect(content).not.toContain('model = "gpt-4"');
      expect(content).not.toContain('api_key');
    });

    it('preserves existing model and current provider entries', async () => {
      const existingConfig = `
model_provider = "existing"
model = "custom-model"

[model_providers.existing]
name = "Existing provider"
base_url = "https://existing.example.com/v1"
wire_api = "responses"
`;
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(existingConfig);

      await patchCodexConfig(mockProfile, '/path/to/config.toml');

      const content = writtenContent();
      expect(content).toContain('model = "custom-model"');
      expect(content).toContain('[model_providers.existing]');
      expect(content).toContain('name = "Existing provider"');
      expect(content).toContain('[model_providers.aidome]');
      expect(content).toContain('model_provider = "aidome"');
    });

    it('migrates the legacy Switchboard providers table while preserving entries', async () => {
      const existingConfig = `
model = "existing-model"

[providers.legacy]
base_url = "https://legacy.example.com/v1"
wire_api = "responses"
`;
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(existingConfig);

      await patchCodexConfig(mockProfile, '/path/to/config.toml');

      const content = writtenContent();
      expect(content).toContain('model = "existing-model"');
      expect(content).toContain('[model_providers.legacy]');
      expect(content).toContain('name = "legacy"');
      expect(content).not.toContain('[providers.legacy]');
    });

    it('preserves selected-provider fields such as env_key while updating only routing fields', async () => {
      const existingConfig = `
[model_providers.aidome]
name = "Old AIdome name"
env_key = "AIDOME_TOKEN"
api_key = "legacy-plaintext-key"
request_max_retries = 2
base_url = "https://old.example.com/v1"
`;
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(existingConfig);

      await patchCodexConfig(mockProfile, '/path/to/config.toml');

      const content = writtenContent();
      expect(content).toContain('name = "AIdome Gateway"');
      expect(content).toContain('env_key = "AIDOME_TOKEN"');
      expect(content).toContain('request_max_retries = 2');
      expect(content).toContain(`base_url = "${mockProfile.baseUrl}"`);
      expect(content).toContain('wire_api = "responses"');
      expect(content).not.toContain('api_key');
      expect(content).not.toContain('legacy-plaintext-key');
    });

    it('adds Codex env_key guidance without writing the profile secret', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);

      await patchCodexConfig(mockProfile, '/path/to/config.toml', 'OPENAI_API_KEY');

      const content = writtenContent();
      expect(content).toContain('env_key = "OPENAI_API_KEY"');
      expect(content).not.toContain('experimental_bearer_token');
      expect(content).not.toContain('api_key');
    });

    it('does not overwrite malformed config', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('this is not valid TOML {{[');

      await expect(patchCodexConfig(mockProfile, '/path/to/config.toml'))
        .rejects.toThrow('not valid TOML');
      expect(fsSafe.writeFileAtomic).not.toHaveBeenCalled();
    });

    it('rejects unsafe endpoint URLs before writing', async () => {
      const invalidProfile = { ...mockProfile, baseUrl: 'file:///tmp/secret' };
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);

      await expect(patchCodexConfig(invalidProfile, '/path/to/config.toml'))
        .rejects.toThrow('base URL');
      expect(fsSafe.writeFileAtomic).not.toHaveBeenCalled();
    });

    it('rejects malformed existing provider tables', () => {
      expect(() => buildCodexConfigContent(
        mockProfile.baseUrl,
        'model_providers = "not a table"'
      )).toThrow('model_providers');
    });
  });
});
