/**
 * P1/P2: transactional reassignment restoration regression.
 *
 * Runs the REAL applyAutomaticProfileToAssistants + reassign semantics via
 * Manage Profiles's Delete Profile → Reassign flow (Switchboard mocked at
 * its public buildPlan/applyPlan seam). The applyPlan mock returns the
 * PRODUCTION ApplierResult shape: executed PlanSteps in appliedSteps
 * (completed:true even for skipped no-ops) AND a changeLogEntry whose
 * AppliedStep record carries the real mutationApplied flag — the same
 * evidence source the production mutation classifier reads.
 */

import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const {
  mockShowQuickPick,
  mockBuildPlan,
  mockApplyPlan,
  mockShowSuccess,
  mockShowWarning,
  mockShowError,
  mockGetSecret,
  mockDeleteProfile,
  mockSetActiveProfile,
  mockUpdateStatusBar,
  mockGetProfiles,
  mockGetAssistantMappings,
  mockDeleteAssistantMapping,
  mockSaveAssistantMapping,
  mockGetActiveProfileId,
  mockConfigUpdate,
} = vi.hoisted(() => ({
  mockBuildPlan: vi.fn(),
  mockApplyPlan: vi.fn(),
  mockShowSuccess: vi.fn(),
  mockShowWarning: vi.fn(),
  mockShowError: vi.fn(),
  mockGetSecret: vi.fn().mockResolvedValue('secret-token'),
  mockDeleteProfile: vi.fn().mockResolvedValue(undefined),
  mockSetActiveProfile: vi.fn(),
  mockUpdateStatusBar: vi.fn(),
  mockGetProfiles: vi.fn(),
  mockGetAssistantMappings: vi.fn(),
  mockDeleteAssistantMapping: vi.fn().mockResolvedValue(undefined),
  mockSaveAssistantMapping: vi.fn().mockResolvedValue(undefined),
  mockGetActiveProfileId: vi.fn(),
  mockShowQuickPick: vi.fn(),
  mockConfigUpdate: vi.fn(),
}));

const sharedManagedConfig = {
  get: vi.fn(),
  update: mockConfigUpdate,
  inspect: vi.fn()
};

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: mockShowWarning,
    showErrorMessage: mockShowError,
    showQuickPick: mockShowQuickPick,
    showInputBox: vi.fn(),
    createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), append: vi.fn(), show: vi.fn(), clear: vi.fn() })),
    withProgress: (_options: unknown, task: (progress: unknown) => Promise<unknown>) => task({ report: vi.fn() })
  },
  workspace: { getConfiguration: () => sharedManagedConfig },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  ProgressLocation: { Notification: 15 },
  QuickPickItemKind: { Separator: -1, Default: 0 },
  env: { clipboard: { writeText: vi.fn() } },
  commands: { executeCommand: vi.fn() }
}));

vi.mock('../../src/core/profiles/profileStore', () => ({
  ProfileStore: vi.fn(function (this: Record<string, unknown>) {
    this.getProfiles = mockGetProfiles;
    this.deleteProfile = mockDeleteProfile;
    this.getActiveProfileId = mockGetActiveProfileId;
    this.setActiveProfile = mockSetActiveProfile;
    this.saveAssistantMapping = mockSaveAssistantMapping;
    this.deleteAssistantMapping = mockDeleteAssistantMapping;
    this.getAssistantMappings = mockGetAssistantMappings;
  })
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn(function (this: Record<string, unknown>) {
    this.getSecret = mockGetSecret;
  })
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}));

vi.mock('../../src/core/orchestration/switchboard', () => ({
  Switchboard: vi.fn().mockImplementation(class {
    buildPlan = mockBuildPlan;
    applyPlan = mockApplyPlan;
  }),
}));

vi.mock('../../src/core/orchestration/verifier', () => ({
  Verifier: vi.fn().mockImplementation(class {
    runVerificationPipeline = vi.fn();
  }),
}));

vi.mock('../../src/core/registry/registryLoader', () => ({
  loadRegistry: vi.fn().mockResolvedValue({ assistants: [], dialectCatalog: {} }),
}));

vi.mock('../../src/core/detection/detectRemote', () => ({
  detectRemote: vi.fn(() => ({ isRemote: false, remoteType: 'local', hostInfo: 'Local machine', isLocalhost: true, warningMessages: [] }))
}));

