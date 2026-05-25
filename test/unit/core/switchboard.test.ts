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
          configBuilder: 'claude-code-settings',
          authRef: 'Claude Profile',
          envVars: ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'],
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

  it('defers Claude SecretStorage auth injection until plan apply time', async () => {
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

    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(settings.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(mockGetSecret).not.toHaveBeenCalled();
    expect(step.data.envVars).toContain('ANTHROPIC_AUTH_TOKEN');
  });

  it('adds a guided fallback step when an assistant adapter build fails', async () => {
    mockGetAdapter.mockResolvedValue({
      buildPlan: vi.fn().mockRejectedValue(new Error('adapter exploded')),
    });

    const switchboard = new Switchboard(
      {} as any,
      { assistants: [], dialectCatalog: {} } as any,
      { getProfiles: vi.fn(), saveAssistantMapping: vi.fn(), saveProfile: vi.fn() } as any,
      { getSecret: mockGetSecret } as any
    );

    const plan = await switchboard.buildPlan(profile, ['anythingllm']);

    expect(plan.assistantKeys).toEqual(['anythingllm']);
    expect(plan.steps).toEqual([
      expect.objectContaining({
        action: 'show-guided-steps',
        assistantKey: 'anythingllm',
        reversible: false,
      }),
    ]);
  });

  it('persists applied assistant mappings by profileId even when the plan partially fails', async () => {
    const profileStore = {
      getProfiles: vi.fn().mockResolvedValue([profile]),
      saveAssistantMapping: vi.fn().mockResolvedValue(undefined),
      saveProfile: vi.fn(),
    };
    mockApplyPlan.mockResolvedValue({
      success: false,
      appliedSteps: [
        {
          id: 'step-1',
          action: 'edit-config-file',
          description: 'Configure Claude Code gateway environment',
          assistantKey: 'claude-code',
          data: {},
          reversible: true,
        },
      ],
      failedSteps: [
        {
          id: 'step-2',
          action: 'set-vscode-setting',
          description: 'Set another assistant base URL',
          assistantKey: 'cline',
          data: {},
          reversible: true,
          error: 'settings failed',
        },
      ],
      assistantResults: new Map([
        ['claude-code', { success: true }],
        ['cline', { success: false, reason: 'settings failed' }],
      ]),
    });

    const switchboard = new Switchboard(
      {} as any,
      { assistants: [], dialectCatalog: {} } as any,
      profileStore as any,
      { getSecret: mockGetSecret } as any
    );

    await switchboard.applyPlan({
      id: 'plan-apply',
      profileId: profile.id,
      assistantKeys: ['claude-code', 'cline'],
      createdAt: '2026-05-20T00:00:00.000Z',
      status: 'pending',
      steps: [],
    });

    expect(profileStore.saveAssistantMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantKey: 'claude-code',
        profileId: profile.id,
        appliedMode: 'configFile',
      })
    );
  });
});
