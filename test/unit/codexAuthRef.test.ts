/**
 * P1 regression: Codex must use the profile's real `authRef` as the
 * SecretStorage lookup identity — `profile.name` only as a fallback and for
 * human-readable messages. When name !== authRef, looking the secret up by
 * name would falsely report a missing credential and (with
 * missingSecretBehavior = 'remove-managed-key') strip a VALID key.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const {
  mockGetSecret,
  mockLogInfo,
  mockLogDebug,
  mockLogWarning,
  mockLogError,
  mockRecordApply,
  mockShowWarning,
  mockAppendLine,
} = vi.hoisted(() => ({
  mockGetSecret: vi.fn<() => Promise<string | undefined>>(),
  mockLogInfo: vi.fn(),
  mockLogDebug: vi.fn(),
  mockLogWarning: vi.fn(),
  mockLogError: vi.fn(),
  mockRecordApply: vi.fn().mockResolvedValue(undefined),
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

const sharedMockConfig = {
  get: vi.fn(),
  update: vi.fn(),
  inspect: vi.fn()
};

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => sharedMockConfig),
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

let tempDir: string;
let configPath: string;
let envPath: string;
let previousCodexConfigPath: string | undefined;
let applier: PlanApplier;
let adapter: CodexAdapter;

function makeProfile(overrides: Partial<EndpointProfile> = {}): EndpointProfile {
  return {
    id: 'profile-prod',
    name: 'Production',
    profileType: 'aidome',
    baseUrl: 'https://gateway-a.example.com/v1',
    dialect: 'openai.chat_completions',
    authRef: 'prod-token-secret',
    ...overrides,
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  } as EndpointProfile;
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-authref-'));
  configPath = path.join(tempDir, 'config.toml');
  envPath = path.join(tempDir, '.env');
  previousCodexConfigPath = process.env.CODEX_CONFIG_PATH;
  process.env.CODEX_CONFIG_PATH = configPath;

  for (const spy of [mockLogInfo, mockLogDebug, mockLogWarning, mockLogError, mockRecordApply, mockShowWarning]) {
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

describe('Codex authRef identity', () => {
  it('uses profile.authRef (not profile.name) for the secret lookup; name !== authRef', async () => {
    // SecretStorage: 'prod-token-secret' -> TOKEN_PROD; 'Production' NOT present.
    mockGetSecret.mockImplementation(async (ref: string) =>
      ref === 'prod-token-secret' ? 'TOKEN_PROD' : undefined);

    const profile = makeProfile();
    const plan = await adapter.buildPlan(profile);
    const result = await applier.applyPlan(plan, profile.name);

    // Lookup went to the authRef, never to the profile name.
    const lookups = mockGetSecret.mock.calls.map(call => call[0]);
    expect(lookups).toContain('prod-token-secret');
    expect(lookups).not.toContain('Production');

    // The credential was written and the key was NOT removed.
    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).toContain('OPENAI_API_KEY=TOKEN_PROD');
    expect(result.assistantResults.get('openai-codex')?.status).toBe('configured');
  });

  it('plan carries authRef only — the secret never enters the plan', async () => {
    mockGetSecret.mockImplementation(async (ref: string) =>
      ref === 'prod-token-secret' ? 'TOKEN_PROD' : undefined);

    const profile = makeProfile();
    const plan = await adapter.buildPlan(profile);
    const serialized = JSON.stringify(plan);

    const envStep = plan.steps.find(step => step.action === 'write-env-file');
    expect(envStep?.data.authRef).toBe('prod-token-secret');
    expect(envStep?.data.profileName).toBe('Production');
    expect(serialized).not.toContain('TOKEN_PROD');
  });

  it('falls back to profile.name only when authRef is absent', async () => {
    mockGetSecret.mockImplementation(async (ref: string) =>
      ref === 'Legacy Name' ? 'TOKEN_LEGACY' : undefined);

    const profile = makeProfile({ name: 'Legacy Name', authRef: undefined });
    const plan = await adapter.buildPlan(profile);
    const envStep = plan.steps.find(step => step.action === 'write-env-file');
    expect(envStep?.data.authRef).toBe('Legacy Name');

    await applier.applyPlan(plan, profile.name);
    expect(await fs.readFile(envPath, 'utf-8')).toContain('OPENAI_API_KEY=TOKEN_LEGACY');
  });

  it('A -> B stale-key cleanup with DISTINCT name/authRef pairs: B removes only the managed key, guided-required', async () => {
    // Profile A: name A, authRef secret-a
    mockGetSecret.mockImplementation(async (ref: string) => ref === 'secret-a' ? 'TOKEN_A' : undefined);
    await fs.writeFile(envPath, 'OTHER=keep\n', 'utf-8');
    const profileA = makeProfile({ id: 'pa', name: 'A', authRef: 'secret-a', baseUrl: 'https://gateway-a.example.com/v1' });
    const resultA = await applier.applyPlan(await adapter.buildPlan(profileA), profileA.name);
    expect(resultA.assistantResults.get('openai-codex')?.status).toBe('configured');
    expect(await fs.readFile(envPath, 'utf-8')).toContain('OPENAI_API_KEY=TOKEN_A');

    // Profile B: name B, authRef secret-b (missing)
    mockGetSecret.mockImplementation(async () => undefined);
    const profileB = makeProfile({ id: 'pb', name: 'B', authRef: 'secret-b', baseUrl: 'https://gateway-b.example.com/v1' });
    const resultB = await applier.applyPlan(await adapter.buildPlan(profileB), profileB.name);

    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).not.toContain('TOKEN_A');
    expect(env).not.toContain('OPENAI_API_KEY');
    expect(env).toContain('OTHER=keep');
    expect(resultB.assistantResults.get('openai-codex')?.status).toBe('guided-required');
  });

  it('A -> C with DISTINCT name/authRef: both endpoint and credential update, configured', async () => {
    mockGetSecret.mockImplementation(async (ref: string) => ref === 'secret-a' ? 'TOKEN_A' : undefined);
    await fs.writeFile(envPath, 'OTHER=keep\n', 'utf-8');
    const profileA = makeProfile({ id: 'pa', name: 'A', authRef: 'secret-a', baseUrl: 'https://gateway-a.example.com/v1' });
    await applier.applyPlan(await adapter.buildPlan(profileA), profileA.name);

    mockGetSecret.mockImplementation(async (ref: string) => ref === 'secret-c' ? 'TOKEN_C' : undefined);
    const profileC = makeProfile({ id: 'pc', name: 'C', authRef: 'secret-c', baseUrl: 'https://gateway-c.example.com/v1' });
    const resultC = await applier.applyPlan(await adapter.buildPlan(profileC), profileC.name);

    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).toContain('OPENAI_API_KEY=TOKEN_C');
    expect(env).not.toContain('TOKEN_A');
    expect(env).toContain('OTHER=keep');
    expect(resultC.assistantResults.get('openai-codex')?.status).toBe('configured');
  });
});

function makeStepEnv(targetPath: string): Array<Omit<PlanStep, 'id'>> {
  return [
    {
      action: 'write-env-file',
      description: 'Persist credential',
      assistantKey: 'openai-codex',
      targetPath,
      data: {
        secretPolicy: 'target-persisted-at-apply',
        missingSecretBehavior: 'remove-managed-key',
        authRef: 'secret-a',
        profileName: 'A',
        envVarName: 'OPENAI_API_KEY'
      },
      reversible: true
    }
  ];
}

describe('write-env-file applied-mode mapping and rollback safety', () => {
  it('GAP 4: a write-env-file-only mutation persists appliedMode env', async () => {
    const saveMapping = vi.fn().mockResolvedValue(undefined);
    const { Switchboard } = await import('../../src/core/orchestration/switchboard');
    const switchboard = new Switchboard(
      {} as never,
      { assistants: [], dialectCatalog: {} } as never,
      {
        getProfiles: vi.fn().mockResolvedValue([{ id: 'p1', name: 'A' }]),
        saveAssistantMapping: saveMapping,
        getAssistantMappings: vi.fn().mockResolvedValue([])
      } as never,
      { getSecret: async () => undefined } as never
    );
    const store = new Map<string, unknown>();
    (switchboard['applier'] as unknown as { context: unknown }).context = {
      globalState: {
        get: (key: string, d?: unknown) => store.has(key) ? store.get(key) : d,
        update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); }
      }
    };
    (switchboard['applier'] as unknown as { profileSecrets: unknown }).profileSecrets = {
      getSecret: async () => 'TOKEN_X'
    };

    const plan: Plan = {
      id: 'plan-env-only',
      profileId: 'p1',
      assistantKeys: ['assist-env'],
      steps: makeStepEnv(path.join(tempDir, 'only.env')).map(step => ({
        ...step,
        id: 'step-env',
        assistantKey: 'assist-env'
      })),
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    await switchboard.applyPlan(plan);
    expect(saveMapping).toHaveBeenCalledWith(expect.objectContaining({
      assistantKey: 'assist-env',
      appliedMode: 'env'
    }));
  });

  it('GAP 5: rollback skips mutationApplied=false steps (no spurious config.update revert)', async () => {
    const { createPlan } = await import('../../src/core/orchestration/planBuilder');
    const plan = createPlan('p1', ['assist-x']);
    plan.steps.push({
      id: 's1',
      action: 'set-vscode-setting',
      description: 'unregistered setting',
      assistantKey: 'assist-x',
      targetPath: 'legacy.unregistered',
      newValue: 'https://gw.example.com',
      data: { scope: 'global' },
      reversible: true
    });
    plan.steps.push({
      id: 's2',
      action: 'edit-config-file',
      description: 'force failure',
      assistantKey: 'assist-x',
      targetPath: path.join(tempDir, 'missing-dir', 'nope.json'),
      data: { configPath: path.join(tempDir, 'missing-dir', 'nope.json'), configType: 't', driver: 'json-object', format: 'json' },
      reversible: true
    });

    // The unregistered-setting rejection for step s1.
    updateSpyRef.mockRejectedValueOnce(new Error("It is not possible to register a configuration 'legacy.unregistered' because it is not a registered configuration"));

    const result = await applier.applyPlan(plan, 'A');
    expect(result.success).toBe(false);

    // Rollback must NOT have attempted a revert of the skipped setting.
    const revertCalls = updateSpyRef.mock.calls.filter(call => call[0] === 'legacy.unregistered' && call[1] === undefined);
    expect(revertCalls).toHaveLength(0);
  });

  it('rollback still restores a real (mutationApplied=true) setting on later failure', async () => {
    const { createPlan } = await import('../../src/core/orchestration/planBuilder');
    updateSpyRef.mockReset();
    updateSpyRef.mockResolvedValue(undefined);

    const plan = createPlan('p1', ['assist-x']);
    plan.steps.push({
      id: 's1',
      action: 'set-vscode-setting',
      description: 'registered setting',
      assistantKey: 'assist-x',
      targetPath: 'registered.setting',
      newValue: 'https://gw.example.com',
      data: { scope: 'global' },
      reversible: true
    });
    plan.steps.push({
      id: 's2',
      action: 'edit-config-file',
      description: 'force failure',
      assistantKey: 'assist-x',
      targetPath: path.join(tempDir, 'missing-dir', 'nope.json'),
      data: { configPath: path.join(tempDir, 'missing-dir', 'nope.json'), configType: 't', driver: 'json-object', format: 'json' },
      reversible: true
    });

    await applier.applyPlan(plan, 'A');

    // First call: the real write with the new value; second: the rollback
    // reverting to undefined (oldValue) for the SAME setting key.
    const calls = updateSpyRef.mock.calls;
    expect(calls[0][0]).toBe('registered.setting');
    const revert = calls.find(call => call[0] === 'registered.setting' && call[1] === undefined);
    expect(revert).toBeDefined();
  });

  it('stale-key removal is transactional: a later failure restores OPENAI_API_KEY=TOKEN_A from backup', async () => {
    // Step 1: write-env-file with removal of the managed key (no secret).
    // Step 2: a failing step forces group rollback -> backup restore.
    await fs.writeFile(envPath, 'OPENAI_API_KEY=TOKEN_A\nOTHER=keep\n', 'utf-8');
    mockGetSecret.mockImplementation(async () => undefined);
    const plan: Plan = {
      id: 'plan-rollback',
      profileId: 'p1',
      assistantKeys: ['openai-codex'],
      steps: [
        ...makeStepEnv(envPath).map(step => ({ ...step, id: 'r1' })),
        {
          id: 'r2',
          action: 'edit-config-file',
          description: 'force failure',
          assistantKey: 'openai-codex',
          targetPath: path.join(tempDir, 'missing-dir', 'nope.json'),
          data: { configPath: path.join(tempDir, 'missing-dir', 'nope.json'), configType: 't', driver: 'json-object', format: 'json' },
          reversible: true
        }
      ],
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    const result = await applier.applyPlan(plan, 'A');
    expect(result.success).toBe(false);
    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).toContain('OPENAI_API_KEY=TOKEN_A');
    expect(env).toContain('OTHER=keep');
  });
});

/** Wiring for the vscode workspace.getConfiguration mock used by rollback tests. */
function mockVSCodeConfigUpdate() {
  return updateSpyRef;
}

import * as vscodeModule from 'vscode';
const updateSpyRef = sharedMockConfig.update;