vi.mock('../../src/ui/output', () => ({
  getOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), append: vi.fn(), show: vi.fn(), clear: vi.fn() }))
}));

vi.mock('../../src/ui/notifications', () => ({
  showSuccess: mockShowSuccess,
  showWarning: mockShowWarning,
  showError: mockShowError,
  showInfo: vi.fn(),
  withProgress: (_title: unknown, task: (p: unknown) => Promise<unknown>) => task({ report: vi.fn() })
}));

import { manageProfiles } from '../../src/commands/manageProfiles';
import { PlanApplier } from '../../src/core/orchestration/applier';
import { createPlan } from '../../src/core/orchestration/planBuilder';
import type { AppliedStep, ChangeLogEntry } from '../../src/core/orchestration/changeLog';
import type { AssistantApplyResult } from '../../src/core/orchestration/assistantOutcome';

const sourceProfile = {
  id: 'profile-a', name: 'OpenAI Prod', baseUrl: 'https://gateway-a.example.com/v1',
  dialect: 'openai.chat_completions', profileType: 'custom', authRef: 'OpenAI Prod',
  createdAt: '2026-05-18T00:00:00.000Z', updatedAt: '2026-05-18T00:00:00.000Z'
};
const targetProfile = {
  id: 'profile-b', name: 'OpenAI Stage', baseUrl: 'https://gateway-b.example.com/v1',
  dialect: 'openai.chat_completions', profileType: 'custom', authRef: 'OpenAI Stage',
  createdAt: '2026-05-18T00:00:00.000Z', updatedAt: '2026-05-18T00:00:00.000Z'
};

/** Full truthful status union (mirrors AssistantApplyStatus). */
type ApplyStatus = 'configured' | 'guided-required' | 'unsupported' | 'deferred' | 'failed';

type MutationAction = 'edit-config-file' | 'set-vscode-setting' | 'write-env-file';

interface StepLike {
  id: string;
  action: string;
  assistantKey: string;
  targetPath?: string;
  data?: Record<string, unknown>;
  reversible?: boolean;
  [key: string]: unknown;
}
interface PlanLike {
  id: string;
  profileId: string;
  assistantKeys: string[];
  steps: StepLike[];
  [key: string]: unknown;
}

interface AssistantSpec {
  assistantKey: string;
  status: ApplyStatus;
  /**
   * The REAL mutationApplied flag the AppliedStep record carries for the
   * executed mutation step. undefined = legacy step without the field
   * (production treats an executed mutation action as a mutation).
   */
  mutationApplied?: boolean;
  /** Raw buildPlan action for this assistant (default edit-config-file). */
  action?: MutationAction | 'show-guided-steps';
  reason?: string;
}

interface RestoreSpec {
  status: ApplyStatus;
  mutationApplied?: boolean;
  reason?: string;
}

const TS = '2026-05-18T00:00:00.000Z';

function planFor(profileId: string, steps: StepLike[]): PlanLike {
  return {
    id: `plan-${profileId}-${steps.map(step => step.assistantKey).join('-')}`,
    profileId,
    assistantKeys: [...new Set(steps.map(step => step.assistantKey))],
    createdAt: TS,
    status: 'pending',
    steps
  };
}

function assistantResultShape(status: ApplyStatus, reason?: string): AssistantApplyResult {
  return {
    status,
    success: status === 'configured',
    ...(reason !== undefined ? { reason } : {})
  };
}

/**
 * Builds the PRODUCTION-shaped ApplierResult for a single-assistant plan:
 * appliedSteps always carries the executed PlanSteps (completed:true, even
 * for skipped no-ops), while changeLogEntry.steps carries the AppliedStep
 * record with the real mutationApplied flag. A failed assistant rolls its
 * steps back → no change-log entry → the composite fallback (steps: []).
 */
