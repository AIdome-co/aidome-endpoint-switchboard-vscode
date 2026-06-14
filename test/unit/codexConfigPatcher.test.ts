/**
 * Unit tests for Codex config patcher.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { patchCodexConfig, getCodexConfigPath } from '../../src/adapters/codex/codexConfigPatcher';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as fsSafe from '../../src/util/fsSafe';
import { Logger } from '../../src/util/log';

vi.mock('../../src/util/fsSafe');
vi.mock('../../src/util/paths', () => ({
  expandTilde: (path: string) => path.replace('~', '/home/user')
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
  });

  describe('getCodexConfigPath', () => {
    it('should return the correct config path', () => {
      const path = getCodexConfigPath();
      expect(path).toContain('.codex/config.toml');
    });
  });

  describe('patchCodexConfig', () => {
    it('should create new config when file does not exist', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

      await patchCodexConfig(mockProfile, '/path/to/config.toml');

      expect(fsSafe.writeFileAtomic).toHaveBeenCalled();
      const writtenContent = (fsSafe.writeFileAtomic as any).mock.calls[0][1];
      
      expect(writtenContent).toContain('[providers.aidome]');
      expect(writtenContent).toContain(`base_url = "${mockProfile.baseUrl}"`);
      expect(writtenContent).toContain('wire_api = "responses"');
      expect(writtenContent).toContain('model_provider = "aidome"');
    });

    it('should update existing config', async () => {
      const existingConfig = `
model_provider = "openai"
model = "gpt-3.5-turbo"

[providers.openai]
base_url = "https://api.openai.com/v1"
`;
      
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(existingConfig);
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

      await patchCodexConfig(mockProfile, '/path/to/config.toml');

      expect(fsSafe.writeFileAtomic).toHaveBeenCalled();
      const writtenContent = (fsSafe.writeFileAtomic as any).mock.calls[0][1];
      
      expect(writtenContent).toContain('[providers.aidome]');
      expect(writtenContent).toContain(`base_url = "${mockProfile.baseUrl}"`);
      expect(writtenContent).toContain('model_provider = "aidome"');
      expect(writtenContent).toContain('[providers.openai]'); // Should preserve existing provider
    });

    it('should set default model if not present', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

      await patchCodexConfig(mockProfile, '/path/to/config.toml');

      const writtenContent = (fsSafe.writeFileAtomic as any).mock.calls[0][1];
      expect(writtenContent).toContain('model = "gpt-4"');
    });

    it('should preserve existing model', async () => {
      const existingConfig = `
model = "custom-model"
`;
      
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(existingConfig);
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

      await patchCodexConfig(mockProfile, '/path/to/config.toml');

      const writtenContent = (fsSafe.writeFileAtomic as any).mock.calls[0][1];
      expect(writtenContent).toContain('model = "custom-model"');
    });

    it('should handle invalid TOML gracefully', async () => {
      const invalidConfig = 'this is not valid TOML {{[';
      
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(invalidConfig);
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

      // Should not throw, should create new config
      await patchCodexConfig(mockProfile, '/path/to/config.toml');

      expect(fsSafe.writeFileAtomic).toHaveBeenCalled();
      const writtenContent = (fsSafe.writeFileAtomic as any).mock.calls[0][1];
      expect(writtenContent).toContain('[providers.aidome]');
    });


    it('should fall back for malformed config when logging fails', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('this is not valid TOML {{[');
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);
      vi.mocked(Logger.getInstance).mockImplementationOnce(() => {
        throw new Error('logger unavailable');
      });

      await expect(patchCodexConfig(mockProfile, '/path/to/config.toml')).resolves.toBeUndefined();

      expect(fsSafe.writeFileAtomic).toHaveBeenCalled();
      const writtenContent = vi.mocked(fsSafe.writeFileAtomic).mock.calls[0][1];
      expect(writtenContent).toContain('[providers.aidome]');
    });

    it('should set wire_api to responses', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

      await patchCodexConfig(mockProfile, '/path/to/config.toml');

      const writtenContent = (fsSafe.writeFileAtomic as any).mock.calls[0][1];
      expect(writtenContent).toContain('wire_api = "responses"');
    });
  });
});
