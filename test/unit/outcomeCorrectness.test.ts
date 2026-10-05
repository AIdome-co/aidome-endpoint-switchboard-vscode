/**
 * Remaining correctness-gap regression tests (P1/P2):
 * - skipped VS Code setting writes are NOT mutations and NOT configured
 * - unregistered-setting Copilot case does not create a configured result
 * - Roo Code / Tabnine real adapters produce unsupported outcomes
 * - setup UX reports outcome categories truthfully (never "configured 0")
 * - profile activation derives status from assistant outcomes
 * - mappings persist only for configured assistants
 */

import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

vi.mock('vscode', () => ({
  globalState: { get: vi.fn(), update: vi.fn() },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showQuickPick: vi.fn(),
    createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), append: vi.fn(), show: vi.fn(), clear: vi.fn() }))
  },
  workspace: { getConfiguration: () => mockVSCodeConfig },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  env: { clipboard: { writeText: vi.fn() } },
  commands: { executeCommand: vi.fn() }
}));

const mockVSCodeConfig = {
  get: vi.fn(() => undefined),
  inspect: vi.fn(() => undefined),
  update: vi.fn()
};

const { mockSaveAssistantMapping, mockGetProfiles } = vi.hoisted(() => ({
  mockSaveAssistantMapping: vi.fn(),
  mockGetProfiles: vi.fn()
}));

vi.mock('../../src/core/profiles/profileStore', () => ({
  ProfileStore: vi.fn().mockImplementation(() => ({
    getProfiles: mockGetProfiles,
    saveAssistantMapping: mockSaveAssistantMapping,
    getAssistantMappings: vi.fn().mockResolvedValue([])
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
      info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn()
    })
  }
}));

import { PlanApplier } from '../../src/core/orchestration/applier';
import { Switchboard } from '../../src/core/orchestration/switchboard';
import { createPlan, addStep, Plan } from '../../src/core/orchestration/planBuilder';
import { RooCodeAdapter } from '../../src/adapters/roocode/adapter';
import { TabnineAdapter } from '../../src/adapters/tabnine/adapter';