function applierResultFor(plan: PlanLike, spec: { status: ApplyStatus; mutationApplied?: boolean; reason?: string }) {
  const key = plan.assistantKeys[0];
  const steps = plan.steps.filter(step => step.assistantKey === key);

  if (spec.status === 'failed') {
    return {
      success: false,
      appliedSteps: [] as Array<StepLike & { completed?: boolean }>,
      failedSteps: steps.map(step => ({ ...step, completed: false, error: spec.reason ?? 'write failed' })),
      changeLogEntry: {
        id: plan.id,
        timestamp: TS,
        assistantKey: key,
        profileName: plan.profileId,
        steps: [] as AppliedStep[]
      } satisfies ChangeLogEntry,
      assistantResults: new Map([[key, assistantResultShape('failed', spec.reason ?? 'write failed')]])
    };
  }

  return {
    success: true,
    appliedSteps: steps.map(step => ({ ...step, completed: true })),
    failedSteps: [] as Array<StepLike & { completed?: boolean }>,
    changeLogEntry: {
      id: `${plan.id}-${key}`,
      timestamp: TS,
      assistantKey: key,
      profileName: plan.profileId,
      steps: steps.map(step => ({
        type: step.action,
        target: step.targetPath ?? '',
        timestamp: TS,
        ...(spec.mutationApplied !== undefined ? { mutationApplied: spec.mutationApplied } : {})
      })) as unknown as AppliedStep[]
    } satisfies ChangeLogEntry,
    assistantResults: new Map([[key, assistantResultShape(spec.status, spec.reason)]])
  };
}

/** In-memory mapping store mirroring ProfileStore semantics for the flow. */
let mappings: Array<{ assistantKey: string; profileId: string; appliedMode: string; appliedAt: string }>;

function seedMappings(specs: AssistantSpec[]): void {
  mappings = specs.map(spec => ({
    assistantKey: spec.assistantKey,
    profileId: sourceProfile.id,
    appliedMode: 'configFile',
    appliedAt: TS
  }));
}

/**
 * Drives the Delete → Reassign transaction through manageProfiles.
 * buildPlan returns the RAW plan (one step per requested assistant, action
 * per spec); the REAL buildAutomatedReapplyPlan inside manageProfiles filters
 * it exactly as in production. applyPlan returns production-shaped results
 * scripted per assistant. Returns every plan passed to applyPlan.
 */
async function runReassignFlow(
  outcomeSequence: AssistantSpec[],
  restoreSpec: RestoreSpec = { status: 'configured', mutationApplied: true }
): Promise<PlanLike[]> {
  const plans: PlanLike[] = [];

  mockGetProfiles
    .mockResolvedValue([sourceProfile, targetProfile]);
  mockGetActiveProfileId.mockResolvedValue(sourceProfile.id);

  seedMappings(outcomeSequence);
  mockGetAssistantMappings.mockImplementation(async () => mappings.map(entry => ({ ...entry })));
  mockSaveAssistantMapping.mockImplementation(async (mapping: { assistantKey: string; profileId: string; appliedMode?: string; appliedAt?: string }) => {
    const index = mappings.findIndex(m => m.assistantKey === mapping.assistantKey && m.profileId === mapping.profileId);
    const record = {
      assistantKey: mapping.assistantKey,
      profileId: mapping.profileId,
      appliedMode: mapping.appliedMode ?? 'configFile',
      appliedAt: mapping.appliedAt ?? TS
    };
    if (index >= 0) {
      mappings[index] = record;
    } else {
      mappings.push(record);
    }
    return undefined;
  });
  mockDeleteAssistantMapping.mockImplementation(async (assistantKey: string, profileId: string) => {
    mappings = mappings.filter(m => !(m.assistantKey === assistantKey && m.profileId === profileId));
    return undefined;
  });

  mockBuildPlan.mockImplementation(async (profile: { id: string }, keys: string[]) =>
    planFor(profile.id, keys.map(key => {
      const spec = outcomeSequence.find(entry => entry.assistantKey === key);
      const action = spec?.action ?? 'edit-config-file';
      return {
        id: `step-${key}-${profile.id}`,
        action,
        description: `${action} for ${key}`,
        assistantKey: key,
        targetPath: action === 'show-guided-steps' ? undefined : `${key}.target`,
        data: action === 'show-guided-steps' ? { message: 'manual steps' } : {},
        reversible: action !== 'show-guided-steps'
      } satisfies StepLike;
    })));

  mockApplyPlan.mockImplementation(async (reapplyPlan: PlanLike) => {
    plans.push(reapplyPlan);
    const key = reapplyPlan.assistantKeys[0];
    if (reapplyPlan.profileId === sourceProfile.id) {
      return applierResultFor(reapplyPlan, restoreSpec);
    }
    const spec = outcomeSequence.find(entry => entry.assistantKey === key);
    if (!spec) {
      throw new Error(`No scripted outcome for assistant ${key} against ${reapplyPlan.profileId}`);
    }
    return applierResultFor(reapplyPlan, spec);
  });

  const quickPick = mockShowQuickPick;
  quickPick
    .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile: sourceProfile })
    .mockResolvedValueOnce({ label: '$(trash) Delete Profile' })
    .mockResolvedValueOnce({ label: '$(arrow-right) Reassign to another profile' })
    .mockResolvedValueOnce({ label: targetProfile.name, profile: targetProfile })
    .mockResolvedValueOnce(undefined);

  await manageProfiles({} as never);
  return plans;
}

