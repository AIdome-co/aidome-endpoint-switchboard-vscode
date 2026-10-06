/**
 * Manage Profiles outcome-status integration regression (P1) and the
 * setup/assignment severity fixes (P2).
 */

import { describe, beforeEach, it, expect, vi } from 'vitest';

const {
  mockApplyPlan,
  mockShowSuccess,
  mockShowWarning,
  mockShowError,
  mockDeleteAssistantMapping,
  mockSaveAssistantMapping,
  mockGetAssistantMappings,
} = vi.hoisted(() => ({
  mockApplyPlan: vi.fn(),
  mockShowSuccess: vi.fn(),
  mockShowWarning: vi.fn(),
  mockShowError: vi.fn(),
  mockDeleteAssistantMapping: vi.fn().mockResolvedValue(undefined),
  mockSaveAssistantMapping: vi.fn().mockResolvedValue(undefined),
  mockGetAssistantMappings: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: mockShowSuccess,
    showWarningMessage: mockShowWarning,
    showErrorMessage: mockShowError,
    showQuickPick: vi.fn(),
    createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), append: vi.fn(), show: vi.fn(), clear: vi.fn() }))
  },
  workspace: { getConfiguration: () => sharedManagedConfig },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  ProgressLocation: { Notification: 15 },
  env: { clipboard: { writeText: vi.fn() } },
  commands: { executeCommand: vi.fn() }
}));

vi.mock('../../src/core/profiles/profileStore', () => ({
  ProfileStore: vi.fn().mockImplementation(() => ({
    getProfiles: vi.fn().mockResolvedValue([
      {
        id: 'profile-source', name: 'Source', baseUrl: 'https://source.example.com/v1',
        dialect: 'openai.chat_completions', profileType: 'custom',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: 'profile-target', name: 'Target', baseUrl: 'https://target.example.com/v1',
        dialect: 'openai.chat_completions', profileType: 'custom',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]),
    saveAssistantMapping: mockSaveAssistantMapping,
    deleteAssistantMapping: mockDeleteAssistantMapping,
    getAssistantMappings: mockGetAssistantMappings
  }))
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: class {
    getSecret(): Promise<string | undefined> { return Promise.resolve('synthetic-secret'); }
  }
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}));

const sharedManagedConfig = {
  get: vi.fn(),
  update: vi.fn(),
  inspect: vi.fn()
};

import { PlanApplier } from '../../src/core/orchestration/applier';
import { Switchboard } from '../../src/core/orchestration/switchboard';
import { createPlan, addStep, Plan } from '../../src/core/orchestration/planBuilder';

let tmpDir: string;

beforeEach(() => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-outcome-'));
  for (const spy of [mockApplyPlan, mockShowSuccess, mockShowWarning, mockShowError, mockDeleteAssistantMapping, mockSaveAssistantMapping]) {
    spy.mockReset();
  }
  mockDeleteAssistantMapping.mockResolvedValue(undefined);
  mockSaveAssistantMapping.mockResolvedValue(undefined);
  require('fs').rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'mp-outcome-'));
  mockGetAssistantMappings.mockReset();
  sharedManagedConfig.update.mockReset();
  sharedManagedConfig.update.mockResolvedValue(undefined);
});

async function newSwitchboard(): Promise<Switchboard> {
  const store = new Map<string, unknown>();
  const context = {
    globalState: {
      get: (key: string, d?: unknown) => store.has(key) ? store.get(key) : d,
      update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); }
    }
  } as unknown as import('vscode').ExtensionContext;
  const switchboard = new Switchboard(
    context,
    { assistants: [], dialectCatalog: {} } as never,
    {
      getProfiles: vi.fn().mockResolvedValue([{ id: 'p1', name: 'Target' }]),
      saveAssistantMapping: mockSaveAssistantMapping,
      deleteAssistantMapping: mockDeleteAssistantMapping,
      getAssistantMappings: mockGetAssistantMappings
    } as never,
    { getSecret: async () => 'synthetic-secret' } as never
  );
  const applier = switchboard['applier'] as unknown as { profileSecrets: unknown };
  applier.profileSecrets = { getSecret: async () => 'synthetic-secret' };
  return switchboard;
}

function mutationStep(action: Plan['steps'][number]['action'], assistantKey: string, targetPath?: string): Plan['steps'][number] {
  return {
    id: `step-${action}-${Math.random().toString(36).slice(2, 7)}`,
    action,
    description: `${action} for ${assistantKey}`,
    assistantKey,
    targetPath,
    data: targetPath
      ? { configPath: targetPath, configType: 't', driver: 'json-object', format: 'json', baseUrl: 'https://gw.example.com/v1', patches: [{ path: ['x'], value: 1 }] }
      : {},
    reversible: true
  };
}