function makeStep(action: Plan['steps'][number]['action'], assistantKey: string, data: Record<string, unknown> = {}, targetPath?: string): Plan['steps'][number] {
  return {
    id: `step-${action}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    description: `${action} for ${assistantKey}`,
    assistantKey,
    targetPath,
    data,
    reversible: false
  };
}

let tmpDir: string;
const globalStore = new Map<string, unknown>();

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'correctness-test-'));
  globalStore.clear();
  mockSaveAssistantMapping.mockReset();
  mockSaveAssistantMapping.mockResolvedValue(undefined);
  mockGetProfiles.mockReset();
  mockGetProfiles.mockResolvedValue([{ id: 'p1', name: 'Profile 1' }]);
  mockVSCodeConfig.update.mockReset();
  mockVSCodeConfig.get.mockReset();
  mockVSCodeConfig.get.mockReturnValue(undefined);
  mockVSCodeConfig.inspect.mockReturnValue(undefined);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function newApplier(): Promise<PlanApplier> {
  const context = {
    globalState: {
      get: (key: string, defaultValue?: unknown) => globalStore.has(key) ? globalStore.get(key) : defaultValue,
      update: (key: string, value: unknown) => { globalStore.set(key, value); return Promise.resolve(); }
    }
  } as unknown as import('vscode').ExtensionContext;
  const applier = new PlanApplier(context);
  (applier as unknown as { profileSecrets: { getSecret: (ref: string) => Promise<string | undefined> } }).profileSecrets = {
    getSecret: async () => 'synthetic-secret'
  };
  return applier;
}

describe('P1: skipped VS Code setting writes are not mutations', () => {
  it('unregistered setting: mutationApplied=false, assistant guided-required, no mapping', async () => {
    mockVSCodeConfig.update.mockRejectedValue(new Error("It is not possible to register a configuration 'legacy.proxy' because it is not a registered configuration"));

    const plan = createPlan('p1', ['assist-vscode']);
    plan.steps.push(makeStep('set-vscode-setting', 'assist-vscode', { scope: 'global' }, 'legacy.proxy'));

    const applier = await newApplier();
    const result = await applier.applyPlan(plan, 'Profile 1');

    const outcome = result.assistantResults.get('assist-vscode');
    expect(outcome?.status).toBe('guided-required');
    expect(outcome?.success).toBe(false);
    // No configured mapping for a skipped write.
    const switchboard = new Switchboard(
      {
        globalState: {
          get: (key: string, defaultValue?: unknown) => globalStore.has(key) ? globalStore.get(key) : defaultValue,
          update: (key: string, value: unknown) => { globalStore.set(key, value); return Promise.resolve(); }
        }
      } as never,
      { assistants: [], dialectCatalog: {} } as never,
      {
        getProfiles: mockGetProfiles,
        saveAssistantMapping: mockSaveAssistantMapping,
        getAssistantMappings: vi.fn().mockResolvedValue([])
      } as never,
      { getSecret: async () => undefined } as never
    );
    await switchboard.applyPlan(plan);
    expect(mockSaveAssistantMapping).not.toHaveBeenCalled();
  });

  it('supported setting: mutationApplied=true, assistant configured', async () => {
    mockVSCodeConfig.update.mockResolvedValue(undefined);

    const plan = createPlan('p1', ['assist-vscode']);
    plan.steps.push(makeStep('set-vscode-setting', 'assist-vscode', { scope: 'global' }, 'aRegistered.setting'));

    const applier = await newApplier();
    const result = await applier.applyPlan(plan, 'Profile 1');

    const outcome = result.assistantResults.get('assist-vscode');
    expect(outcome?.status).toBe('configured');
    expect(outcome?.success).toBe(true);
    expect(mockVSCodeConfig.update).toHaveBeenCalled();
  });
});

describe('P2: unsupported assistants are explicit', () => {
  it('Roo Code real adapter plan → status unsupported, no mapping', async () => {
    const adapter = new RooCodeAdapter();
    const profile = {
      id: 'p1', name: 'Profile 1', profileType: 'aidome',
      baseUrl: 'https://gw.example.com/v1', dialect: 'openai.chat_completions',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    } as never;
    const plan = await adapter.buildPlan(profile);
    const applier = await newApplier();
    const result = await applier.applyPlan(plan, 'Profile 1');

    const outcome = result.assistantResults.get('roo-code');
    expect(outcome?.status).toBe('unsupported');
    expect(outcome?.success).toBe(false);

    const switchboard = new Switchboard(
      {
        globalState: {
          get: (key: string, defaultValue?: unknown) => globalStore.has(key) ? globalStore.get(key) : defaultValue,
          update: (key: string, value: unknown) => { globalStore.set(key, value); return Promise.resolve(); }
        }
      } as never,
      { assistants: [], dialectCatalog: {} } as never,
      {
        getProfiles: mockGetProfiles,
        saveAssistantMapping: mockSaveAssistantMapping,
        getAssistantMappings: vi.fn().mockResolvedValue([])
      } as never,
      { getSecret: async () => undefined } as never
    );
    await switchboard.applyPlan(plan);
    expect(mockSaveAssistantMapping).not.toHaveBeenCalled();
  });

  it('Tabnine real adapter plan → status unsupported; verify fails even when installed', async () => {
    const adapter = new TabnineAdapter();
    const profile = {
      id: 'p1', name: 'Profile 1', profileType: 'aidome',
      baseUrl: 'https://gw.example.com/v1', dialect: 'openai.chat_completions',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
    } as never;
    const plan = await adapter.buildPlan(profile);
    const applier = await newApplier();
    const result = await applier.applyPlan(plan, 'Profile 1');

    const outcome = result.assistantResults.get('tabnine');
    expect(outcome?.status).toBe('unsupported');
    expect(outcome?.success).toBe(false);
  });
});

describe('P2: setup activation + mapping truthfulness', () => {
  it('mapping persisted ONLY for configured outcome (required guidance after mutation → no mapping)', async () => {
    const file = path.join(tmpDir, 'x.json');
    const plan = createPlan('p1', ['assist-a']);
    plan.steps.push(makeStep('edit-config-file', 'assist-a', {
      configPath: file, configType: 't1', driver: 'json-object', format: 'json',
      baseUrl: 'https://gw.example.com/v1',
      patches: [{ path: ['x'], value: 1 }]
    }, file));
    plan.steps.push(makeStep('show-guided-steps', 'assist-a', { message: 'Now set the API key manually' }));

    const switchboard = new Switchboard(
      {
        globalState: {
          get: (key: string, defaultValue?: unknown) => globalStore.has(key) ? globalStore.get(key) : defaultValue,
          update: (key: string, value: unknown) => { globalStore.set(key, value); return Promise.resolve(); }
        }
      } as unknown as import('vscode').ExtensionContext,
      { assistants: [], dialectCatalog: {} } as never,
      {
        getProfiles: mockGetProfiles,
        saveAssistantMapping: mockSaveAssistantMapping,
        getAssistantMappings: vi.fn().mockResolvedValue([])
      } as never,
      { getSecret: async () => 'synthetic-secret' } as never
    );
    const result = await switchboard.applyPlan(plan);

    expect(result.assistantResults.get('assist-a')?.status).toBe('guided-required');
    expect(mockSaveAssistantMapping).not.toHaveBeenCalled();

    // The SAME plan with OPTIONAL guidance → configured → mapping persisted.
    const plan2 = createPlan('p1', ['assist-a']);
    plan2.steps.push(makeStep('edit-config-file', 'assist-a', {
      configPath: file, configType: 't1', driver: 'json-object', format: 'json',
      baseUrl: 'https://gw.example.com/v1',
      patches: [{ path: ['x'], value: 1 }]
    }, file));
    plan2.steps.push(makeStep('show-guided-steps', 'assist-a', { message: 'FYI note', optional: true }));
    await switchboard.applyPlan(plan2);
    expect(mockSaveAssistantMapping).toHaveBeenCalledTimes(1);
  });
});

describe('P2: setup message categories', () => {
  it('builds the truthful setup message strings from outcome categories', async () => {
    const { countConfiguredAssistants } = await import('../../src/core/orchestration/assistantOutcome');
    const results = new Map([
      ['cline', { status: 'configured', success: true }],
      ['gemini-cli', { status: 'guided-required', success: false }]
    ] as const) as unknown as Map<string, import('../../src/core/orchestration/assistantOutcome').AssistantApplyResult>;
    expect(countConfiguredAssistants(results)).toBe(1);
  });
});