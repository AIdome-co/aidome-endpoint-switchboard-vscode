/**
 * GAP 1–11: outcome-semantics regression tests.
 *
 * "Plan executed" is NOT "assistant configured". These tests lock the
 * discriminated AssistantApplyStatus model end to end.
 */

import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const {
  mockSaveAssistantMapping,
  mockGetAssistantMappings,
  mockGetProfiles
} = vi.hoisted(() => ({
  mockSaveAssistantMapping: vi.fn(),
  mockGetAssistantMappings: vi.fn(),
  mockGetProfiles: vi.fn()
}));

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      append: vi.fn(),
      show: vi.fn(),
      clear: vi.fn()
    }))
  },
  workspace: { getConfiguration: () => ({ get: () => undefined, update: vi.fn() }) },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  env: { clipboard: { writeText: vi.fn() } }
}));

vi.mock('../../src/core/profiles/profileStore', () => ({
  ProfileStore: vi.fn().mockImplementation(() => ({
    getProfiles: mockGetProfiles,
    saveAssistantMapping: mockSaveAssistantMapping,
    getAssistantMappings: mockGetAssistantMappings
  }))
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: class {
    getSecret(): Promise<string | undefined> { return Promise.resolve(undefined); }
  }
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    })
  }
}));

import { PlanApplier } from '../../src/core/orchestration/applier';
import { createPlan, addStep, Plan } from '../../src/core/orchestration/planBuilder';

let tmpDir: string;
  const outcomeStore = new Map<string, unknown>();

function step(action: Plan['steps'][number]['action'], assistantKey: string, extra: Record<string, unknown> = {}): Plan['steps'][number] {
  return {
    id: `step-${action}-${assistantKey}-${Math.random().toString(36).slice(2, 7)}`,
    action,
    description: `${action} for ${assistantKey}`,
    assistantKey,
    targetPath: action === 'edit-config-file' || action === 'write-env-file'
      ? path.join(tmpDir, `${assistantKey}-${action}.file`)
      : undefined,
    data: extra,
    reversible: false
  };
}

