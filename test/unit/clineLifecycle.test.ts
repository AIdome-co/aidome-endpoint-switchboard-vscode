/**
 * Application and rollback coverage for Cline's native file-backed plan.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ClineAdapter } from '../../src/adapters/cline/adapter';
import { PlanApplier } from '../../src/core/orchestration/applier';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

const {
  mockOutputChannel,
  mockLoggerDebug,
  mockLoggerError,
  mockLoggerInfo,
  mockLoggerWarning
} = vi.hoisted(() => ({
  mockOutputChannel: {
    appendLine: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn()
  },
  mockLoggerDebug: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarning: vi.fn()
}));

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn()
  },
  window: {
    createOutputChannel: vi.fn(() => mockOutputChannel),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn()
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
      update: vi.fn()
    }))
  },
  env: {
    clipboard: {
      writeText: vi.fn()
    }
  }
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      debug: mockLoggerDebug,
      error: mockLoggerError,
      info: mockLoggerInfo,
      warning: mockLoggerWarning
    })
  }
}));

describe('Cline native plan lifecycle', () => {
  let temporaryDataDir: string;
  let adapter: ClineAdapter;
  let profile: EndpointProfile;
  let context: {
    globalState: {
      get: <T>(key: string, defaultValue: T) => T;
      update: (key: string, value: unknown) => Promise<void>;
    };
    secrets: {
      get: () => Promise<undefined>;
    };
  };
  const originalDataDir = process.env.CLINE_DATA_DIR;

  beforeEach(async () => {
    temporaryDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cline-switchboard-'));
    process.env.CLINE_DATA_DIR = temporaryDataDir;
    adapter = new ClineAdapter();
    profile = {
      id: 'profile-1',
      name: 'Profile 1',
      profileType: 'custom',
      baseUrl: 'https://gateway.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const state = new Map<string, unknown>();
    context = {
      globalState: {
        get: <T>(key: string, defaultValue: T): T => (state.has(key) ? state.get(key) as T : defaultValue),
        update: async (key: string, value: unknown): Promise<void> => {
          state.set(key, value);
        }
      },
      secrets: {
        get: async (): Promise<undefined> => undefined
      }
    };

    mockOutputChannel.appendLine.mockClear();
    mockOutputChannel.clear.mockClear();
    mockOutputChannel.show.mockClear();
    mockLoggerDebug.mockClear();
    mockLoggerError.mockClear();
    mockLoggerInfo.mockClear();
    mockLoggerWarning.mockClear();

    await fs.mkdir(path.join(temporaryDataDir, 'settings'), { recursive: true });
    await fs.writeFile(path.join(temporaryDataDir, 'settings', 'providers.json'), JSON.stringify({
      version: 1,
      modes: {},
      lastUsedProvider: 'anthropic',
      providers: {
        anthropic: {
          settings: { provider: 'anthropic', apiKey: 'unrelated-provider-secret' },
          updatedAt: '2026-08-01T00:00:00.000Z',
          tokenSource: 'manual'
        },
        'openai-compatible': {
          settings: {
            provider: 'openai-compatible',
            apiKey: 'existing-cline-key',
            model: 'existing-model',
            baseUrl: 'https://old.example/v1'
          },
          updatedAt: '2026-08-01T00:00:00.000Z',
          tokenSource: 'manual'
        }
      }
    }, null, 2));
    await fs.writeFile(path.join(temporaryDataDir, 'globalState.json'), JSON.stringify({
      unrelated: { keep: true },
      openAiBaseUrl: 'https://old.example/v1',
      planModeApiProvider: 'anthropic',
      actModeApiProvider: 'anthropic'
    }, null, 2));
  });

  afterEach(async () => {
    if (originalDataDir === undefined) {
      delete process.env.CLINE_DATA_DIR;
    } else {
      process.env.CLINE_DATA_DIR = originalDataDir;
    }
    await fs.rm(temporaryDataDir, { recursive: true, force: true });
  });

  it('applies both native edits and verifies the resulting Cline route', async () => {
    const plan = await adapter.buildPlan(profile);
    const applier = new PlanApplier(context as never);

    const result = await applier.applyPlan(plan, profile.name);

    expect(result.success).toBe(true);
    expect(result.assistantResults.get('cline')).toEqual({ success: true });
    await expect(adapter.verify()).resolves.toMatchObject({ success: true });

    const providers = JSON.parse(await fs.readFile(
      path.join(temporaryDataDir, 'settings', 'providers.json'),
      'utf8'
    )) as { providers: Record<string, { settings: Record<string, unknown> }> };
    expect(providers.providers.anthropic.settings.apiKey).toBe('unrelated-provider-secret');
    expect(providers.providers['openai-compatible'].settings).toMatchObject({
      provider: 'openai-compatible',
      baseUrl: profile.baseUrl,
      apiKey: 'existing-cline-key',
      model: 'existing-model'
    });
  });

  it('restores both native files from backups during rollback/reset', async () => {
    const providerPath = path.join(temporaryDataDir, 'settings', 'providers.json');
    const globalStatePath = path.join(temporaryDataDir, 'globalState.json');
    const originalProviderContent = await fs.readFile(providerPath, 'utf8');
    const originalGlobalStateContent = await fs.readFile(globalStatePath, 'utf8');
    const plan = await adapter.buildPlan(profile);
    const applier = new PlanApplier(context as never);

    const result = await applier.applyPlan(plan, profile.name);
    expect(result.success).toBe(true);
    expect(result.changeLogEntry.steps.some((step) => Boolean(step.backupPath))).toBe(true);

    await applier.rollbackPlan(result.changeLogEntry.id);

    expect(await fs.readFile(providerPath, 'utf8')).toBe(originalProviderContent);
    expect(await fs.readFile(globalStatePath, 'utf8')).toBe(originalGlobalStateContent);
    expect(context.globalState.get('aidome.changeLog', [])).toEqual([]);
  });
});
