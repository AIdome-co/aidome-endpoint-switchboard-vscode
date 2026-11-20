/**
 * Unit tests for the PlanApplier write-assistant-storage action.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanApplier } from '../../src/core/orchestration/applier';
import { PlanStep } from '../../src/core/orchestration/planBuilder';
import { isConfigurationMutationAction } from '../../src/core/orchestration/assistantOutcome';

vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: vi.fn(), update: vi.fn() }) },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: class {
    async getSecret(ref: string) {
      return `secret-for-${ref}`;
    }
  },
}));

// Mock the CodeGPT storage writer so we don't touch a real ~/.codegpt DB.
const writeConnection = vi.fn(async () => '/tmp/backup.sqlite');
const writeFlavor = vi.fn(async () => true);
vi.mock('../../src/adapters/codegpt/codegptStorage', () => ({
  writeCodeGptConnection: (...a: unknown[]) => writeConnection(...a),
  writeCodeGptLocalFlavor: (...a: unknown[]) => writeFlavor(...a),
  ensureCodeGptLocalFlavor: vi.fn(async () => ({ changed: false })),
  resolveDbPath: () => '/home/test/.codegpt/db.sqlite',
  resolveSettingsPath: () => '/home/test/.codegpt/settings.json',
  readCodeGptConnection: async () => undefined,
  resolveCodeGptHome: () => '/home/test/.codegpt',
  normalizeStorageBaseUrl: (u: string) => u,
  checkpointCodeGptDb: async () => true,
  backupCodeGptDb: async () => '/tmp/backup.sqlite',
  writeCodeGptConnectionViaSidecar: async () => false,
}));

// Loading the adapter module registers the CodeGPT storage writer with the
// generic `write-assistant-storage` dispatch.
import '../../src/adapters/codegpt/adapter';

describe('PlanApplier.write-assistant-storage', () => {
  let applier: PlanApplier;

  beforeEach(() => {
    vi.clearAllMocks();
    applier = new PlanApplier({} as any);
  });

  it('writes the CodeGPT connection with the resolved api key', async () => {
    const step: PlanStep = {
      id: 's1',
      action: 'write-assistant-storage',
      assistantKey: 'codegpt',
      targetPath: '/home/test/.codegpt',
      data: { baseUrl: 'http://host:8100', authRef: 'my-profile' },
      reversible: true,
    } as PlanStep;

    const applied = await applier.applyStep(step as any);

    // The registered writer now tries the sidecar first (mocked unavailable
    // here), so the direct write runs with skipBackup: the caller (writer)
    // already created the file backup.
    expect(writeConnection).toHaveBeenCalledWith('http://host:8100', 'secret-for-my-profile', undefined, { skipBackup: true });
    // Flavor write goes through ensureCodeGptLocalFlavor (mutation report).
    expect(writeFlavor).not.toHaveBeenCalled();
    expect(applied.backupPath).toBe('/tmp/backup.sqlite');
    expect(applied.target).toBe('/home/test/.codegpt/db.sqlite');
  });

  it('classifies the write as a configuration mutation (mapping persistence + rollback)', async () => {
    const step: PlanStep = {
      id: 's4',
      action: 'write-assistant-storage',
      assistantKey: 'codegpt',
      targetPath: '/home/test/.codegpt',
      data: { baseUrl: 'http://host:8100' },
      reversible: true,
    } as PlanStep;

    expect(isConfigurationMutationAction(step.action)).toBe(true);
    const applied = await applier.applyStep(step as any);
    expect(applied.mutationApplied).toBe(true);
  });

  it('throws when baseUrl is missing', async () => {
    const step = {
      id: 's2',
      action: 'write-assistant-storage',
      assistantKey: 'codegpt',
      data: {},
    } as PlanStep;

    await expect(applier.applyStep(step as any)).rejects.toThrow('baseUrl');
  });

  it('rejects when the flavor write fails (DB restore path, Codex 4648429521)', async () => {
    const step: PlanStep = {
      id: 's5',
      action: 'write-assistant-storage',
      assistantKey: 'codegpt',
      targetPath: '/home/test/.codegpt',
      data: { baseUrl: 'http://host:8100' },
      reversible: true,
    } as PlanStep;

    const storage = await import('../../src/adapters/codegpt/codegptStorage');
    const ensure = vi.mocked(storage.ensureCodeGptLocalFlavor as unknown as ReturnType<typeof vi.fn>);
    const original = ensure.getMockImplementation();
    ensure.mockImplementationOnce(async () => { throw new Error('unwritable'); });

    await expect(applier.applyStep(step as any)).rejects.toThrow(/flavor setting could not be written/);
    expect(ensure).toHaveBeenCalledTimes(1);

    ensure.mockImplementation(original as never);
  });

  it('throws for an unsupported assistant', async () => {
    const step = {
      id: 's3',
      action: 'write-assistant-storage',
      assistantKey: 'cline',
      data: { baseUrl: 'http://host' },
    } as PlanStep;

    await expect(applier.applyStep(step as any)).rejects.toThrow('not supported');
  });
});
