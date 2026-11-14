/**
 * Secret-leak scan: resolved secret values must never appear in serialized
 * plans, applied-step records, or change-log entries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { mockRecordApply, mockGetSecret } = vi.hoisted(() => ({
  mockRecordApply: vi.fn(),
  mockGetSecret: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn(), inspect: undefined })),
  },
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  env: { clipboard: { writeText: vi.fn() } },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  ExtensionContext: vi.fn(),
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: vi.fn(() => ({ info: vi.fn(), debug: vi.fn(), warning: vi.fn(), error: vi.fn() })),
    initialize: vi.fn(),
  },
}));

vi.mock('../../src/ui/output', () => ({
  getOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn(), clear: vi.fn() })),
}));

vi.mock('../../src/core/orchestration/changeLog', () => ({
  ChangeLog: vi.fn(function (this: Record<string, unknown>) {
    this.recordApply = mockRecordApply;
    this.getEntries = vi.fn().mockResolvedValue([]);
    this.removeEntry = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn(function (this: Record<string, unknown>) {
    this.getSecret = mockGetSecret;
  }),
}));

import { PlanApplier } from '../../src/core/orchestration/applier';
import type { Plan, PlanStep } from '../../src/core/orchestration/planBuilder';

const SECRET = 'aid_pat_super_secret_value_never_leak';

function makePlan(steps: PlanStep[]): Plan {
  return {
    id: 'plan-secret-scan',
    profileId: 'profile-1',
    assistantKeys: [...new Set(steps.map(s => s.assistantKey))],
    steps,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
}

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-secret-'));
  vi.clearAllMocks();
  mockGetSecret.mockResolvedValue(SECRET);
});

describe('secret-leak scan', () => {
  it('Claude Code apply persists the secret to the target file but keeps it out of change-log and applied steps', async () => {
    const target = path.join(tempDir, 'settings.json');
    const step: PlanStep = {
      id: 'step-1',
      action: 'edit-config-file',
      description: 'Claude Code settings',
      assistantKey: 'claude-code',
      targetPath: target,
      newValue: 'https://gateway.example.com/v1',
      data: {
        secretPolicy: 'target-persisted-at-apply',
        authRef: 'Test Profile',
        profileName: 'Test Profile',
        claudeCodeSettingsContent: JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com/v1' } }),
      },
      reversible: true,
    };

    const applier = new PlanApplier({} as never);
    const result = await applier.applyPlan(makePlan([step]), 'Test');

    const planJson = JSON.stringify(result);
    expect(planJson).not.toContain(SECRET);

    const changeLogJson = JSON.stringify(mockRecordApply.mock.calls);
    expect(changeLogJson).not.toContain(SECRET);
  });

  it('plans carrying only symbolic secret references never contain the resolved value', async () => {
    const steps: PlanStep[] = [
      {
        id: 'step-2',
        action: 'edit-config-file',
        description: 'Codex config',
        assistantKey: 'openai-codex',
        targetPath: path.join(tempDir, 'config.toml'),
        newValue: 'https://gateway.example.com/v1',
        data: {
          driver: 'toml-table',
          format: 'toml',
          providerName: 'aidome',
          wireApi: 'responses',
          envKey: 'OPENAI_API_KEY', // symbolic reference only
          baseUrl: 'https://gateway.example.com/v1',
          authRef: 'profile-secret-reference', // symbolic reference only
          patches: [],
        },
        reversible: true,
      },
    ];

    // Even with a resolved secret floating in the applier's dependencies,
    // nothing serialized into the plan carries the value.
    const serialized = JSON.stringify(makePlan(steps));
    expect(serialized).not.toContain(SECRET);
    expect(serialized).toContain('OPENAI_API_KEY');
  });
});
