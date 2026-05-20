import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointProfile } from '../../../src/core/profiles/profileTypes';
import type { Plan } from '../../../src/core/orchestration/planBuilder';

const {
  mockGetAdapter,
  mockGetSecret,
  mockApplyPlan,
  mockVerifyEndpoint,
} = vi.hoisted(() => ({
  mockGetAdapter: vi.fn(),
  mockGetSecret: vi.fn(),
  mockApplyPlan: vi.fn(),
  mockVerifyEndpoint: vi.fn(),
}));

vi.mock('vscode', () => ({}));

vi.mock('../../../src/adapters/adapters.index', () => ({
  getAdapter: mockGetAdapter,
}));

vi.mock('../../../src/core/orchestration/applier', () => ({
  PlanApplier: vi.fn().mockImplementation(class {
    applyPlan = mockApplyPlan;
    rollbackPlan = vi.fn();
  }),
}));

vi.mock('../../../src/core/orchestration/verifier', () => ({
  Verifier: vi.fn().mockImplementation(class {
    verifyEndpoint = mockVerifyEndpoint;
  }),
}));

vi.mock('../../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { Switchboard } from '../../../src/core/orchestration/switchboard';

describe('Switchboard Claude auth secret hydration', () => {
  const profile: EndpointProfile = {
    id: 'profile-1',
    name: 'Claude Profile',
    profileType: 'aidome',
    baseUrl: 'https://gateway.example.com/v1',
    dialect: 'openai.chat_completions',
    authRef: 'Claude Profile',
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z',
  };

  const basePlan: Plan = {
    id: 'plan-1',
    profileId: profile.id,
    assistantKeys: ['claude-code'],
    createdAt: '2026-05-20T00:00:00.000Z',
    status: 'pending',
    steps: [
      {
        id: 'step-1',
        action: 'edit-config-file',
        description: 'Configure Claude Code gateway environment',
        assistantKey: 'claude-code',
        targetPath: '/home/user/.claude/settings.json',
        newValue: JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'https://old.example.com/v1',
            EXISTING_VAR: 'kept',
          },
        }),
        data: {
          envVars: ['ANTHROPIC_BASE_URL', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'],
        },
        reversible: true,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApplyPlan.mockResolvedValue({ success: true, appliedSteps: [], failedSteps: [], assistantResults: new Map() });
    mockVerifyEndpoint.mockResolvedValue({ status: 'success', checks: [] });
  });

  it('injects ANTHROPIC_API_KEY into Claude edit-config-file steps when the profile has a stored secret', async () => {
    mockGetSecret.mockResolvedValue('aid_pat_test');
    mockGetAdapter.mockResolvedValue({
      buildPlan: vi.fn().mockResolvedValue(basePlan),
    });

    const switchboard = new Switchboard(
      {} as any,
      { assistants: [], dialectCatalog: {} } as any,
      {} as any,
      { getSecret: mockGetSecret } as any
    );

    const plan = await switchboard.buildPlan(profile, ['claude-code']);
    const step = plan.steps[0];
    const settings = JSON.parse(step.newValue as string);

    expect(mockGetSecret).toHaveBeenCalledWith(profile.authRef);
    expect(settings.env.ANTHROPIC_API_KEY).toBe('aid_pat_test');
    expect(step.data.envVars).toContain('ANTHROPIC_API_KEY');
  });

  it('removes a stale ANTHROPIC_API_KEY when the profile expects secret-managed auth but no secret is stored', async () => {
    mockGetSecret.mockResolvedValue(undefined);
    mockGetAdapter.mockResolvedValue({
      buildPlan: vi.fn().mockResolvedValue({
        ...basePlan,
        steps: [
          {
            ...basePlan.steps[0],
            newValue: JSON.stringify({
              env: {
                ANTHROPIC_API_KEY: 'stale-key',
                EXISTING_VAR: 'kept',
              },
            }),
          },
        ],
      }),
    });

    const switchboard = new Switchboard(
      {} as any,
      { assistants: [], dialectCatalog: {} } as any,
      {} as any,
      { getSecret: mockGetSecret } as any
    );

    const plan = await switchboard.buildPlan(profile, ['claude-code']);
    const settings = JSON.parse(plan.steps[0].newValue as string);

    expect(settings.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(settings.env.EXISTING_VAR).toBe('kept');
  });
});