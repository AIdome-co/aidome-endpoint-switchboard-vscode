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

/**
 * Two-step production path (Codex PR 159 round N P1): the base-URL
 * edit-config-file step creates a MISSING env file, and the following
 * write-env-file step preserves whatever mode that file has. Creating it
 * with default permissions left GEMINI_API_KEY in a 0644 file forever.
 * The applier must create dotenv-var targets 0600.
 */
function baseUrlStep(): PlanStep {
  return {
    id: 'step-base-url',
    action: 'edit-config-file',
    description: 'Write GOOGLE_GEMINI_BASE_URL to the Gemini CLI env file',
    assistantKey: 'gemini-cli',
    targetPath: envPath,
    data: {
      driver: 'dotenv-var',
      envVarName: 'GOOGLE_GEMINI_BASE_URL',
      baseUrl: profile.baseUrl,
    },
    reversible: true,
  };
}

function twoStepPlan(): Plan {
  return {
    id: 'plan-two-step',
    profileId: profile.id,
    assistantKeys: ['gemini-cli'],
    steps: [baseUrlStep(), writeEnvFileStep()],
    createdAt: '2026-11-27T00:00:00.000Z',
    status: 'pending',
  };
}

describe.skipIf(process.platform === 'win32')('dotenv-var creation permissions in the two-step path', () => {
  it('creates a missing env file 0600 when the credential follows in the next step', async () => {
    mockGetSecret.mockResolvedValue('TOKEN_NEW');

    const result = await applier.applyPlan(twoStepPlan(), profile.name);

    expect(result.assistantResults.get('gemini-cli')?.status).toBe('configured');
    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).toContain('GOOGLE_GEMINI_BASE_URL=https://gateway-b.example.com/v1');
    expect(env).toContain('GEMINI_API_KEY=TOKEN_NEW');
    expect((await fs.stat(envPath)).mode & 0o777).toBe(0o600);
  });

  it('does not narrow an existing env file that was already writable by the user', async () => {
    await fs.writeFile(envPath, 'OTHER=keep\n', { mode: 0o644 });
    await fs.chmod(envPath, 0o644);
    mockGetSecret.mockResolvedValue('TOKEN_NEW');

    await applier.applyPlan(twoStepPlan(), profile.name);

    expect((await fs.stat(envPath)).mode & 0o777).toBe(0o644);
    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).toContain('OTHER=keep');
    expect(env).toContain('GEMINI_API_KEY=TOKEN_NEW');
  });
});
