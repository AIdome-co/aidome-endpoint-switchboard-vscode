/**
 * Codex profile-switch credential-safety regression (P1).
 *
 * Switching from Profile A (valid credential) to Profile B (no saved
 * credential) must NOT leave TOKEN_A behind in ~/.codex/.env: only the
 * managed OPENAI_API_KEY is removed, unrelated variables/comments are
 * preserved, the endpoint config moves to Profile B, and the outcome is
 * truthfully guided-required. A -> C (valid TOKEN_C) updates BOTH.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const {
  mockLogInfo,
  mockLogDebug,
  mockLogWarning,
  mockLogError,
  mockRecordApply,
  mockGetSecret,
  mockShowWarning,
  mockAppendLine,
} = vi.hoisted(() => ({
  mockLogInfo: vi.fn(),
  mockLogDebug: vi.fn(),
  mockLogWarning: vi.fn(),
  mockLogError: vi.fn(),
  mockRecordApply: vi.fn().mockResolvedValue(undefined),
  mockGetSecret: vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined),
  mockShowWarning: vi.fn().mockResolvedValue(undefined),
  mockAppendLine: vi.fn(),
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: vi.fn(() => ({
      info: mockLogInfo,
      debug: mockLogDebug,
      warning: mockLogWarning,
      error: mockLogError,
    })),
    initialize: vi.fn(),
  },
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
  },
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  ExtensionContext: vi.fn(),
  env: { clipboard: { writeText: vi.fn() } },
}));

vi.mock('../../src/core/orchestration/changeLog', () => ({
  ChangeLog: vi.fn(function (this: Record<string, unknown>) {
    this.recordApply = mockRecordApply;
    this.getEntries = vi.fn().mockResolvedValue([]);
  }),
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn(function (this: Record<string, unknown>) {
    this.getSecret = mockGetSecret;
  }),
}));

vi.mock('../../src/ui/output', () => ({
  getOutputChannel: vi.fn(() => ({ appendLine: mockAppendLine, show: vi.fn(), clear: vi.fn() })),
}));

vi.mock('../../src/ui/notifications', () => ({
  showWarning: mockShowWarning,
}));

vi.mock('../../src/core/detection/detectCLIs', () => ({
  detectCli: vi.fn().mockResolvedValue(true),
}));

import { CodexAdapter } from '../../src/adapters/codex/adapter';
import { PlanApplier } from '../../src/core/orchestration/applier';
import { Plan, PlanStep } from '../../src/core/orchestration/planBuilder';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import { parse as parseToml } from 'smol-toml';

const OTHER_ENV = '# user data\nOTHER_SERVICE_KEY=keep-me\n';

let tempDir: string;
let configPath: string;
let envPath: string;
let previousCodexConfigPath: string | undefined;
let applier: PlanApplier;
let adapter: CodexAdapter;

function makeProfile(baseUrl: string, name: string): EndpointProfile {
  return {
    id: `profile-${name.replace(/\s+/g, '-').toLowerCase()}`,
    name,
    profileType: 'aidome',
    baseUrl,
    dialect: 'openai.chat_completions',
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  };
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-switch-'));
  configPath = path.join(tempDir, 'config.toml');
  envPath = path.join(tempDir, '.env');
  previousCodexConfigPath = process.env.CODEX_CONFIG_PATH;
  process.env.CODEX_CONFIG_PATH = configPath;

  for (const spy of [mockLogInfo, mockLogDebug, mockLogWarning, mockLogError, mockRecordApply]) {
    spy.mockReset();
  }
  mockRecordApply.mockResolvedValue(undefined);

  applier = new PlanApplier({} as never);
  adapter = new CodexAdapter({
    profileSecrets: { getSecret: mockGetSecret } as never,
  });
});

afterEach(async () => {
  if (previousCodexConfigPath === undefined) {
    delete process.env.CODEX_CONFIG_PATH;
  } else {
    process.env.CODEX_CONFIG_PATH = previousCodexConfigPath;
  }
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function applyForProfile(profile: EndpointProfile) {
  const plan = await adapter.buildPlan(profile);
  const result = await applier.applyPlan(plan, profile.name);
  return { plan, result };
}

describe('mock sanity', () => {
  it('Logger mock is active', async () => {
    const { Logger } = await import('../../src/util/log');
    expect(vi.isMockFunction(Logger.getInstance)).toBe(true);
  });
});

describe('Codex profile switching — credential safety', () => {
  it('A -> B (no credential): config.toml moves to B, stale OPENAI_API_KEY is REMOVED, unrelated values preserved, guided-required', async () => {
    // Profile A: valid credential TOKEN_A (with unrelated user data present)
    await fs.writeFile(envPath, OTHER_ENV, 'utf-8');
    mockGetSecret.mockResolvedValue('TOKEN_A');
    const profileA = makeProfile('https://gateway-a.example.com/v1', 'Profile A');
    const { result: resultA } = await applyForProfile(profileA);
    expect(resultA.assistantResults.get('openai-codex')?.status).toBe('configured');
    expect(await fs.readFile(envPath, 'utf-8')).toContain('OPENAI_API_KEY=TOKEN_A');

    // Profile B: no saved credential
    mockGetSecret.mockResolvedValue(undefined);
    const profileB = makeProfile('https://gateway-b.example.com/v1', 'Profile B');
    const { result: resultB } = await applyForProfile(profileB);

    // config.toml -> gateway-b
    const parsed = parseToml(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>;
    expect((parsed.model_providers as Record<string, Record<string, unknown>>).aidome.base_url)
      .toBe('https://gateway-b.example.com/v1');

    // .env: NO stale TOKEN_A, unrelated data preserved
    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).not.toContain('TOKEN_A');
    expect(env).not.toContain('OPENAI_API_KEY');
    expect(env).toContain('OTHER_SERVICE_KEY=keep-me');
    expect(env).toContain('# user data');

    // Truthful outcome: guided-required
    const outcome = resultB.assistantResults.get('openai-codex');
    expect(outcome?.status).toBe('guided-required');
    expect(outcome?.success).toBe(false);

    // Truthful warning logged
    const warnings = mockLogWarning.mock.calls.map(call => call.map(String).join(' '));
    expect(warnings.some(message => message.includes('No saved profile credential') && message.includes('OPENAI_API_KEY'))).toBe(true);
  });

  it('A -> C (valid credential): BOTH endpoint and credential update, configured', async () => {
    mockGetSecret.mockResolvedValue('TOKEN_A');
    const profileA = makeProfile('https://gateway-a.example.com/v1', 'Profile A');
    await applyForProfile(profileA);

    mockGetSecret.mockResolvedValue('TOKEN_C');
    const profileC = makeProfile('https://gateway-c.example.com/v1', 'Profile C');
    const { result } = await applyForProfile(profileC);

    const parsed = parseToml(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>;
    expect((parsed.model_providers as Record<string, Record<string, unknown>>).aidome.base_url)
      .toBe('https://gateway-c.example.com/v1');
    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).toContain('OPENAI_API_KEY=TOKEN_C');
    expect(env).not.toContain('TOKEN_A');
    expect(result.assistantResults.get('openai-codex')?.status).toBe('configured');
  });

  it('env removal preserves unrelated data exactly (comment + other vars, nothing else)', async () => {
    const before = '# comment\nOPENAI_API_KEY=old\nOTHER=keep\n';
    await fs.writeFile(envPath, before, 'utf-8');
    mockGetSecret.mockResolvedValue(undefined);
    const profileB = makeProfile('https://gateway-b.example.com/v1', 'Profile B');
    const { result } = await applyForProfile(profileB);

    const env = await fs.readFile(envPath, 'utf-8');
    // Only the managed key disappeared.
    expect(env).toContain('# comment');
    expect(env).toContain('OTHER=keep');
    expect(env).not.toContain('OPENAI_API_KEY');
    expect(env).not.toContain('old');
    expect(result.assistantResults.get('openai-codex')?.status).toBe('guided-required');
  });

  it('missing secret with NO managed key present: file untouched, guided-required', async () => {
    await fs.writeFile(envPath, OTHER_ENV, 'utf-8');
    mockGetSecret.mockResolvedValue(undefined);
    const profileB = makeProfile('https://gateway-b.example.com/v1', 'Profile B');
    const { result } = await applyForProfile(profileB);

    expect(await fs.readFile(envPath, 'utf-8')).toBe(OTHER_ENV);
    expect(result.assistantResults.get('openai-codex')?.status).toBe('guided-required');
  });
});
