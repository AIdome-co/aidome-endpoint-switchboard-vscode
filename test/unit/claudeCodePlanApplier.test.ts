/**
 * Production-path tests for applying Claude Code plans through PlanApplier.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as vscode from 'vscode';
import { createEnoentError } from './testErrors';

const {
  mockReadFileSafe,
  mockFileExists,
  mockSafeWriteFile,
  mockCreateBackup,
  mockGetConfig,
  mockUpdateConfig,
  mockRecordApply,
  mockAccess,
  mockReadFile,
  mockUnlink,
  mockGetSecret,
  mockShowWarningMessage,
} = vi.hoisted(() => ({
  mockReadFileSafe: vi.fn(),
  mockFileExists: vi.fn(),
  mockSafeWriteFile: vi.fn(),
  mockCreateBackup: vi.fn(),
  mockGetConfig: vi.fn(),
  mockUpdateConfig: vi.fn(),
  mockRecordApply: vi.fn(),
  mockAccess: vi.fn(),
  mockReadFile: vi.fn(),
  mockUnlink: vi.fn(),
  mockGetSecret: vi.fn(),
  mockShowWarningMessage: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: mockGetConfig,
      update: mockUpdateConfig,
    })),
  },
  extensions: {
    getExtension: vi.fn(),
  },
  ConfigurationTarget: { Global: 1 },
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: mockShowWarningMessage,
  },
}));

vi.mock('fs/promises', () => ({
  access: mockAccess,
  readFile: mockReadFile,
  unlink: mockUnlink,
}));

vi.mock('../../src/util/fsSafe', () => ({
  readFileSafe: mockReadFileSafe,
  fileExists: mockFileExists,
  safeWriteFile: mockSafeWriteFile,
  createBackup: mockCreateBackup,
  writeFileAtomic: vi.fn(),
}));

vi.mock('../../src/util/paths', () => ({
  expandTilde: (path: string) => path.replace('~', '/home/user'),
  getConfigDir: (appName: string) => `/home/user/.${appName.toLowerCase()}`
}));

vi.mock('../../src/core/detection/detectCLIs', () => ({
  detectCli: vi.fn(),
}));

vi.mock('../../src/ui/output', () => ({
  getOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn(), clear: vi.fn() })),
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    })),
    initialize: vi.fn(),
  },
}));

vi.mock('../../src/core/orchestration/changeLog', () => ({
  ChangeLog: vi.fn(function (this: Record<string, unknown>) {
    this.recordApply = mockRecordApply;
    this.getEntries = vi.fn().mockResolvedValue([]);
  }),
}));

import { ClaudeCodeAdapter } from '../../src/adapters/claudeCode/adapter';
import { PlanApplier } from '../../src/core/orchestration/applier';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

const profile: EndpointProfile = {
  id: 'claude-profile',
  name: 'Claude Profile',
  baseUrl: 'https://gateway.example.com/v1',
  authRef: 'Claude Profile',
  createdAt: '2026-05-13T00:00:00.000Z',
  updatedAt: '2026-05-13T00:00:00.000Z',
};

describe('Claude Code plan application through PlanApplier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSafe.mockResolvedValue(undefined);
    mockFileExists.mockResolvedValue(false);
    mockSafeWriteFile.mockResolvedValue(true);
    mockCreateBackup.mockResolvedValue('/home/user/.claude/settings.json.backup');
    mockGetConfig.mockReturnValue(undefined);
    mockUpdateConfig.mockResolvedValue(undefined);
    mockRecordApply.mockResolvedValue(undefined);
    mockAccess.mockRejectedValue(createEnoentError());
    mockReadFile.mockResolvedValue('{}');
    mockUnlink.mockResolvedValue(undefined);
    mockGetSecret.mockResolvedValue('aid_pat_test');
    mockShowWarningMessage.mockResolvedValue(undefined);
  });

  it('applies a Claude Code plan without failing on the verification step', async () => {
    const adapter = new ClaudeCodeAdapter();
    const plan = await adapter.buildPlan(profile);
    const applier = new PlanApplier({
      secrets: { get: mockGetSecret }
    } as unknown as vscode.ExtensionContext);

    const result = await applier.applyPlan(plan, profile.name);

    expect(result.success).toBe(true);
    expect(result.failedSteps).toHaveLength(0);
    expect(plan.steps.map(step => step.action)).toContain('verify-endpoint');
    expect(mockSafeWriteFile).toHaveBeenCalledWith(
      '/home/user/.claude/settings.json',
      expect.stringContaining('"ANTHROPIC_BASE_URL": "https://gateway.example.com/v1"')
    );
    expect(mockSafeWriteFile).toHaveBeenCalledWith(
      '/home/user/.claude/settings.json',
      expect.stringContaining('"ANTHROPIC_AUTH_TOKEN": "aid_pat_test"')
    );
    expect(mockSafeWriteFile).toHaveBeenCalledWith(
      '/home/user/.claude/settings.json',
      expect.not.stringContaining('ANTHROPIC_API_KEY')
    );
    expect(mockUpdateConfig).toHaveBeenCalledWith('claudeCode.disableLoginPrompt', true, 1);
    expect(mockRecordApply).toHaveBeenCalledTimes(1);
  });

  it('deletes a newly-created Claude Code settings file when a later step fails', async () => {
    const adapter = new ClaudeCodeAdapter();
    const plan = await adapter.buildPlan(profile);
    const applier = new PlanApplier({
      secrets: { get: mockGetSecret }
    } as unknown as vscode.ExtensionContext);
    mockUpdateConfig.mockRejectedValueOnce(new Error('settings update failed'));

    const result = await applier.applyPlan(plan, profile.name);

    expect(result.success).toBe(false);
    expect(mockUnlink).toHaveBeenCalledWith('/home/user/.claude/settings.json');
    expect(mockRecordApply).not.toHaveBeenCalled();
  });

  it('clears stale Claude Code auth state and warns when the active profile secret is missing', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://old.example.com/v1',
        ANTHROPIC_API_KEY: 'stale-key'
      }
    }));
    mockGetSecret.mockResolvedValue(undefined);

    const adapter = new ClaudeCodeAdapter();
    const plan = await adapter.buildPlan(profile);
    const applier = new PlanApplier({
      secrets: { get: mockGetSecret }
    } as unknown as vscode.ExtensionContext);

    const result = await applier.applyPlan(plan, profile.name);

    expect(result.success).toBe(true);
    expect(mockSafeWriteFile).toHaveBeenCalledWith(
      '/home/user/.claude/settings.json',
      expect.not.stringContaining('stale-key')
    );
    expect(mockSafeWriteFile).toHaveBeenCalledWith(
      '/home/user/.claude/settings.json',
      expect.not.stringContaining('ANTHROPIC_API_KEY')
    );
    expect(mockSafeWriteFile).toHaveBeenCalledWith(
      '/home/user/.claude/settings.json',
      expect.not.stringContaining('ANTHROPIC_AUTH_TOKEN')
    );
    expect(mockShowWarningMessage).toHaveBeenCalledWith(
      'Claude Code auth token was cleared for "Claude Profile" because no saved profile secret was found.'
    );
  });
});
