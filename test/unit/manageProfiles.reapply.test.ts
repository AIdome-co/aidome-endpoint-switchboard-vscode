import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointProfile } from '../../src/core/profiles/profileTypes';

const {
  mockShowQuickPick,
  mockShowInputBox,
  mockWithProgress,
  mockShowSuccess,
  mockShowWarning,
  mockShowError,
  mockGetProfiles,
  mockGetAssistantMappings,
  mockSaveProfile,
  mockBuildPlan,
  mockApplyPlan,
  mockLoadRegistry,
} = vi.hoisted(() => ({
  mockShowQuickPick: vi.fn(),
  mockShowInputBox: vi.fn(),
  mockWithProgress: vi.fn(),
  mockShowSuccess: vi.fn(),
  mockShowWarning: vi.fn(),
  mockShowError: vi.fn(),
  mockGetProfiles: vi.fn(),
  mockGetAssistantMappings: vi.fn(),
  mockSaveProfile: vi.fn(),
  mockBuildPlan: vi.fn(),
  mockApplyPlan: vi.fn(),
  mockLoadRegistry: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    showQuickPick: mockShowQuickPick,
    showInputBox: mockShowInputBox,
    showInformationMessage: mockShowSuccess,
    showWarningMessage: mockShowWarning,
    showErrorMessage: mockShowError,
    withProgress: mockWithProgress,
  },
  ProgressLocation: { Notification: 15 },
  QuickPickItemKind: { Default: 0, Separator: -1 },
}));

vi.mock('../../src/core/profiles/profileStore', () => ({
  ProfileStore: vi.fn().mockImplementation(class {
    getProfiles = mockGetProfiles;
    getAssistantMappings = mockGetAssistantMappings;
    saveProfile = mockSaveProfile;
    getActiveProfileId = vi.fn();
    setActiveProfile = vi.fn();
    deleteProfile = vi.fn();
    saveAssistantMapping = vi.fn();
    deleteAssistantMapping = vi.fn();
  }),
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn().mockImplementation(class {
    getSecret = vi.fn();
    deleteSecret = vi.fn();
    storeSecret = vi.fn();
  }),
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
  loadRegistry: mockLoadRegistry,
}));

vi.mock('../../src/core/detection/detectRemote', () => ({
  detectRemote: vi.fn(() => ({
    isRemote: false,
    remoteType: 'local',
    hostInfo: 'Local machine',
    isLocalhost: true,
    warningMessages: [],
  })),
}));

vi.mock('../../src/ui/output', () => ({
  getOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn() })),
}));

vi.mock('../../src/ui/statusBar', () => ({
  updateStatusBar: vi.fn(),
}));

vi.mock('../../src/ui/notifications', () => ({
  showSuccess: mockShowSuccess,
  showWarning: mockShowWarning,
  showError: mockShowError,
}));

vi.mock('../../src/commands/assignProfileAssistants', () => ({
  assignProfileAssistants: vi.fn(),
}));

vi.mock('../../src/commands/activateProfile', () => ({
  activateProfileAndReapplyMappings: vi.fn(),
  buildAutomatedReapplyPlan: (plan: { steps: Array<{ action: string }> }) => ({
    ...plan,
    steps: plan.steps.filter((step) => step.action === 'set-vscode-setting' || step.action === 'edit-config-file'),
  }),
  getProfileActivationNotice: vi.fn(),
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { manageProfiles } from '../../src/commands/manageProfiles';

describe('manageProfiles automatic reapply edge cases', () => {
  const profile: EndpointProfile = {
    id: 'profile-1',
    name: 'OpenAI Prod',
    baseUrl: 'https://api.example.com/v1',
    dialect: 'openai.chat_completions',
    profileType: 'custom',
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockShowQuickPick.mockReset();
    mockShowInputBox.mockReset();
    mockShowSuccess.mockReset();
    mockShowWarning.mockReset();
    mockShowError.mockReset();
    mockGetProfiles.mockReset();
    mockGetAssistantMappings.mockReset();
    mockSaveProfile.mockReset();
    mockBuildPlan.mockReset();
    mockApplyPlan.mockReset();
    mockLoadRegistry.mockReset();
    mockWithProgress.mockImplementation(async (_options, task) => task({ report: vi.fn() }));
    mockGetProfiles.mockResolvedValue([profile]);
    mockSaveProfile.mockResolvedValue(undefined);
    mockLoadRegistry.mockResolvedValue({ assistants: [], dialectCatalog: {} });
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(pencil) Edit Profile' })
      .mockResolvedValueOnce({ label: '$(globe) Base URL' })
      .mockResolvedValueOnce({ label: 'No', value: false })
      .mockResolvedValueOnce({ label: 'Yes', value: true })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mockShowInputBox.mockResolvedValue('https://api.updated.example.com/v1');
  });

  it('shows a warning when edited mappings are all manual-only', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'anythingllm',
        profileId: profile.id,
        appliedMode: 'guided',
        appliedAt: '2026-05-18T00:00:00.000Z',
      },
    ]);
    mockBuildPlan.mockResolvedValue({
      id: 'plan-guided',
      profileId: profile.id,
      assistantKeys: ['anythingllm'],
      createdAt: '2026-05-18T00:00:00.000Z',
      status: 'pending',
      steps: [
        {
          id: 'step-1',
          action: 'show-guided-steps',
          description: 'Manual AnythingLLM config',
          assistantKey: 'anythingllm',
          data: {},
          reversible: false,
        },
      ],
    });

    await manageProfiles({} as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockApplyPlan).not.toHaveBeenCalled();
    expect(mockShowWarning).toHaveBeenCalledWith(
      'Profile "OpenAI Prod" updated successfully. No mapped assistants for "OpenAI Prod" support automatic reapply. Manual-only assistants not updated automatically: anythingllm.'
    );
  });
});