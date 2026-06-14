/**
 * Proves config patchers still fall back to empty config when
 * the Logger is unavailable (import fails or getInstance throws).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- hoisted mocks ----------
const { mockReadFileSafe, mockWriteFileAtomic, mockCreateBackup, mockFileExists } = vi.hoisted(() => ({
  mockReadFileSafe: vi.fn(),
  mockWriteFileAtomic: vi.fn().mockResolvedValue(true),
  mockCreateBackup: vi.fn().mockResolvedValue('/backup'),
  mockFileExists: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../src/util/fsSafe', () => ({
  readFileSafe: mockReadFileSafe,
  writeFileAtomic: mockWriteFileAtomic,
  createBackup: mockCreateBackup,
  fileExists: mockFileExists,
}));

vi.mock('../../src/util/paths', () => ({
  expandTilde: (p: string) => p.replace('~', '/home/user'),
  getConfigDir: (appName: string) => `/home/user/.${appName.toLowerCase()}`
}));

// Logger always throws — simulates uninitialised or missing logger.
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => { throw new Error('Logger not initialised'); },
  },
}));

vi.mock('../../src/util/jsonc', () => ({
  parseJsonc: (content: string) => JSON.parse(content),
  stringifyJsonc: (obj: unknown, indent: number) => JSON.stringify(obj, null, indent),
}));

vi.mock('../../src/core/profiles/profileValidator', () => ({
  validatePath: () => true,
  validateUrl: () => true,
}));

import { patchContinueConfig } from '../../src/adapters/continue/continueConfigPatcher';
import { patchCodexConfig } from '../../src/adapters/codex/codexConfigPatcher';
import { buildClaudeCodeSettingsContent } from '../../src/adapters/claudeCode/claudeCodeConfigPatcher';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

describe('Config patchers — logger unavailable', () => {
  let profile: EndpointProfile;

  beforeEach(() => {
    vi.clearAllMocks();
    profile = {
      id: 'test',
      name: 'Test',
      baseUrl: 'https://gateway.example.com/v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  it('Continue patcher falls back to empty config on malformed JSON', async () => {
    mockReadFileSafe.mockResolvedValue('{ this is not json !!!');

    await expect(patchContinueConfig(profile, '/path/config.json')).resolves.not.toThrow();
    expect(mockWriteFileAtomic).toHaveBeenCalled();
  });

  it('Codex patcher falls back to empty config on malformed TOML', async () => {
    mockReadFileSafe.mockResolvedValue('this is not valid TOML {{[');

    await expect(patchCodexConfig(profile, '/path/config.toml')).resolves.not.toThrow();
    expect(mockWriteFileAtomic).toHaveBeenCalled();
  });

  it('Claude Code patcher falls back to empty settings on malformed JSONC', async () => {
    const result = buildClaudeCodeSettingsContent(
      'https://gateway.example.com/v1',
      '{ broken jsonc !!!'
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    // Should contain the base URL from the profile
    expect(result).toContain('https://gateway.example.com/v1');
  });
});