describe('assistant outcome semantics', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-test-'));
    vi.clearAllMocks();
    outcomeStore.clear();
    mockGetProfiles.mockResolvedValue([{ id: 'p1', name: 'Profile 1' }]);
    mockSaveAssistantMapping.mockResolvedValue(undefined);
    mockGetAssistantMappings.mockResolvedValue([]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function apply(plan: Plan) {
    const store = new Map<string, unknown>();
    const context = {
      globalState: {
        get: (key: string, defaultValue?: unknown) => store.has(key) ? store.get(key) : defaultValue,
        update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); }
      }
    } as unknown as import('vscode').ExtensionContext;
    return new PlanApplier(context).applyPlan(plan, 'Profile 1');
  }

  it('guided-only plan: executes fine but reports guided-required, not configured', async () => {
    const plan = createPlan('p1', ['assist-a']);
    const guided = step('show-guided-steps', 'assist-a', { message: 'Configure manually in the app UI' });
    plan.steps.push(guided);

    const result = await apply(plan);

    // The PLAN executed without throwing...
    expect(result.failedSteps).toHaveLength(0);
    // ...but the ASSISTANT is not configured.
    const outcome = result.assistantResults.get('assist-a');
    expect(outcome?.status).toBe('guided-required');
    expect(outcome?.success).toBe(false);
  });

  it('optional guidance after a successful mutation does not downgrade to guided-required', async () => {
    const file = path.join(tmpDir, 'settings.json');
    const plan = createPlan('p1', ['assist-a']);
    plan.steps.push(step('edit-config-file', 'assist-a', {
      configPath: file,
      configType: 'outcome-test',
      driver: 'json-object',
      format: 'json',
      baseUrl: 'https://gw.example.com/v1',
      newValue: 'https://gw.example.com/v1',
      patches: [{ path: ['baseUrl'], value: 'https://gw.example.com/v1' }]
    }));
    plan.steps.push(step('show-guided-steps', 'assist-a', { message: 'FYI: restart the app', optional: true }));

    const result = await apply(plan);

    const outcome = result.assistantResults.get('assist-a');
    expect(outcome?.status).toBe('configured');
    expect(outcome?.success).toBe(true);
  });

  it('required guidance after partial automatic work stays guided-required', async () => {
    const file = path.join(tmpDir, 'settings.json');
    const plan = createPlan('p1', ['assist-a']);
    plan.steps.push(step('edit-config-file', 'assist-a', {
      configPath: file,
      configType: 'outcome-test',
      driver: 'json-object',
      format: 'json',
      baseUrl: 'https://gw.example.com/v1',
      newValue: 'https://gw.example.com/v1',
      patches: [{ path: ['baseUrl'], value: 'https://gw.example.com/v1' }]
    }));
    plan.steps.push(step('show-guided-steps', 'assist-a', { message: 'Now set the API key manually in the UI' }));

    const result = await apply(plan);

    const outcome = result.assistantResults.get('assist-a');
    expect(outcome?.status).toBe('guided-required');
    expect(outcome?.success).toBe(false);
  });

  it('unsupported guidance plans report unsupported, not configured', async () => {
    const plan = createPlan('p1', ['assist-u']);
    plan.steps.push(step('show-guided-steps', 'assist-u', {
      message: 'This assistant is retired and unsupported',
      configurationStatus: 'unsupported'
    }));

    const result = await apply(plan);

    const outcome = result.assistantResults.get('assist-u');
    expect(outcome?.status).toBe('unsupported');
    expect(outcome?.success).toBe(false);
  });

  it('counts configured assistants, not steps (4 steps → 1 assistant)', async () => {
    const { countConfiguredAssistants } = await import('../../src/core/orchestration/assistantOutcome');
    const file1 = path.join(tmpDir, 'a.json');
    const file2 = path.join(tmpDir, 'b.json');
    const envPath = path.join(tmpDir, '.env');
    const plan = createPlan('p1', ['assist-a']);
    plan.steps.push(step('edit-config-file', 'assist-a', {
      configPath: file1, configType: 't1', driver: 'json-object', format: 'json', baseUrl: 'https://gw.example.com/v1',
      patches: [{ path: ['x'], value: 1 }]
    }));
    plan.steps.push(step('edit-config-file', 'assist-a', {
      configPath: file2, configType: 't2', driver: 'json-object', format: 'json', baseUrl: 'https://gw.example.com/v1',
      patches: [{ path: ['y'], value: 2 }]
    }));
    plan.steps.push(step('write-env-file', 'assist-a', {
      envVarName: 'SOME_KEY',
      secretPolicy: 'target-persisted-at-apply',
      authRef: 'Profile 1',
      profileName: 'Profile 1'
    }));
    plan.steps.push(step('verify-endpoint', 'assist-a'));

    // mock the profile secret for the env step
    const context = {
      globalState: {
        get: (key: string, defaultValue?: unknown) => outcomeStore.has(key) ? outcomeStore.get(key) : defaultValue,
        update: (key: string, value: unknown) => { outcomeStore.set(key, value); return Promise.resolve(); }
      }
    } as unknown as import('vscode').ExtensionContext;
    const applier = new PlanApplier(context);
    (applier as unknown as { profileSecrets: { getSecret: (ref: string) => Promise<string> } }).profileSecrets = {
      getSecret: async () => 'synthetic-secret'
    };
    const result = await applier.applyPlan(plan, 'Profile 1');

    expect(result.appliedSteps.length).toBeGreaterThanOrEqual(3);
    expect(result.assistantResults.get('assist-a')?.status).toBe('configured');
    expect(countConfiguredAssistants(result.assistantResults)).toBe(1);
  });

  it('write-env-file alone with a resolved secret is a real mutation → configured', async () => {
    const plan = createPlan('p1', ['assist-a']);
    plan.steps.push(step('write-env-file', 'assist-a', {
      envVarName: 'SOME_KEY',
      secretPolicy: 'target-persisted-at-apply',
      authRef: 'Profile 1',
      profileName: 'Profile 1'
    }));

    const context = {
      globalState: {
        get: (key: string, defaultValue?: unknown) => outcomeStore.has(key) ? outcomeStore.get(key) : defaultValue,
        update: (key: string, value: unknown) => { outcomeStore.set(key, value); return Promise.resolve(); }
      }
    } as unknown as import('vscode').ExtensionContext;
    const applier = new PlanApplier(context);
    (applier as unknown as { profileSecrets: { getSecret: (ref: string) => Promise<string> } }).profileSecrets = {
      getSecret: async () => 'synthetic-secret'
    };
    const result = await applier.applyPlan(plan, 'Profile 1');

    expect(result.assistantResults.get('assist-a')?.status).toBe('configured');
    const env = fs.readFileSync(path.join(tmpDir, 'assist-a-write-env-file.file'), 'utf-8');
    expect(env).toContain('SOME_KEY=synthetic-secret');
  });

  it('write-env-file with required auth but NO secret → guided-required, env file untouched', async () => {
    const envPath = path.join(tmpDir, 'assist-a-write-env-file.file');
    fs.writeFileSync(envPath, 'KEEP=original\n');
    const before = fs.readFileSync(envPath, 'utf-8');

    const plan = createPlan('p1', ['assist-a']);
    plan.steps.push(step('write-env-file', 'assist-a', {
      envVarName: 'SOME_KEY',
      secretPolicy: 'target-persisted-at-apply',
      authRef: 'Profile 1',
      profileName: 'Profile 1'
    }));

    const context = {
      globalState: {
        get: (key: string, defaultValue?: unknown) => outcomeStore.has(key) ? outcomeStore.get(key) : defaultValue,
        update: (key: string, value: unknown) => { outcomeStore.set(key, value); return Promise.resolve(); }
      }
    } as unknown as import('vscode').ExtensionContext;
    const applier = new PlanApplier(context);
    (applier as unknown as { profileSecrets: { getSecret: (ref: string) => Promise<undefined> } }).profileSecrets = {
      getSecret: async () => undefined
    };
    const result = await applier.applyPlan(plan, 'Profile 1');

    const outcome = result.assistantResults.get('assist-a');
    expect(outcome?.status).toBe('guided-required');
    expect(outcome?.success).toBe(false);
    // Existing unrelated env file remains byte-identical.
    expect(fs.readFileSync(envPath, 'utf-8')).toBe(before);
  });

  it('write-env-file validation fails closed without an explicit secretPolicy', async () => {
    const { validateWriteEnvFileStepData } = await import('../../src/core/orchestration/planStepData');
    expect(validateWriteEnvFileStepData({ envVarName: 'K' }).ok).toBe(false);
    expect(validateWriteEnvFileStepData({ envVarName: 'K', secretPolicy: 'something-else' }).ok).toBe(false);
    expect(validateWriteEnvFileStepData({ envVarName: '', secretPolicy: 'target-persisted-at-apply' }).ok).toBe(false);
    expect(validateWriteEnvFileStepData({ envVarName: 'K', secretPolicy: 'target-persisted-at-apply', authRef: '' }).ok).toBe(false);
    expect(validateWriteEnvFileStepData({ envVarName: 'K', secretPolicy: 'target-persisted-at-apply' }).ok).toBe(true);
  });

  it('switchboard persists at most ONE mapping per assistant including write-env-file plans', async () => {
    const { Switchboard } = await import('../../src/core/orchestration/switchboard');
    const file1 = path.join(tmpDir, 'a.json');
    const file2 = path.join(tmpDir, 'b.json');
    const plan = createPlan('p1', ['assist-a']);
    plan.steps.push(step('edit-config-file', 'assist-a', {
      configPath: file1, configType: 't1', driver: 'json-object', format: 'json', baseUrl: 'https://gw.example.com/v1', patches: [{ path: ['x'], value: 1 }]
    }));
    plan.steps.push(step('edit-config-file', 'assist-a', {
      configPath: file2, configType: 't2', driver: 'json-object', format: 'json', baseUrl: 'https://gw.example.com/v1', patches: [{ path: ['y'], value: 2 }]
    }));
    plan.steps.push(step('write-env-file', 'assist-a', {
      envVarName: 'SOME_KEY',
      secretPolicy: 'target-persisted-at-apply',
      authRef: 'Profile 1',
      profileName: 'Profile 1'
    }));
    plan.steps.push(step('verify-endpoint', 'assist-a'));
    plan.steps.push(step('show-guided-steps', 'assist-a', { message: 'note', optional: true }));

    const globalStore = new Map<string, unknown>();
    const switchboard = new Switchboard(
      {
        globalState: {
          get: (key: string, defaultValue?: unknown) => globalStore.has(key) ? globalStore.get(key) : defaultValue,
          update: (key: string, value: unknown) => { globalStore.set(key, value); return Promise.resolve(); }
        }
      } as unknown as import('vscode').ExtensionContext,
      {} as never,
      {
        getProfiles: mockGetProfiles,
        saveAssistantMapping: mockSaveAssistantMapping,
        getAssistantMappings: mockGetAssistantMappings
      } as never,
      { getSecret: async () => 'synthetic-secret' } as never
    );
    const applier = switchboard['applier'] as unknown as { profileSecrets: { getSecret: (ref: string) => Promise<string> } };
    applier.profileSecrets = { getSecret: async () => 'synthetic-secret' };

    const result = await switchboard.applyPlan(plan);

    expect(result.assistantResults.get('assist-a')?.status).toBe('configured');
    // One assistant + one apply → at most ONE persisted mapping.
    expect(mockSaveAssistantMapping).toHaveBeenCalledTimes(1);
    expect(mockSaveAssistantMapping).toHaveBeenCalledWith(expect.objectContaining({
      assistantKey: 'assist-a',
      profileId: 'p1'
    }));
  });

  it('switchboard does NOT persist a mapping for a guidance-only plan', async () => {
    const { Switchboard } = await import('../../src/core/orchestration/switchboard');
    const plan = createPlan('p1', ['assist-a']);
    plan.steps.push(step('show-guided-steps', 'assist-a', { message: 'Configure manually' }));

    const globalStore = new Map<string, unknown>();
    const switchboard = new Switchboard(
      {
        globalState: {
          get: (key: string, defaultValue?: unknown) => globalStore.has(key) ? globalStore.get(key) : defaultValue,
          update: (key: string, value: unknown) => { globalStore.set(key, value); return Promise.resolve(); }
        }
      } as unknown as import('vscode').ExtensionContext,
      {} as never,
      {
        getProfiles: mockGetProfiles,
        saveAssistantMapping: mockSaveAssistantMapping,
        getAssistantMappings: mockGetAssistantMappings
      } as never,
      { getSecret: async () => 'synthetic-secret' } as never
    );
    await switchboard.applyPlan(plan);

    expect(mockSaveAssistantMapping).not.toHaveBeenCalled();
    expect(switchboard['applier']).toBeDefined();
  });

  it('automated reapply retains write-env-file so Codex profile switching moves config + credential', async () => {
    const { buildAutomatedReapplyPlan } = await import('../../src/commands/activateProfile');
    const plan = createPlan('p1', ['openai-codex']);
    plan.steps.push(step('edit-config-file', 'openai-codex', { configPath: path.join(tmpDir, 'config.toml') }));
    plan.steps.push(step('write-env-file', 'openai-codex', {
      envVarName: 'OPENAI_API_KEY', secretPolicy: 'target-persisted-at-apply', authRef: 'Profile 1', profileName: 'Profile 1'
    }));
    plan.steps.push(step('verify-endpoint', 'openai-codex'));
    plan.steps.push(step('show-guided-steps', 'openai-codex', { message: 'note', optional: true }));
    plan.steps.push(step('backup-file', 'openai-codex', { configPath: path.join(tmpDir, 'config.toml') }));

    const reapply = buildAutomatedReapplyPlan(plan);
    const actions = reapply.steps.map(s => s.action);
    // Both the endpoint config AND the required credential move together.
    expect(actions).toContain('edit-config-file');
    expect(actions).toContain('write-env-file');
    // Guidance/verification/backup are not part of automated reapply.
    expect(actions).not.toContain('verify-endpoint');
    expect(actions).not.toContain('show-guided-steps');
    expect(actions).not.toContain('backup-file');
  });

  it('failure of a mutation step reports failed, not configured', async () => {
    const plan = createPlan('p1', ['assist-a']);
    const bad = step('edit-config-file', 'assist-a', {
      configPath: path.join(tmpDir, 'x.json'),
      configType: 't1',
      driver: 'json-object',
      format: 'json',
      patches: [{ path: ['x'], value: 1 }]
    });
    plan.steps.push(bad);

    const result = await apply(plan);
    expect(result.success).toBe(false);
    const outcome = result.assistantResults.get('assist-a');
    expect(outcome?.status).toBe('failed');
    expect(outcome?.success).toBe(false);
  });
});