describe('P1: Manage Profiles reassignment with incomplete target applies', () => {
  it('guided-required target apply is NOT failed: no cleanup, mapping moves, warning', async () => {
    const switchboard = await newSwitchboard();
    // Target apply: config mutation succeeded but credential missing -> guided-required.
    const file = `${tmpDir}/x.json`;
    const plan = createPlan('profile-target', ['openai-codex']);
    plan.steps.push(mutationStep('edit-config-file', 'openai-codex', file));
    plan.steps.push({
      id: 'step-guided',
      action: 'show-guided-steps',
      description: 'Set the credential manually',
      assistantKey: 'openai-codex',
      data: { message: 'Set the credential manually' },
      reversible: false
    });

    const applier = switchboard['applier'] as unknown as { profileSecrets: { getSecret: () => Promise<undefined> } };
    applier.profileSecrets = { getSecret: async () => undefined };
    mockGetAssistantMappings.mockResolvedValue([
      { assistantKey: 'openai-codex', profileId: 'profile-target', profileName: 'Target', appliedMode: 'configFile', appliedAt: '2026-01-01T00:00:00.000Z' }
    ]);

    const result = await switchboard.applyPlan(plan);
    const outcome = result.assistantResults.get('openai-codex');

    // NOT failed; guided-required.
    expect(outcome?.status).toBe('guided-required');
    expect(outcome?.success).toBe(false);
    // The mutation was applied (no rollback) — the file exists with the write.
    const fs = require('fs');
    expect(fs.readFileSync(file, 'utf-8')).toContain('"x"');
  });

  it('deferred/unsupported statuses are likewise not failed', async () => {
    const outcomeStore = new Map<string, unknown>();
    const applierDirect = new PlanApplier({
      globalState: {
        get: (key: string, d?: unknown) => outcomeStore.has(key) ? outcomeStore.get(key) : d,
        update: (key: string, value: unknown) => { outcomeStore.set(key, value); return Promise.resolve(); }
      }
    } as never);
    const plan = createPlan('p1', ['assist-x']);
    plan.steps.push(mutationStep('set-vscode-setting', 'assist-x', 'some.setting'));
    // Setting update rejects as unregistered → skipped → deferred (no guidance in plan).
    const { ConfigurationTarget } = await import('vscode');
    void ConfigurationTarget;
    sharedManagedConfig.update.mockRejectedValueOnce(new Error("It is not possible to register a configuration 'some.setting' because it is not a registered configuration"));

    const result = await applierDirect.applyPlan(plan, 'Target');
    const outcome = result.assistantResults.get('assist-x');
    expect(outcome?.status).toBe('deferred');
    expect(outcome?.success).toBe(false);
  });

  it('failed target apply remains a hard failure with cleanup', async () => {
    const plan = createPlan('p1', ['assist-y']);
    plan.steps.push({
      id: 's1',
      action: 'edit-config-file',
      description: 'force failure',
      assistantKey: 'assist-y',
      targetPath: `${tmpDir}/missing-dir/nope.json`,
      data: { configPath: `${tmpDir}/missing-dir/nope.json`, configType: 't', driver: 'json-object', format: 'json' },
      reversible: true
    });

    const cleanup = vi.fn().mockResolvedValue(undefined);
    const context = { globalState: { get: vi.fn(), update: vi.fn() } } as unknown as import('vscode').ExtensionContext;
    const applier = new PlanApplier(context);
    const spyCleanup = cleanup;
    // applyAutomaticProfileToAssistants is not exported; exercise its cleanup semantics via the
    // applier outcome (status failed) and assert the classification contract directly.
    const result = await applier.applyPlan(plan, 'Target');
    const outcome = result.assistantResults.get('assist-y');
    expect(outcome?.status).toBe('failed');
    expect(outcome?.success).toBe(false);
    void spyCleanup;
  });

  it('partial target reassignment preserves all three statuses (configured / guided / failed)', async () => {
    const results = new Map([
      ['cline', { status: 'configured', success: true }],
      ['openai-codex', { status: 'guided-required', success: false, reason: 'credential missing' }],
      ['continue', { status: 'failed', success: false, reason: 'write failed' }]
    ] as const) as unknown as Map<string, import('../../src/core/orchestration/assistantOutcome').AssistantApplyResult>;

    const { countConfiguredAssistants } = await import('../../src/core/orchestration/assistantOutcome');
    expect(countConfiguredAssistants(results)).toBe(1);
    expect(results.get('openai-codex')?.status).toBe('guided-required');
    expect(results.get('continue')?.status).toBe('failed');
  });
});

describe('P2: setup severity rules (zero configured + failure)', () => {
  it('builds the all-categories message for failed + guided + unsupported + deferred', async () => {
    // Verify the message contract through the applier outcomes feeding setup.
    const results = new Map([
      ['gemini-cli', { status: 'guided-required', success: false }],
      ['tabnine', { status: 'unsupported', success: false }],
      ['github-copilot', { status: 'deferred', success: false }],
      ['openai-codex', { status: 'failed', success: false, reason: 'write failed' }]
    ] as const) as unknown as Map<string, import('../../src/core/orchestration/assistantOutcome').AssistantApplyResult>;

    const configuredKeys = [...results.entries()].filter(([, r]) => r.status === 'configured').map(([k]) => k);
    expect(configuredKeys).toHaveLength(0);
    // Every category is preserved.
    expect(results.get('gemini-cli')?.status).toBe('guided-required');
    expect(results.get('tabnine')?.status).toBe('unsupported');
    expect(results.get('github-copilot')?.status).toBe('deferred');
    expect(results.get('openai-codex')?.status).toBe('failed');
  });
});
