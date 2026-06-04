/**
 * Unit tests for src/core/detection/detectCLIs.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
    })),
  },
}));

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('../../src/config/runtimeSettings', () => ({
  getRuntimeSettings: () => ({
    cliDetectionTimeoutMs: 2000,
  }),
}));

import { execFile } from 'child_process';
import { detectCLIs, detectCli } from '../../src/core/detection/detectCLIs';
import type { AssistantRegistry } from '../../src/core/registry/registryTypes';

const execFileMock = vi.mocked(execFile);
const isWindows = process.platform === 'win32';
const whichCommand = isWindows ? 'where' : 'which';

function mockExecFileSuccess(stdout: string) {
  return (_cmd: string, _args: unknown, _opts: unknown, cb?: Function) => {
    if (cb) {
      cb(null, { stdout });
    }
    return {} as any;
  };
}

function mockExecFileError() {
  return (_cmd: string, _args: unknown, _opts: unknown, cb?: Function) => {
    if (cb) {
      cb(new Error('not found'));
    }
    return {} as any;
  };
}

describe('detectCLIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects CLI commands that exist in PATH', async () => {
    const registry: AssistantRegistry = {
      version: '1.0',
      assistants: [
        {
          key: 'codex',
          displayName: 'Codex CLI',
          kind: 'cli',
          detection: { cliCommands: ['codex'] },
          endpointSwitching: { tier: 'A', dialect: 'openai.responses' },
        } as any,
      ],
    };

    execFileMock.mockImplementation(((
      cmd: string,
      args: string[],
      opts: unknown,
      cb?: Function
    ) => {
      if (cmd === whichCommand && args[0] === 'codex') {
        cb?.(null, { stdout: '/usr/local/bin/codex\n' });
      } else if (cmd === 'codex' && args[0] === '--version') {
        cb?.(null, { stdout: 'codex 1.2.3\n' });
      } else {
        cb?.(new Error('not found'));
      }
      return {} as any;
    }) as any);

    const results = await detectCLIs(registry);
    expect(results).toHaveLength(1);
    expect(results[0].assistantKey).toBe('codex');
    expect(results[0].command).toBe('codex');
    expect(results[0].path).toBe('/usr/local/bin/codex');
    expect(results[0].version).toBe('codex 1.2.3');
  });

  it('returns empty array when CLI is not found', async () => {
    const registry: AssistantRegistry = {
      version: '1.0',
      assistants: [
        {
          key: 'codex',
          displayName: 'Codex CLI',
          kind: 'cli',
          detection: { cliCommands: ['codex'] },
          endpointSwitching: { tier: 'A', dialect: 'openai.responses' },
        } as any,
      ],
    };

    execFileMock.mockImplementation(((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
      cb?.(new Error('not found'));
      return {} as any;
    }) as any);

    const results = await detectCLIs(registry);
    expect(results).toHaveLength(0);
  });

  it('handles missing version gracefully', async () => {
    const registry: AssistantRegistry = {
      version: '1.0',
      assistants: [
        {
          key: 'gemini',
          displayName: 'Gemini CLI',
          kind: 'cli',
          detection: { cliCommands: ['gemini'] },
          endpointSwitching: { tier: 'C', dialect: 'google.gemini.generate_content' },
        } as any,
      ],
    };

    execFileMock.mockImplementation(((cmd: string, args: string[], _opts: unknown, cb?: Function) => {
      if (cmd === whichCommand && args[0] === 'gemini') {
        cb?.(null, { stdout: '/usr/bin/gemini\n' });
      } else {
        cb?.(new Error('no version'));
      }
      return {} as any;
    }) as any);

    const results = await detectCLIs(registry);
    expect(results).toHaveLength(1);
    expect(results[0].version).toBeUndefined();
  });

  it('supports earlyExitTargets optimization', async () => {
    const registry: AssistantRegistry = {
      version: '1.0',
      assistants: [
        {
          key: 'codex',
          displayName: 'Codex CLI',
          kind: 'cli',
          detection: { cliCommands: ['codex'] },
          endpointSwitching: { tier: 'A', dialect: 'openai.responses' },
        } as any,
      ],
    };

    execFileMock.mockImplementation(((cmd: string, args: string[], _opts: unknown, cb?: Function) => {
      if (cmd === whichCommand) {
        cb?.(null, { stdout: '/usr/bin/codex\n' });
      } else {
        cb?.(new Error('no version'));
      }
      return {} as any;
    }) as any);

    const results = await detectCLIs(registry, ['codex']);
    expect(results).toHaveLength(1);
    expect(results[0].assistantKey).toBe('codex');
  });
});

describe('detectCli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when command exists', async () => {
    execFileMock.mockImplementation(((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
      cb?.(null, { stdout: '/usr/bin/node\n' });
      return {} as any;
    }) as any);

    const result = await detectCli('node');
    expect(result).toBe(true);
  });

  it('returns false when command does not exist', async () => {
    execFileMock.mockImplementation(((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
      cb?.(new Error('not found'));
      return {} as any;
    }) as any);

    const result = await detectCli('nonexistent-cli');
    expect(result).toBe(false);
  });
});
