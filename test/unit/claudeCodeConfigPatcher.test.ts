/**
 * Unit tests for Claude Code config patcher.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as pathModule from 'path';
import {
  buildClaudeCodeSettingsContent,
  getClaudeCodeSettingsPath,
  patchClaudeCodeConfig
} from '../../src/adapters/claudeCode/claudeCodeConfigPatcher';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as fsSafe from '../../src/util/fsSafe';

vi.mock('../../src/util/fsSafe');
vi.mock('../../src/util/paths', () => ({
  expandTilde: (path: string) => path.replace('~', '/home/user')
}));

describe('Claude Code Config Patcher', () => {
  let mockProfile: EndpointProfile;
  let previousClaudeConfigDir: string | undefined;

  beforeEach(() => {
    previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      baseUrl: 'https://aidome.example.com/v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
    vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);
    vi.spyOn(fsSafe, 'createBackup').mockResolvedValue('/path/to/settings.json.backup');
  });

  afterEach(() => {
    if (previousClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
    }
  });

  describe('getClaudeCodeSettingsPath', () => {
    it('should return the shared Claude Code settings path', () => {
      const path = getClaudeCodeSettingsPath();

      expect(path).toBe('/home/user/.claude/settings.json');
    });

    it('should respect CLAUDE_CONFIG_DIR when set', () => {
      process.env.CLAUDE_CONFIG_DIR = '~/custom-claude';

      const path = getClaudeCodeSettingsPath();

      expect(path).toBe(pathModule.join('/home/user/custom-claude', 'settings.json'));
    });

    it('should ignore unsafe CLAUDE_CONFIG_DIR values', () => {
      process.env.CLAUDE_CONFIG_DIR = '../unsafe';

      const path = getClaudeCodeSettingsPath();

      expect(path).toBe('/home/user/.claude/settings.json');
    });
  });

  describe('buildClaudeCodeSettingsContent', () => {
    it('should create settings with gateway env vars when file does not exist', () => {
      const updated = buildClaudeCodeSettingsContent(mockProfile);
      const parsed = JSON.parse(updated);

      expect(parsed.env.ANTHROPIC_BASE_URL).toBe(mockProfile.baseUrl);
      expect(parsed.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY).toBe('1');
    });

    it('should preserve existing settings and env vars', () => {
      const existing = JSON.stringify({
        permissions: { allow: ['Bash(git status)'] },
        env: { EXISTING_VAR: 'kept' }
      });

      const updated = buildClaudeCodeSettingsContent(mockProfile, existing);
      const parsed = JSON.parse(updated);

      expect(parsed.permissions.allow).toEqual(['Bash(git status)']);
      expect(parsed.env.EXISTING_VAR).toBe('kept');
      expect(parsed.env.ANTHROPIC_BASE_URL).toBe(mockProfile.baseUrl);
    });

    it('should replace non-object env with a valid env object', () => {
      const updated = buildClaudeCodeSettingsContent(mockProfile, '{ "env": ["bad"] }');
      const parsed = JSON.parse(updated);

      expect(parsed.env).toEqual({
        ANTHROPIC_BASE_URL: mockProfile.baseUrl,
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1'
      });
    });

    it('should handle invalid JSON gracefully', () => {
      const updated = buildClaudeCodeSettingsContent(mockProfile, 'not valid json');
      const parsed = JSON.parse(updated);

      expect(parsed.env.ANTHROPIC_BASE_URL).toBe(mockProfile.baseUrl);
    });

    it('should not write plaintext auth tokens', () => {
      const updated = buildClaudeCodeSettingsContent(mockProfile);

      expect(updated).not.toContain('ANTHROPIC_AUTH_TOKEN');
      expect(updated).not.toContain('ANTHROPIC_API_KEY');
    });

    it('should reject unsafe endpoint URLs before writing settings', () => {
      mockProfile.baseUrl = 'javascript:alert(1)';

      expect(() => buildClaudeCodeSettingsContent(mockProfile)).toThrow('Invalid Claude Code endpoint URL');
    });
  });

  describe('patchClaudeCodeConfig', () => {
    it('should read, patch, and write settings', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{ "env": { "EXISTING_VAR": "kept" } }');
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

      await patchClaudeCodeConfig(mockProfile, '/path/to/settings.json');

      expect(fsSafe.writeFileAtomic).toHaveBeenCalled();
      const writtenContent = (fsSafe.writeFileAtomic as any).mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(parsed.env.EXISTING_VAR).toBe('kept');
      expect(parsed.env.ANTHROPIC_BASE_URL).toBe(mockProfile.baseUrl);
    });


    it('should create a backup before patching existing settings', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{ "env": {} }');
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

      await patchClaudeCodeConfig(mockProfile, '/path/to/settings.json');

      expect(fsSafe.createBackup).toHaveBeenCalledWith('/path/to/settings.json');
      expect(fsSafe.writeFileAtomic).toHaveBeenCalled();
    });

    it('should fail when backup of existing settings cannot be created', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'createBackup').mockResolvedValue(undefined);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{ "env": {} }');

      await expect(patchClaudeCodeConfig(mockProfile, '/path/to/settings.json')).rejects.toThrow('Failed to create backup');
    });

    it('should fail when atomic write returns false', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{ "env": {} }');
      vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(false);

      await expect(patchClaudeCodeConfig(mockProfile, '/path/to/settings.json')).rejects.toThrow(
        'Failed to write Claude Code settings to /path/to/settings.json'
      );
    });
  });
});
