/**
 * PR 159 P1 regression: the applier's clear-not-replay removal path must
 * recognize `export GEMINI_API_KEY=...` as the managed GEMINI_API_KEY
 * (dotenv export-prefix semantics). Before the fix, parseDotEnv reported
 * the key as "export GEMINI_API_KEY", so `existingKeys.includes(...)`
 * missed it and a previous profile's credential survived a switch.
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
} = vi.hoisted(() => ({
  mockLogInfo: vi.fn(),
  mockLogDebug: vi.fn(),
  mockLogWarning: vi.fn(),
  mockLogError: vi.fn(),
  mockRecordApply: vi.fn().mockResolvedValue(undefined),
  mockGetSecret: vi.fn<() => Promise<string | undefined>>(),
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
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })) },
  window: { showWarningMessage: vi.fn(), showInformationMessage: vi.fn(), showErrorMessage: vi.fn() },
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

import { PlanApplier } from '../../src/core/orchestration/applier';
import { Plan, PlanStep } from '../../src/core/orchestration/planBuilder';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

let tempDir: string;
let envPath: string;
let applier: PlanApplier;
let profile: EndpointProfile;

function writeEnvFileStep(): PlanStep {
  return {
    id: 'step-write-env',
    action: 'write-env-file',
    description: 'Persist gateway credential to the Gemini CLI env file',
    assistantKey: 'gemini-cli',
    targetPath: envPath,
    data: {
      secretPolicy: 'target-persisted-at-apply',
      missingSecretBehavior: 'remove-managed-key',
      authRef: 'profile-secret',
      profileName: 'Profile B',
      envVarName: 'GEMINI_API_KEY',
    },
    reversible: true,
  };
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-clear-'));
  envPath = path.join(tempDir, '.env');
  for (const spy of [mockLogInfo, mockLogDebug, mockLogWarning, mockLogError, mockRecordApply]) {
    spy.mockReset();
  }
  mockRecordApply.mockResolvedValue(undefined);
  applier = new PlanApplier({} as never);
  profile = {
    id: 'profile-b',
    name: 'Profile B',
    profileType: 'aidome',
    baseUrl: 'https://gateway-b.example.com/v1',
    dialect: 'google.gemini.generate_content',
    createdAt: '2026-11-21T00:00:00.000Z',
    updatedAt: '2026-11-21T00:00:00.000Z',
  };
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function clearPlan(): Plan {
  return {
    id: 'plan-clear-export',
    profileId: profile.id,
    assistantKeys: ['gemini-cli'],
    steps: [writeEnvFileStep()],
    createdAt: '2026-11-21T00:00:00.000Z',
    status: 'pending',
  };
}

describe('applier clear-not-replay with export-prefixed managed keys', () => {
  it('removes a stale `export GEMINI_API_KEY` when the new profile has no credential', async () => {
    await fs.writeFile(envPath, '# user data\nexport GEMINI_API_KEY=TOKEN_OLD\nOTHER=keep\n', 'utf-8');
    mockGetSecret.mockResolvedValue(undefined);

    const result = await applier.applyPlan(clearPlan(), profile.name);

    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).not.toContain('TOKEN_OLD');
    expect(env).not.toContain('GEMINI_API_KEY');
    expect(env).toContain('OTHER=keep');
    expect(env).toContain('# user data');

    const outcome = result.assistantResults.get('gemini-cli');
    expect(outcome?.status).toBe('guided-required');
  });

  it('removes a stale bare `GEMINI_API_KEY` too (regression unchanged)', async () => {
    await fs.writeFile(envPath, 'GEMINI_API_KEY=TOKEN_OLD\nOTHER=keep\n', 'utf-8');
    mockGetSecret.mockResolvedValue(undefined);

    const result = await applier.applyPlan(clearPlan(), profile.name);

    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).not.toContain('TOKEN_OLD');
    expect(env).toContain('OTHER=keep');
    expect(result.assistantResults.get('gemini-cli')?.status).toBe('guided-required');
  });

  it('removes BOTH forms of a duplicated stale key in one pass', async () => {
    await fs.writeFile(
      envPath,
      'GEMINI_API_KEY=TOKEN_A\nOTHER=keep\nexport GEMINI_API_KEY=TOKEN_B\n',
      'utf-8'
    );
    mockGetSecret.mockResolvedValue(undefined);

    await applier.applyPlan(clearPlan(), profile.name);

    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).not.toContain('TOKEN_A');
    expect(env).not.toContain('TOKEN_B');
    expect(env).not.toContain('GEMINI_API_KEY');
    expect(env).toContain('OTHER=keep');
  });

  it('resolves the credential from the profile authRef, not the profile name', async () => {
    await fs.writeFile(envPath, 'GEMINI_API_KEY=TOKEN_OLD\n', 'utf-8');
    mockGetSecret.mockResolvedValue('TOKEN_NEW');

    const result = await applier.applyPlan(clearPlan(), profile.name);

    expect(mockGetSecret).toHaveBeenCalledWith('profile-secret');
    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).toContain('GEMINI_API_KEY=TOKEN_NEW');
    expect(env).not.toContain('TOKEN_OLD');
    expect(result.assistantResults.get('gemini-cli')?.status).toBe('configured');
  });
});
