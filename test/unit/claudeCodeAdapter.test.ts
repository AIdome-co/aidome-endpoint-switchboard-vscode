/**
 * Unit tests for Claude Code adapter.
 */

import * as nodePath from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeCodeAdapter } from '../../src/adapters/claudeCode/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as detectCLIs from '../../src/core/detection/detectCLIs';
import * as fsSafe from '../../src/util/fsSafe';

const mockExtension = {
  packageJSON: {}
};

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn()
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
      update: vi.fn()
    }))
  },
  ConfigurationTarget: {
    Global: 1
  }
}));

vi.mock('../../src/core/detection/detectCLIs');
vi.mock('../../src/util/fsSafe');
vi.mock('../../src/util/paths', () => ({
  expandTilde: (path: string) => path.replace('~', '/home/user'),
  getConfigDir: (appName: string) => `/home/user/.${appName.toLowerCase()}`
}));
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    })
  }
}));

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;
  let mockProfile: EndpointProfile;
  let previousClaudeConfigDir: string | undefined;

  beforeEach(() => {
    previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    adapter = new ClaudeCodeAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      baseUrl: 'https://aidome.example.com/v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
    vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);
    vi.spyOn(fsSafe, 'createBackup').mockResolvedValue('/home/user/.claude/settings.json.backup');
    vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);
  });

  afterEach(() => {
    if (previousClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
    }
  });

  describe('detect', () => {
    it('should return true when VSCode extension is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('anthropic.claude-code');
    });

    it('should return true when CLI is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(detectCLIs.detectCli).toHaveBeenCalledWith('claude');
    });

    it('should return false when neither extension nor CLI is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const result = await adapter.detect();

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(() => {
        throw new Error('Test error');
      });

      const result = await adapter.detect();

      expect(result).toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('should let the applier own backup creation when settings exist', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{ "env": { "EXISTING_VAR": "kept" } }');

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('claude-code');
      expect(plan.steps.find(s => s.action === 'backup-file')).toBeUndefined();
      expect(plan.steps.find(s => s.action === 'edit-config-file')?.reversible).toBe(true);
    });

    it('should create a plan without backup step when settings do not exist', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.find(s => s.action === 'backup-file')).toBeUndefined();
    });

    it('should include patched settings content in edit-config-file step', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const editStep = plan.steps.find(s => s.action === 'edit-config-file');
      expect(editStep).toBeDefined();
      expect(editStep?.targetPath).toBe('/home/user/.claude/settings.json');
      expect(editStep?.data.format).toBe('json');
      expect(editStep?.data.configBuilder).toBe('claude-code-settings');
      expect(editStep?.data.envVars).toContain('ANTHROPIC_AUTH_TOKEN');

      const updatedSettings = JSON.parse(editStep?.newValue as string);
      expect(updatedSettings.env.ANTHROPIC_BASE_URL).toBe(mockProfile.baseUrl);
      expect(updatedSettings.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY).toBe('1');
      expect(updatedSettings.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(updatedSettings.env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it('should include VS Code login prompt setting and auth guidance', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const settingStep = plan.steps.find(s => s.action === 'set-vscode-setting');
      expect(settingStep?.targetPath).toBe('claudeCode.disableLoginPrompt');
      expect(settingStep?.newValue).toBe(true);

      const authStep = plan.steps.find(s => s.action === 'show-guided-steps');
      expect(authStep?.description).toBe('Show Claude Code profile-switch notes');
      expect(authStep?.data.tier).toBe('A');
      expect(authStep?.data.optional).toBe(true);
      expect(authStep?.data.envVarName).toBe('ANTHROPIC_AUTH_TOKEN');
    });

    it('should respect CLAUDE_CONFIG_DIR in plan targets and guidance', async () => {
      process.env.CLAUDE_CONFIG_DIR = '~/custom-claude';

      const plan = await adapter.buildPlan(mockProfile);
      const expectedConfigPath = nodePath.join('/home/user/custom-claude', 'settings.json');

      const editStep = plan.steps.find(s => s.action === 'edit-config-file');
      expect(editStep?.targetPath).toBe(expectedConfigPath);

      const authStep = plan.steps.find(s => s.action === 'show-guided-steps');
      const guidanceSteps = authStep?.data.steps as string[];
      expect(guidanceSteps[0]).toContain(expectedConfigPath);
    });

    it('should include verify-endpoint step', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const verifyStep = plan.steps.find(s => s.action === 'verify-endpoint');
      expect(verifyStep?.assistantKey).toBe('claude-code');
    });
  });

  describe('apply', () => {
    it('should create a backup before writing existing settings', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);
      const plan = await adapter.buildPlan(mockProfile);

      await adapter.apply(plan);

      expect(fsSafe.createBackup).toHaveBeenCalledWith('/home/user/.claude/settings.json');
      expect(fsSafe.writeFileAtomic).toHaveBeenCalled();
    });

    it('should throw when backup fails', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'createBackup').mockResolvedValue(undefined);
      const plan = await adapter.buildPlan(mockProfile);

      await expect(adapter.apply(plan)).rejects.toThrow('Failed to create backup');
    });
  });

  describe('verify', () => {
    it('should return success when installed and base URL is configured', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: mockProfile.baseUrl,
          ANTHROPIC_AUTH_TOKEN: 'aid_pat_test',
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1'
        }
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
      expect(result.details?.baseUrlConfigured).toBe(true);
      expect(result.details?.authTokenConfigured).toBe(true);
    });

    it('should return failure when the managed Anthropic auth token is missing', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: mockProfile.baseUrl,
          CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1'
        }
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('ANTHROPIC_AUTH_TOKEN');
    });

    it('should return failure when neither extension nor CLI is installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not installed');
    });

    it('should return failure when settings file does not exist', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('settings file not found');
    });

    it('should return failure when base URL is missing', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({ env: {} }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('ANTHROPIC_BASE_URL');
    });

    it('should return failure when configured base URL is invalid', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'javascript:alert(1)'
        }
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('invalid ANTHROPIC_BASE_URL');
    });

    it('should handle errors gracefully', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(() => {
        throw new Error('Test error');
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying');
    });
  });

  describe('getDisplayName', () => {
    it('should return correct display name', () => {
      expect(adapter.getDisplayName()).toBe('Claude Code');
    });
  });

  describe('getTier', () => {
    it('should return tier A', () => {
      expect(adapter.getTier()).toBe('A');
    });
  });
});
