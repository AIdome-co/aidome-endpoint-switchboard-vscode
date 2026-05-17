import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointProfile } from '../../../src/core/profiles/profileTypes';

const {
  mockGetAdapter,
  mockAdapterBuildPlan,
  mockGetSecret,
} = vi.hoisted(() => ({
  mockGetAdapter: vi.fn(),
  mockAdapterBuildPlan: vi.fn(),
  mockGetSecret: vi.fn(),
}));

vi.mock('../../../src/adapters/adapters.index', () => ({
  getAdapter: mockGetAdapter,
}));

vi.mock('../../../src/core/orchestration/applier', () => ({
  PlanApplier: vi.fn().mockImplementation(class {
    applyPlan = vi.fn();
    rollbackPlan = vi.fn();
  })
}));

vi.mock('../../../src/core/orchestration/verifier', () => ({
  Verifier: vi.fn().mockImplementation(class {})
}));

vi.mock('../../../src/core/detection/detectExtensions', () => ({
  detectExtensions: vi.fn(() => [])
}));

vi.mock('../../../src/core/detection/detectCLIs', () => ({
  detectCLIs: vi.fn().mockResolvedValue([])
}));

vi.mock('../../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    })
  }
}));

vi.mock('../../../src/util/operationTimer', () => ({
  startTimer: () => ({ stop: () => 0 })
}));

vi.mock('../../../src/util/retry', () => ({
  withRetry: async <T>(operation: () => Promise<T>) => await operation()
}));

import { Switchboard } from '../../../src/core/orchestration/switchboard';

describe('Switchboard.buildPlan', () => {
  const profile: EndpointProfile = {
    id: 'profile-1',
    name: 'claude-test3',
    baseUrl: 'https://demo-lab-vm-8a4ad0fc.aidome.cloud/v1',
    dialect: 'anthropic.messages',
    profileType: 'aidome',
    authRef: 'claude-test3',
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSecret.mockResolvedValue('aid_pat_test');
    mockAdapterBuildPlan.mockResolvedValue({
      id: 'assistant-plan',
      profileId: profile.id,
      assistantKeys: ['claude-code'],
      steps: [],
      createdAt: '2026-05-16T00:00:00.000Z',
      status: 'pending'
    });
    mockGetAdapter.mockResolvedValue({
      buildPlan: mockAdapterBuildPlan
    });
  });

  it('passes the stored profile secret to the Claude Code adapter build context', async () => {
    const switchboard = new Switchboard(
      {} as any,
      {} as any,
      {} as any,
      { getSecret: mockGetSecret } as any
    );

    await switchboard.buildPlan(profile, ['claude-code']);

    expect(mockGetSecret).toHaveBeenCalledWith('claude-test3');
    expect(mockAdapterBuildPlan).toHaveBeenCalledWith(profile, { authSecret: 'aid_pat_test' });
  });

  it('falls back to the profile name when authRef is missing', async () => {
    const switchboard = new Switchboard(
      {} as any,
      {} as any,
      {} as any,
      { getSecret: mockGetSecret } as any
    );

    await switchboard.buildPlan({ ...profile, authRef: undefined }, ['claude-code']);

    expect(mockGetSecret).toHaveBeenCalledWith('claude-test3');
    expect(mockAdapterBuildPlan).toHaveBeenCalledWith(
      { ...profile, authRef: undefined },
      { authSecret: 'aid_pat_test' }
    );
  });

  it('tries authRef first, then falls back to the profile name', async () => {
    mockGetSecret
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('aid_pat_fallback');

    const switchboard = new Switchboard(
      {} as any,
      {} as any,
      {} as any,
      { getSecret: mockGetSecret } as any
    );

    await switchboard.buildPlan({ ...profile, authRef: 'legacy-secret-ref' }, ['claude-code']);

    expect(mockGetSecret).toHaveBeenNthCalledWith(1, 'legacy-secret-ref');
    expect(mockGetSecret).toHaveBeenNthCalledWith(2, 'claude-test3');
    expect(mockAdapterBuildPlan).toHaveBeenCalledWith(
      { ...profile, authRef: 'legacy-secret-ref' },
      { authSecret: 'aid_pat_fallback' }
    );
  });
});