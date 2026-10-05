/**
 * Regression tests for the config-file verbatim-write guard, the driver-less
 * step-data validation, and Logger error serialization.
 *
 * Incident context: a pre-driver Codex step emitted
 * `data: {configPath, baseUrl, format: 'toml', providerName: 'aidome'}`
 * without a `driver` and `newValue: profile.baseUrl`. The applier's
 * driver-less fallback wrote `step.newValue` verbatim, replacing the entire
 * ~/.codex/config.toml with the bare base URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as vscode from 'vscode';
import { createEnoentError } from './testErrors';

const {
  mockSafeWriteFile,
  mockCreateBackup,
  mockAccess,
  mockReadFile,
  mockGetSecret,
} = vi.hoisted(() => ({
  mockSafeWriteFile: vi.fn(),
  mockCreateBackup: vi.fn(),
  mockAccess: vi.fn(),
  mockReadFile: vi.fn(),
  mockGetSecret: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
  },
  extensions: {
    getExtension: vi.fn(),
  },
  ConfigurationTarget: { Global: 1 },
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  access: mockAccess,
  readFile: mockReadFile,
  unlink: vi.fn(),
}));

vi.mock('../../src/util/fsSafe', () => ({
  readFileSafe: vi.fn(),
  fileExists: vi.fn(),
  safeWriteFile: mockSafeWriteFile,
  createBackup: mockCreateBackup,
  writeFileAtomic: vi.fn(),
  isFileNotFoundError: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT',
}));

vi.mock('../../src/ui/output', () => ({
  getOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn(), clear: vi.fn() })),
}));

vi.mock('../../src/util/log', () => ({
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

vi.mock('../../src/core/orchestration/changeLog', () => ({
  ChangeLog: vi.fn(function (this: Record<string, unknown>) {
    this.recordApply = vi.fn().mockResolvedValue(undefined);
    this.getEntries = vi.fn().mockResolvedValue([]);
  }),
}));

import { PlanApplier } from '../../src/core/orchestration/applier';
import { validateConfigFileStepData } from '../../src/core/orchestration/planStepData';
import { PlanStep } from '../../src/core/orchestration/planBuilder';

/** The exact legacy pre-driver Codex step shape that corrupted config.toml. */
function legacyCodexStep(): PlanStep {
  return {
    id: 'step-legacy-codex',
    action: 'edit-config-file',
    description: 'Set Codex provider to http://80.240.29.183:8100/v1',
    assistantKey: 'openai-codex',
    targetPath: '/home/user/.codex/config.toml',
    newValue: 'http://80.240.29.183:8100/v1',
    data: {
      configPath: '/home/user/.codex/config.toml',
      profileId: 'test-service-pat',
      baseUrl: 'http://80.240.29.183:8100/v1',
      format: 'toml',
      providerName: 'aidome',
      wireApi: 'responses',
    },
    reversible: true,
  } as unknown as PlanStep;
}

describe('driver-less config-file steps are refused (config.toml corruption regression)', () => {
  it('validateConfigFileStepData rejects config metadata without a driver', () => {
    const validation = validateConfigFileStepData(legacyCodexStep().data);
    expect(validation.ok).toBe(false);
    expect(validation.error).toContain('no driver');
  });

  it('validateConfigFileStepData still accepts the legacy raw-value pattern (no data)', () => {
    expect(validateConfigFileStepData(undefined).ok).toBe(true);
    expect(validateConfigFileStepData({ anUnknownPayload: true }).ok).toBe(true);
  });

  it('PlanApplier refuses to write step.newValue verbatim for a driver-less metadata step', async () => {
    mockAccess.mockRejectedValue(createEnoentError());
    mockSafeWriteFile.mockResolvedValue(true);

    const applier = new PlanApplier({
      secrets: { get: mockGetSecret },
    } as unknown as vscode.ExtensionContext);

    await expect(applier.applyStep(legacyCodexStep())).rejects.toThrow(/no driver|without a driver/i);
    expect(mockSafeWriteFile).not.toHaveBeenCalled();
  });

  it('PlanApplier still writes verbatim for true legacy raw-value steps (no data)', async () => {
    mockAccess.mockRejectedValue(createEnoentError());
    mockSafeWriteFile.mockResolvedValue(true);

    const applier = new PlanApplier({
      secrets: { get: mockGetSecret },
    } as unknown as vscode.ExtensionContext);

    const step = {
      id: 'step-legacy-raw',
      action: 'edit-config-file',
      description: 'Legacy raw content write',
      assistantKey: 'generic',
      targetPath: '/home/user/legacy.txt',
      newValue: 'rendered content',
      reversible: true,
    } as unknown as PlanStep;

    await expect(applier.applyStep(step)).resolves.toBeDefined();
    expect(mockSafeWriteFile).toHaveBeenCalledWith('/home/user/legacy.txt', 'rendered content');
  });
});