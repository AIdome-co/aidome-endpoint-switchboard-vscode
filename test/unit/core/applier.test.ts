/**
 * Unit tests for PlanApplier — graceful per-assistant degradation.
 *
 * Covers:
 * - All steps succeed → success result with all assistants mapped
 * - One assistant's step fails → only that assistant rolled back; others kept
 * - All assistants fail → empty applied steps; no change log entries recorded
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEnoentError } from '../testErrors';

// ---------- hoisted mock variables ----------
const {
  mockSafeWriteFile,
  mockCreateBackup,
  mockRecordApply,
  mockGetConfig,
  mockUpdateConfig,
  mockAppendLine,
  mockAccess,
  mockReadFile,
  mockUnlink,
} = vi.hoisted(() => ({
  mockSafeWriteFile: vi.fn().mockResolvedValue(true),
  mockCreateBackup: vi.fn().mockResolvedValue('/tmp/backup.json'),
  mockRecordApply: vi.fn().mockResolvedValue(undefined),
  mockGetConfig: vi.fn(),
  mockUpdateConfig: vi.fn().mockResolvedValue(undefined),
  mockAppendLine: vi.fn(),
  mockAccess: vi.fn(),
  mockReadFile: vi.fn().mockResolvedValue('{"existing":true}'),
  mockUnlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/util/fsSafe', () => ({
  safeWriteFile: mockSafeWriteFile,
  createBackup: mockCreateBackup,
}));

vi.mock('../../../src/ui/output', () => ({
  getOutputChannel: vi.fn(() => ({ appendLine: mockAppendLine, show: vi.fn(), clear: vi.fn() })),
}));

vi.mock('fs/promises', () => ({
  access: mockAccess,
  readFile: mockReadFile,
  unlink: mockUnlink,
}));

vi.mock('../../../src/util/log', () => ({
  Logger: {
    getInstance: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    })),
    initialize: vi.fn(),
  },
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: mockGetConfig,
      update: mockUpdateConfig,
    })),
  },
  ConfigurationTarget: { Global: 1 },
  ExtensionContext: vi.fn(),
}));

// ChangeLog mock — we spy on recordApply to verify it's called correctly
vi.mock('../../../src/core/orchestration/changeLog', () => ({
  ChangeLog: vi.fn(function (this: Record<string, unknown>) {
    this.recordApply = mockRecordApply;
    this.getEntries = vi.fn().mockResolvedValue([]);
  }),
}));

import { PlanApplier } from '../../../src/core/orchestration/applier';
import type { Plan, PlanStep } from '../../../src/core/orchestration/planBuilder';

// ---------- helpers ----------
function makeStep(overrides: Partial<PlanStep>): PlanStep {
  return {
    id: `step-${Math.random().toString(36).slice(2)}`,
    action: 'set-vscode-setting',
    description: 'test step',
    assistantKey: 'assistant-a',
    targetPath: 'test.setting',
    newValue: 'new-value',
    data: {},
    reversible: true,
    ...overrides,
  };
}

function makePlan(steps: PlanStep[]): Plan {
  const keys = [...new Set(steps.map(s => s.assistantKey))];
  return {
    id: 'plan-test-1',
    profileId: 'profile-1',
    assistantKeys: keys,
    steps,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
}

const fakeContext = {} as any;

// ---------- tests ----------
describe('PlanApplier — applyPlan graceful degradation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeWriteFile.mockResolvedValue(true);
    mockCreateBackup.mockResolvedValue('/tmp/backup.json');
    mockUpdateConfig.mockResolvedValue(undefined);
    mockRecordApply.mockResolvedValue(undefined);
    mockAccess.mockRejectedValue(createEnoentError());
    mockReadFile.mockResolvedValue('{"existing":true}');
    mockUnlink.mockResolvedValue(undefined);
  });

  it('returns success=true when all steps succeed', async () => {
    const applier = new PlanApplier(fakeContext);
    const steps = [
      makeStep({ assistantKey: 'assistant-a', targetPath: 'a.setting', newValue: 'v1' }),
      makeStep({ assistantKey: 'assistant-b', targetPath: 'b.setting', newValue: 'v2' }),
    ];
    const plan = makePlan(steps);

    const result = await applier.applyPlan(plan, 'my-profile');

    expect(result.success).toBe(true);
    expect(result.appliedSteps).toHaveLength(2);
    expect(result.failedSteps).toHaveLength(0);
    expect(result.assistantResults.get('assistant-a')?.success).toBe(true);
    expect(result.assistantResults.get('assistant-b')?.success).toBe(true);
    expect(mockRecordApply).toHaveBeenCalledTimes(2);
  });

  it('continues applying other assistants when one fails', async () => {
    const applier = new PlanApplier(fakeContext);
    // assistant-a step will fail; assistant-b should still be applied
    mockUpdateConfig
      .mockRejectedValueOnce(new Error('write error'))
      .mockResolvedValue(undefined);

    const steps = [
      makeStep({ assistantKey: 'assistant-a', targetPath: 'a.setting', newValue: 'v1' }),
      makeStep({ assistantKey: 'assistant-b', targetPath: 'b.setting', newValue: 'v2' }),
    ];
    const plan = makePlan(steps);

    const result = await applier.applyPlan(plan, 'my-profile');

    expect(result.success).toBe(false);
    expect(result.assistantResults.get('assistant-a')?.success).toBe(false);
    expect(result.assistantResults.get('assistant-b')?.success).toBe(true);
    // Only assistant-b's change log entry should be recorded
    expect(mockRecordApply).toHaveBeenCalledTimes(1);
    expect(mockRecordApply.mock.calls[0][0].assistantKey).toBe('assistant-b');
  });

  it('returns success=false when all assistants fail', async () => {
    mockUpdateConfig.mockRejectedValue(new Error('always fails'));

    const applier = new PlanApplier(fakeContext);
    const steps = [
      makeStep({ assistantKey: 'assistant-a', targetPath: 'a.setting', newValue: 'v1' }),
      makeStep({ assistantKey: 'assistant-b', targetPath: 'b.setting', newValue: 'v2' }),
    ];
    const plan = makePlan(steps);

    const result = await applier.applyPlan(plan, 'my-profile');

    expect(result.success).toBe(false);
    expect(result.appliedSteps).toHaveLength(0);
    expect(result.failedSteps).toHaveLength(2);
    expect(result.assistantResults.get('assistant-a')?.success).toBe(false);
    expect(result.assistantResults.get('assistant-b')?.success).toBe(false);
    expect(mockRecordApply).not.toHaveBeenCalled();
  });

  it('includes failure reason in assistantResults', async () => {
    mockUpdateConfig.mockRejectedValueOnce(new Error('specific reason'));
    mockUpdateConfig.mockResolvedValue(undefined);

    const applier = new PlanApplier(fakeContext);
    const steps = [
      makeStep({ assistantKey: 'failing-assistant', targetPath: 'x.setting', newValue: 'v' }),
    ];

    const result = await applier.applyPlan(makePlan(steps), 'profile');
    const outcome = result.assistantResults.get('failing-assistant');
    expect(outcome?.success).toBe(false);
    expect(outcome?.reason).toContain('specific reason');
  });



  it('redacts config-file contents before recording the change log', async () => {
    const applier = new PlanApplier(fakeContext);
    const step = makeStep({
      action: 'edit-config-file',
      targetPath: '/tmp/aidome-nonexistent-settings.json',
      newValue: '{ "env": { "ANTHROPIC_AUTH_TOKEN": "secret" } }',
    });

    const result = await applier.applyPlan(makePlan([step]), 'profile');

    expect(result.success).toBe(true);
    expect(mockRecordApply).toHaveBeenCalledTimes(1);
    expect(mockRecordApply.mock.calls[0][0].steps[0].newValue).toBe('[redacted config-file content]');
  });

  it('records a composite changeLogEntry for API compatibility', async () => {
    const applier = new PlanApplier(fakeContext);
    const steps = [
      makeStep({ assistantKey: 'assistant-a', targetPath: 'a.setting', newValue: 'v1' }),
    ];

    const result = await applier.applyPlan(makePlan(steps), 'profile');
    expect(result.changeLogEntry).toBeDefined();
    expect(result.changeLogEntry.profileName).toBe('profile');
  });

  it('treats verify-endpoint as a non-mutating advisory step', async () => {
    const applier = new PlanApplier(fakeContext);
    const step = makeStep({
      action: 'verify-endpoint',
      assistantKey: 'claude-code',
      reversible: false,
      data: { baseUrl: 'https://gateway.example.com/v1' },
    });

    const result = await applier.applyPlan(makePlan([step]), 'profile');

    expect(result.success).toBe(true);
    expect(result.failedSteps).toHaveLength(0);
    expect(mockRecordApply).toHaveBeenCalledTimes(1);
  });

  it('applies a Claude Code-style plan when verify-endpoint follows writes', async () => {
    const applier = new PlanApplier(fakeContext);
    const steps = [
      makeStep({
        action: 'edit-config-file',
        assistantKey: 'claude-code',
        targetPath: '/home/user/.claude/settings.json',
        newValue: '{ "env": { "ANTHROPIC_BASE_URL": "https://gateway.example.com/v1" } }',
        data: { format: 'json' },
      }),
      makeStep({
        action: 'set-vscode-setting',
        assistantKey: 'claude-code',
        targetPath: 'claudeCode.disableLoginPrompt',
        newValue: true,
        data: { scope: 'global' },
      }),
      makeStep({
        action: 'show-guided-steps',
        assistantKey: 'claude-code',
        reversible: false,
        data: { steps: ['Configure credentials securely'] },
      }),
      makeStep({
        action: 'verify-endpoint',
        assistantKey: 'claude-code',
        reversible: false,
        data: { baseUrl: 'https://gateway.example.com/v1' },
      }),
    ];

    const result = await applier.applyPlan(makePlan(steps), 'profile');

    expect(result.success).toBe(true);
    expect(result.appliedSteps).toHaveLength(4);
    expect(result.failedSteps).toHaveLength(0);
    expect(mockRecordApply).toHaveBeenCalledTimes(1);
  });

  it('rolls back newly-created config files when a later step fails', async () => {
    const applier = new PlanApplier(fakeContext);
    mockUpdateConfig.mockRejectedValueOnce(new Error('later step failed'));
    const steps = [
      makeStep({
        action: 'edit-config-file',
        assistantKey: 'claude-code',
        targetPath: '/home/user/.claude/settings.json',
        newValue: '{ "env": { "ANTHROPIC_BASE_URL": "https://gateway.example.com/v1" } }',
      }),
      makeStep({
        action: 'set-vscode-setting',
        assistantKey: 'claude-code',
        targetPath: 'claudeCode.disableLoginPrompt',
        newValue: true,
      }),
    ];

    const result = await applier.applyPlan(makePlan(steps), 'profile');

    expect(result.success).toBe(false);
    expect(mockUnlink).toHaveBeenCalledWith('/home/user/.claude/settings.json');
    expect(mockRecordApply).not.toHaveBeenCalled();
  });

  it('does not write an existing config file when backup creation fails', async () => {
    const applier = new PlanApplier(fakeContext);
    mockAccess.mockResolvedValue(undefined);
    mockCreateBackup.mockResolvedValueOnce(undefined);
    const step = makeStep({
      action: 'edit-config-file',
      targetPath: '/home/user/.claude/settings.json',
      newValue: '{}',
    });

    const result = await applier.applyPlan(makePlan([step]), 'profile');

    expect(result.success).toBe(false);
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
    expect(mockRecordApply).not.toHaveBeenCalled();
  });
});

// ---------- show-guided-steps action ----------
describe('PlanApplier — show-guided-steps action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordApply.mockResolvedValue(undefined);
  });

  it('renders a numbered list when data.steps is a string array', async () => {
    const applier = new PlanApplier(fakeContext);
    const step = makeStep({
      action: 'show-guided-steps',
      assistantKey: 'kilo-code',
      reversible: false,
      data: {
        message: 'Configure manually',
        steps: ['Step one', 'Step two', 'Step three'],
        baseUrl: 'https://example.com',
      },
    });

    const result = await applier.applyPlan(makePlan([step]), 'my-profile');

    expect(result.success).toBe(true);
    expect(mockAppendLine).toHaveBeenCalledWith('1. Step one');
    expect(mockAppendLine).toHaveBeenCalledWith('2. Step two');
    expect(mockAppendLine).toHaveBeenCalledWith('3. Step three');
  });

  it('renders data.message as fallback when data.steps is absent', async () => {
    const applier = new PlanApplier(fakeContext);
    const step = makeStep({
      action: 'show-guided-steps',
      assistantKey: 'cline',
      reversible: false,
      data: {
        message: 'Please configure Cline manually',
      },
    });

    const result = await applier.applyPlan(makePlan([step]), 'my-profile');

    expect(result.success).toBe(true);
    expect(mockAppendLine).toHaveBeenCalledWith('Please configure Cline manually');
  });

  it('renders a default message when neither data.steps nor data.message is present', async () => {
    const applier = new PlanApplier(fakeContext);
    const step = makeStep({
      action: 'show-guided-steps',
      assistantKey: 'some-assistant',
      reversible: false,
      data: {},
    });

    const result = await applier.applyPlan(makePlan([step]), 'my-profile');

    expect(result.success).toBe(true);
    expect(mockAppendLine).toHaveBeenCalledWith('Manual configuration required for some-assistant');
  });
});