describe('P1/P2: transactional reassignment restoration', () => {
  let tempDirValue: string;

  beforeEach(async () => {
    tempDirValue = await fs.mkdtemp(path.join(os.tmpdir(), 'reassign-'));
    for (const spy of [mockBuildPlan, mockApplyPlan, mockShowSuccess, mockShowWarning, mockShowError, mockDeleteProfile, mockSetActiveProfile, mockUpdateStatusBar, mockDeleteAssistantMapping, mockSaveAssistantMapping, mockShowQuickPick, mockGetProfiles, mockGetAssistantMappings, mockGetActiveProfileId]) {
      spy.mockReset();
    }
    mockDeleteProfile.mockResolvedValue(undefined);
    mockDeleteAssistantMapping.mockResolvedValue(undefined);
    mockSaveAssistantMapping.mockResolvedValue(undefined);
    mockGetSecret.mockResolvedValue('secret-token');
    mockConfigUpdate.mockReset();
    mockConfigUpdate.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(tempDirValue, { recursive: true, force: true });
  });

  it('CRITICAL: deferred no-op (mutationApplied=false in the AppliedStep) is NOT a restore candidate', async () => {
    // Copilot's set-vscode-setting EXECUTED (completed:true in appliedSteps —
    // the old classifier read that as a mutation) but the AppliedStep record
    // says mutationApplied=false: nothing was written. Continue hard-fails.
    await runReassignFlow([
      { assistantKey: 'github-copilot', status: 'deferred', mutationApplied: false, action: 'set-vscode-setting', reason: 'unregistered setting' },
      { assistantKey: 'continue', status: 'failed', mutationApplied: false, reason: 'write failed' }
    ]);

    expect(mockDeleteProfile).not.toHaveBeenCalled();
    // Copilot was NOT in any source reapply: plan #1 = target apply (copilot),
    // #2 = target apply (continue), NO profile-a restore plan.
    const applyProfileIds = mockApplyPlan.mock.calls.map(call => (call[0] as PlanLike).profileId);
    expect(applyProfileIds).toEqual(['profile-b', 'profile-b']);
    expect(mockApplyPlan.mock.calls.some(call =>
      (call[0] as PlanLike).profileId === sourceProfile.id &&
      (call[0] as PlanLike).assistantKeys.includes('github-copilot')
    )).toBe(false);
    // No mutation happened at all → abort without restoration path.
    expect(mockShowError).toHaveBeenCalledWith(
      'Failed to reassign assistants to "OpenAI Stage". The original profile was kept. Failed assistants: continue.'
    );
    // Mappings are untouched: both assistants still map to the source.
    expect(mappings.map(m => `${m.assistantKey}->${m.profileId}`).sort())
      .toEqual(['continue->profile-a', 'github-copilot->profile-a']);
  });

  it('guided-required WITH real mutation (edit-config-file, mutationApplied=true) IS restored', async () => {
    await runReassignFlow([
      { assistantKey: 'openai-codex', status: 'guided-required', mutationApplied: true, reason: 'credential missing' },
      { assistantKey: 'continue', status: 'failed', mutationApplied: false, reason: 'write failed' }
    ]);

    expect(mockDeleteProfile).not.toHaveBeenCalled();
    const applyProfileIds = mockApplyPlan.mock.calls.map(call => (call[0] as PlanLike).profileId);
    expect(applyProfileIds).toEqual(['profile-b', 'profile-b', 'profile-a']);
    const restorePlan = mockApplyPlan.mock.calls[2][0] as PlanLike;
    expect(restorePlan.assistantKeys).toEqual(['openai-codex']);
    expect(mockShowError).toHaveBeenCalledWith(
      'Failed to reassign assistants to "OpenAI Stage". The original profile was kept and previously switched assistants were restored to "OpenAI Prod". Failed assistants: continue.'
    );
  });

  it('guided-required with legacy AppliedStep (mutationApplied undefined) IS a restore candidate', async () => {
    await runReassignFlow([
      { assistantKey: 'openai-codex', status: 'guided-required', mutationApplied: undefined, reason: 'credential missing' },
      { assistantKey: 'continue', status: 'failed', mutationApplied: false, reason: 'write failed' }
    ]);

    const applyProfileIds = mockApplyPlan.mock.calls.map(call => (call[0] as PlanLike).profileId);
    expect(applyProfileIds).toEqual(['profile-b', 'profile-b', 'profile-a']);
    const restorePlan = mockApplyPlan.mock.calls[2][0] as PlanLike;
    expect(restorePlan.assistantKeys).toEqual(['openai-codex']);
  });

  it('write-env-file real mutation + guided-required (Codex stale-key case) IS restored', async () => {
    await runReassignFlow([
      { assistantKey: 'openai-codex', status: 'guided-required', mutationApplied: true, action: 'write-env-file', reason: 'no saved credential' },
      { assistantKey: 'continue', status: 'failed', mutationApplied: false, reason: 'write failed' }
    ]);

    const applyProfileIds = mockApplyPlan.mock.calls.map(call => (call[0] as PlanLike).profileId);
    expect(applyProfileIds).toEqual(['profile-b', 'profile-b', 'profile-a']);
    const restorePlan = mockApplyPlan.mock.calls[2][0] as PlanLike;
    expect(restorePlan.assistantKeys).toEqual(['openai-codex']);
  });

  it('guided-only (show-guided-steps only) is filtered to a skip — never applied, never restored', async () => {
    await runReassignFlow([
      { assistantKey: 'anythingllm', status: 'guided-required', mutationApplied: false, action: 'show-guided-steps', reason: 'manual follow-up required' },
      { assistantKey: 'continue', status: 'failed', mutationApplied: false, reason: 'write failed' }
    ]);

    // buildAutomatedReapplyPlan drops guidance-only steps → the assistant is
    // SKIPPED before applyPlan (no reapply plan, no restore candidate).
    const applyProfileIds = mockApplyPlan.mock.calls.map(call => (call[0] as PlanLike).profileId);
    expect(applyProfileIds).toEqual(['profile-b']);
    expect(mockApplyPlan.mock.calls.some(call => (call[0] as PlanLike).assistantKeys.includes('anythingllm'))).toBe(false);
    expect(mockShowError).toHaveBeenCalledWith(
      'Failed to reassign assistants to "OpenAI Stage". The original profile was kept. Failed assistants: continue.'
    );
  });

  it('unsupported assistant with no real mutation is NOT a restore candidate', async () => {
    await runReassignFlow([
      { assistantKey: 'tabnine', status: 'unsupported', mutationApplied: false, reason: 'endpoint switching unsupported' },
      { assistantKey: 'continue', status: 'failed', mutationApplied: false, reason: 'write failed' }
    ]);

    const applyProfileIds = mockApplyPlan.mock.calls.map(call => (call[0] as PlanLike).profileId);
    // Target apply ran for tabnine (its reapply plan was non-empty), but the
    // AppliedStep record shows no mutation → no restoration reapply.
    expect(applyProfileIds).toEqual(['profile-b', 'profile-b']);
    expect(mockShowError).toHaveBeenCalledWith(
      'Failed to reassign assistants to "OpenAI Stage". The original profile was kept. Failed assistants: continue.'
    );
  });

  it('incomplete restoration (restore ends guided-required) reports manual recovery — no void placeholder', async () => {
    // Target: Cline configured (mutated), Continue failed. The source restore
    // for Cline returns guided-required → restoration is NOT complete.
    await runReassignFlow(
      [
        { assistantKey: 'cline', status: 'configured', mutationApplied: true },
        { assistantKey: 'continue', status: 'failed', mutationApplied: false, reason: 'write failed' }
      ],
      { status: 'guided-required', mutationApplied: true, reason: 'credential missing' }
    );

    expect(mockDeleteProfile).not.toHaveBeenCalled();
    expect(mockShowError).toHaveBeenCalledTimes(1);
    const message = mockShowError.mock.calls[0][0] as string;
    expect(message).toContain('automatic restoration to "OpenAI Prod" was incomplete');
    expect(message).toContain('Manual recovery may be required');
    expect(message).toContain('Failed assistants: continue');
    expect(message).toContain('Restore incomplete: cline');
    expect(message).toContain('Restore failures: ');
    // The only mapping deletion is the failed assistant's own cleanup
    // (continue @ target); Cline's target mapping is NOT deleted —
    // target-mapping deletion happens only after complete restoration.
    expect(mockDeleteAssistantMapping).toHaveBeenCalledTimes(1);
    expect(mockDeleteAssistantMapping).toHaveBeenCalledWith('continue', targetProfile.id);
    expect(mockDeleteAssistantMapping.mock.calls.some(call => call[0] === 'cline')).toBe(false);
    expect(mappings.map(m => `${m.assistantKey}->${m.profileId}`).sort())
      .toEqual(['cline->profile-a', 'continue->profile-a']);
  });

  it('restoration hard failure reports Restore failures and keeps mappings', async () => {
    await runReassignFlow(
      [
        { assistantKey: 'cline', status: 'configured', mutationApplied: true },
        { assistantKey: 'continue', status: 'failed', mutationApplied: false, reason: 'write failed' }
      ],
      { status: 'failed', reason: 'restore write failed' }
    );

    expect(mockDeleteProfile).not.toHaveBeenCalled();
    expect(mockShowError).toHaveBeenCalledTimes(1);
    const message = mockShowError.mock.calls[0][0] as string;
    expect(message).toContain('was incomplete');
    expect(message).toContain('Restore failures: cline');
    // Only the failed assistant's own cleanup deletes a target mapping.
    expect(mockDeleteAssistantMapping).toHaveBeenCalledTimes(1);
    expect(mockDeleteAssistantMapping).toHaveBeenCalledWith('continue', targetProfile.id);
    expect(mappings.map(m => `${m.assistantKey}->${m.profileId}`).sort())
      .toEqual(['cline->profile-a', 'continue->profile-a']);
  });

  it('successful restoration deletes ONLY target mappings and keeps source mappings', async () => {
    await runReassignFlow([
      { assistantKey: 'cline', status: 'configured', mutationApplied: true },
      { assistantKey: 'continue', status: 'failed', mutationApplied: false, reason: 'write failed' }
    ]);

    expect(mockDeleteProfile).not.toHaveBeenCalled();
    // Every restored candidate's TARGET mapping is removed...
    expect(mockDeleteAssistantMapping).toHaveBeenCalledWith('cline', targetProfile.id);
    // ...and never the SOURCE mapping (the assistant stays on the source).
    const deleteCalls = mockDeleteAssistantMapping.mock.calls as Array<[string, string]>;
    expect(deleteCalls.some(([key, profileId]) => key === 'cline' && profileId === sourceProfile.id)).toBe(false);
    expect(deleteCalls.some(([key, profileId]) => key === 'continue' && profileId === sourceProfile.id)).toBe(false);
    // 'continue' (the hard failure) only gets its failed-apply cleanup delete.
    expect(deleteCalls.filter(([key]) => key === 'continue'))
      .toEqual([['continue', targetProfile.id]]);
    // Final mapping state: both assistants still map to the source profile.
    expect(mappings.map(m => `${m.assistantKey}->${m.profileId}`).sort())
      .toEqual(['cline->profile-a', 'continue->profile-a']);
    expect(mockShowError).toHaveBeenCalledWith(
      'Failed to reassign assistants to "OpenAI Stage". The original profile was kept and previously switched assistants were restored to "OpenAI Prod". Failed assistants: continue.'
    );
  });

  it('configured AND guided-mutated assistants are BOTH restored when a third hard-fails', async () => {
    await runReassignFlow([
      { assistantKey: 'cline', status: 'configured', mutationApplied: true },
      { assistantKey: 'openai-codex', status: 'guided-required', mutationApplied: true, reason: 'credential missing' },
      { assistantKey: 'continue', status: 'failed', mutationApplied: false, reason: 'write failed' }
    ]);

    expect(mockDeleteProfile).not.toHaveBeenCalled();
    const applyProfileIds = mockApplyPlan.mock.calls.map(call => (call[0] as PlanLike).profileId);
    expect(applyProfileIds).toEqual(['profile-b', 'profile-b', 'profile-b', 'profile-a', 'profile-a']);
    const restoreKeys = mockApplyPlan.mock.calls.slice(3).map(call => (call[0] as PlanLike).assistantKeys[0]);
    expect(new Set(restoreKeys).has('cline')).toBe(true);
    expect(new Set(restoreKeys).has('openai-codex')).toBe(true);
    expect(mockShowError).toHaveBeenCalledWith(
      'Failed to reassign assistants to "OpenAI Stage". The original profile was kept and previously switched assistants were restored to "OpenAI Prod". Failed assistants: continue.'
    );
  });
});

