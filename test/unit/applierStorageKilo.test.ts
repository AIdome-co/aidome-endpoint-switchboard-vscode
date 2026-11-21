/**
 * Unit tests for the PlanApplier's write-assistant-storage metadata contract:
 * noOp truthfulness, secretResolved, and rollback-metadata carry-through
 * (Codex 154 round-1 findings g and n).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanApplier } from '../../src/core/orchestration/applier';
import {
  registerAssistantStorageWriter
} from '../../src/core/orchestration/assistantStorageWriters';
import type { PlanStep } from '../../src/core/orchestration/planBuilder';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }
}));

vi.mock('../../src/util/log', () => ({
  Logger: { getInstance: () => mockLogger }
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: class {
    async getSecret(ref: string) {
      return `secret-for-${ref}`;
    }
  }
}));

vi.mock('vscode', () => ({
  window: { showErrorMessage: vi.fn(), showWarningMessage: vi.fn(), showInformationMessage: vi.fn() },
  workspace: { getConfiguration: () => ({ get: () => undefined, update: vi.fn() }) }
}));

const TEST_KEY = 'test-storage-assistant';

describe('PlanApplier write-assistant-storage metadata contract', () => {
  let applier: PlanApplier;

  beforeEach(() => {
    vi.clearAllMocks();
    applier = new PlanApplier({} as any);
  });

  const step = (data: Record<string, unknown>): PlanStep =>
    ({
      id: 's1',
      action: 'write-assistant-storage',
      assistantKey: TEST_KEY,
      targetPath: '/tmp/target',
      data,
      reversible: true
    }) as PlanStep;

  it('carries createdFile and extraRollbacks from the writer result into the applied step', async () => {
    const extra = [{ target: '/tmp/extra', backupPath: '/tmp/extra.bak', createdFile: false }];
    registerAssistantStorageWriter(TEST_KEY, async () => ({
      backupPath: '/tmp/primary.bak',
      target: '/tmp/primary',
      createdFile: true,
      extraRollbacks: extra,
      modelsApplied: true,
      modelsRequired: true
    }));

    const applied = await applier.applyStep(step({ baseUrl: 'http://host:8100', authRef: 'p1' }) as any);

    expect(applied.mutationApplied).toBe(true);
    expect(applied.createdFile).toBe(true);
    expect(applied.extraRollbacks).toEqual(extra);
    expect(applied.modelsApplied).toBe(true);
    expect(applied.modelsRequired).toBe(true);
    expect(applied.backupPath).toBe('/tmp/primary.bak');
    expect(applied.target).toBe('/tmp/primary');
    // The applier resolved the secret for the step.
    expect(applied.secretResolved).toBe(true);
  });

  it('reports secretResolved=false and truthy mutationApplied when the credential is missing but a write happened', async () => {
    registerAssistantStorageWriter(TEST_KEY, async () => ({
      target: '/tmp/primary',
      createdFile: false
    }));

    const applied = await applier.applyStep(step({ baseUrl: 'http://host:8100' }) as any);

    expect(applied.secretResolved).toBe(false);
    expect(applied.mutationApplied).toBe(true);
  });

  it('classifies a writer-reported no-op as a non-mutation (mutationApplied=false)', async () => {
    registerAssistantStorageWriter(TEST_KEY, async () => ({
      noOp: true,
      authRequired: true,
      target: '/tmp/primary',
      createdFile: false
    }));

    const applied = await applier.applyStep(step({ baseUrl: 'http://host:8100' }) as any);

    expect(applied.mutationApplied).toBe(false);
    expect(applied.secretResolved).toBe(false);
    expect(applied.authRequired).toBe(true);
  });

  it('does NOT mark an authentication gap when the writer contract allows no credential', async () => {
    registerAssistantStorageWriter(TEST_KEY, async () => ({
      target: '/tmp/primary',
      createdFile: false
      // no authRequired — the vendor contract makes an unauthenticated
      // configuration valid (CodeGPT-style key-less connection)
    }));

    const applied = await applier.applyStep(step({ baseUrl: 'http://host:8100' }) as any);

    expect(applied.mutationApplied).toBe(true);
    expect(applied.secretResolved).toBe(false);
    expect(applied.authRequired).toBeUndefined();
  });
});
