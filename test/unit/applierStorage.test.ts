/**
 * Unit tests for the PlanApplier write-assistant-storage action.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanApplier } from '../../src/core/orchestration/applier';
import { PlanStep } from '../../src/core/orchestration/planBuilder';

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
  resolveDbPath: () => '/home/test/.codegpt/db.sqlite',
}));

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

    expect(writeConnection).toHaveBeenCalledWith('http://host:8100', 'secret-for-my-profile', undefined);
    expect(writeFlavor).toHaveBeenCalled();
    expect(applied.backupPath).toBe('/tmp/backup.sqlite');
    expect(applied.target).toBe('/home/test/.codegpt/db.sqlite');
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