describe('P2: real PlanApplier mutation + restore evidence (integration)', () => {
  let tmpDir: string;
  const GATEWAY_A = 'https://gateway-a.example.com/v1';
  const GATEWAY_B = 'https://gateway-b.example.com/v1';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reassign-applier-'));
    mockConfigUpdate.mockReset();
    mockConfigUpdate.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function newApplier(): PlanApplier {
    const store = new Map<string, unknown>();
    return new PlanApplier({
      globalState: {
        get: (key: string, d?: unknown) => store.has(key) ? store.get(key) : d,
        update: (key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); }
      }
    } as never);
  }

  function configStep(assistantKey: string, file: string, baseUrl: string) {
    return {
      id: `step-${assistantKey}-${baseUrl}`,
      action: 'edit-config-file' as const,
      description: `Rewrite ${assistantKey} endpoint`,
      assistantKey,
      targetPath: file,
      data: {
        configPath: file,
        configType: 't',
        driver: 'json-object',
        format: 'json',
        baseUrl,
        patches: [{ path: ['baseUrl'], value: baseUrl }]
      },
      reversible: true
    };
  }

  it('target apply mutates gateway-b with mutationApplied=true; restore writes gateway-a back', async () => {
    const applier = newApplier();
    const file = path.join(tmpDir, 'cline-providers.json');
    await fs.writeFile(file, `${JSON.stringify({ baseUrl: GATEWAY_A }, null, 2)}\n`);

    // TARGET apply: gateway-b.
    const targetPlan = createPlan('profile-b', ['cline']);
    targetPlan.steps.push(configStep('cline', file, GATEWAY_B));
    const targetResult = await applier.applyPlan(targetPlan, 'OpenAI Stage');

    expect(targetResult.success).toBe(true);
    expect(targetResult.assistantResults.get('cline')?.status).toBe('configured');
    // The REAL AppliedStep record carries the mutation evidence.
    const targetApplied = targetResult.changeLogEntry.steps[0];
    expect(targetApplied.type).toBe('edit-config-file');
    expect(targetApplied.mutationApplied).toBe(true);
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ baseUrl: GATEWAY_B });

    // RESTORE (abort): reapply the source → gateway-a comes back.
    const restorePlan = createPlan('profile-a', ['cline']);
    restorePlan.steps.push(configStep('cline', file, GATEWAY_A));
    const restoreResult = await applier.applyPlan(restorePlan, 'OpenAI Prod');

    expect(restoreResult.assistantResults.get('cline')?.status).toBe('configured');
    expect(restoreResult.changeLogEntry.steps[0].mutationApplied).toBe(true);
    expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual({ baseUrl: GATEWAY_A });
  });

  it('real skipped no-op records completed=true in appliedSteps but mutationApplied=false in the change log', async () => {
    const applier = newApplier();
    const plan = createPlan('profile-b', ['github-copilot']);
    plan.steps.push({
      id: 'step-copilot-setting',
      action: 'set-vscode-setting',
      description: 'Set Copilot proxy override',
      assistantKey: 'github-copilot',
      targetPath: 'unregistered.extension.setting',
      data: {},
      reversible: true
    });
    // Simulate VS Code rejecting the setting as unregistered — the same
    // wording applyVSCodeSetting matches to classify the step as a no-op.
    mockConfigUpdate.mockRejectedValueOnce(new Error(
      "It is not possible to register a configuration 'unregistered.extension.setting' because it is not a registered configuration"
    ));

    const result = await applier.applyPlan(plan, 'OpenAI Stage');

    // The step EXECUTED (plan-step completion says success)…
    expect(result.appliedSteps).toHaveLength(1);
    expect(result.appliedSteps[0].completed).toBe(true);
    // …but the AppliedStep record truthfully says nothing was written, and
    // the assistant is deferred — the exact evidence the reassignment
    // classifier must read instead of PlanStep.completed.
    expect(result.changeLogEntry.steps[0].mutationApplied).toBe(false);
    expect(result.assistantResults.get('github-copilot')?.status).toBe('deferred');
  });
});
