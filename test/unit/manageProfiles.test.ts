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
  mockSaveAssistantMapping,
  mockDeleteAssistantMapping,
  mockDeleteProfile,
  mockGetActiveProfileId,
  mockSetActiveProfile,
  mockBuildPlan,
  mockApplyPlan,
  mockLoadRegistry,
  mockUpdateStatusBar,
  mockActivateProfileAndReapplyMappings,
  mockGetProfileActivationNotice,
  mockAssignProfileAssistants,
  mockGetSecret,
  mockDeleteSecret,
  mockStoreSecret,
  mockLoggerInfo,
  mockLoggerWarning,
  mockLoggerError
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
  mockSaveAssistantMapping: vi.fn(),
  mockDeleteAssistantMapping: vi.fn(),
  mockDeleteProfile: vi.fn(),
  mockGetActiveProfileId: vi.fn(),
  mockSetActiveProfile: vi.fn(),
  mockBuildPlan: vi.fn(),
  mockApplyPlan: vi.fn(),
  mockLoadRegistry: vi.fn(),
  mockUpdateStatusBar: vi.fn(),
  mockActivateProfileAndReapplyMappings: vi.fn(),
  mockGetProfileActivationNotice: vi.fn(),
  mockAssignProfileAssistants: vi.fn(),
  mockGetSecret: vi.fn(),
  mockDeleteSecret: vi.fn(),
  mockStoreSecret: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarning: vi.fn(),
  mockLoggerError: vi.fn()
}));

vi.mock('vscode', () => ({
  window: {
    showQuickPick: mockShowQuickPick,
    showInputBox: mockShowInputBox,
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    withProgress: mockWithProgress
  },
  ProgressLocation: { Notification: 15 },
  QuickPickItemKind: { Default: 0, Separator: -1 }
}));

vi.mock('../../src/core/profiles/profileStore', () => ({
  ProfileStore: vi.fn().mockImplementation(class {
    getProfiles = mockGetProfiles;
    getAssistantMappings = mockGetAssistantMappings;
    saveProfile = mockSaveProfile;
    getActiveProfileId = mockGetActiveProfileId;
    setActiveProfile = mockSetActiveProfile;
    deleteProfile = mockDeleteProfile;
    saveAssistantMapping = mockSaveAssistantMapping;
    deleteAssistantMapping = mockDeleteAssistantMapping;
  })
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn().mockImplementation(class {
    getSecret = mockGetSecret;
    deleteSecret = mockDeleteSecret;
    storeSecret = mockStoreSecret;
  })
}));

vi.mock('../../src/core/orchestration/switchboard', () => ({
  Switchboard: vi.fn().mockImplementation(class {
    buildPlan = mockBuildPlan;
    applyPlan = mockApplyPlan;
  })
}));

vi.mock('../../src/core/orchestration/verifier', () => ({
  Verifier: vi.fn().mockImplementation(class {
    runVerificationPipeline = vi.fn();
  })
}));

vi.mock('../../src/core/registry/registryLoader', () => ({
  loadRegistry: mockLoadRegistry
}));

vi.mock('../../src/core/detection/detectRemote', () => ({
  detectRemote: vi.fn(() => ({
    isRemote: false,
    remoteType: 'local',
    hostInfo: 'Local machine',
    isLocalhost: true,
    warningMessages: []
  }))
}));

vi.mock('../../src/ui/output', () => ({
  getOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    show: vi.fn()
  }))
}));

vi.mock('../../src/ui/statusBar', () => ({
  updateStatusBar: mockUpdateStatusBar
}));

vi.mock('../../src/ui/notifications', () => ({
  showSuccess: mockShowSuccess,
  showWarning: mockShowWarning,
  showError: mockShowError
}));

vi.mock('../../src/commands/assignProfileAssistants', () => ({
  assignProfileAssistants: mockAssignProfileAssistants
}));

vi.mock('../../src/commands/activateProfile', () => ({
  activateProfileAndReapplyMappings: mockActivateProfileAndReapplyMappings,
  buildAutomatedReapplyPlan: (plan: { steps: Array<{ action: string }> }) => ({
    ...plan,
    steps: plan.steps.filter((step) => step.action === 'set-vscode-setting' || step.action === 'edit-config-file')
  }),
  getProfileActivationNotice: mockGetProfileActivationNotice
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      info: mockLoggerInfo,
      warning: mockLoggerWarning,
      error: mockLoggerError
    })
  }
}));

import { manageProfiles } from '../../src/commands/manageProfiles';

describe('manageProfiles edit reapply flow', () => {
  const profile: EndpointProfile = {
    id: 'profile-1',
    name: 'OpenAI Prod',
    baseUrl: 'https://api.example.com/v1',
    dialect: 'openai.chat_completions',
    profileType: 'custom',
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z'
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
    mockSaveAssistantMapping.mockReset();
    mockDeleteAssistantMapping.mockReset();
    mockDeleteProfile.mockReset();
    mockGetActiveProfileId.mockReset();
    mockSetActiveProfile.mockReset();
    mockBuildPlan.mockReset();
    mockApplyPlan.mockReset();
    mockLoadRegistry.mockReset();
    mockActivateProfileAndReapplyMappings.mockReset();
    mockGetProfileActivationNotice.mockReset();
    mockAssignProfileAssistants.mockReset();
    mockWithProgress.mockImplementation(async (_options, task) => task({ report: vi.fn() }));
    mockGetProfiles.mockResolvedValue([profile]);
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: profile.id,
        appliedMode: 'configFile',
        appliedAt: '2026-05-18T00:00:00.000Z'
      },
      {
        assistantKey: 'anythingllm',
        profileId: profile.id,
        appliedMode: 'guided',
        appliedAt: '2026-05-18T00:00:00.000Z'
      }
    ]);
    mockSaveProfile.mockResolvedValue(undefined);
    mockSaveAssistantMapping.mockResolvedValue(undefined);
    mockDeleteAssistantMapping.mockResolvedValue(undefined);
    mockDeleteProfile.mockResolvedValue(undefined);
    mockGetActiveProfileId.mockResolvedValue(undefined);
    mockSetActiveProfile.mockResolvedValue(undefined);
    mockLoadRegistry.mockResolvedValue({ assistants: [], dialectCatalog: {} });
    mockActivateProfileAndReapplyMappings.mockResolvedValue({ status: 'success' });
    mockGetProfileActivationNotice.mockReturnValue({
      kind: 'success',
      message: 'Profile activated successfully'
    });
    mockBuildPlan
      .mockResolvedValueOnce({
        id: 'plan-1',
        profileId: profile.id,
        assistantKeys: ['cline'],
        createdAt: '2026-05-18T00:00:00.000Z',
        status: 'pending',
        steps: [
          {
            id: 'step-1',
            action: 'edit-config-file',
            description: 'Rewrite Cline config',
            assistantKey: 'cline',
            data: {},
            reversible: true
          }
        ]
      })
      .mockResolvedValueOnce({
        id: 'plan-2',
        profileId: profile.id,
        assistantKeys: ['anythingllm'],
        createdAt: '2026-05-18T00:00:00.000Z',
        status: 'pending',
        steps: [
          {
            id: 'step-2',
            action: 'show-guided-steps',
            description: 'Manual AnythingLLM config',
            assistantKey: 'anythingllm',
            data: {},
            reversible: false
          }
        ]
      });
    mockApplyPlan.mockResolvedValue({
      success: true,
      appliedSteps: [
        {
          id: 'step-1',
          action: 'edit-config-file',
          description: 'Rewrite Cline config',
          assistantKey: 'cline',
          data: {},
          reversible: true
        }
      ],
      failedSteps: [],
      assistantResults: new Map([['cline', { success: true }]])
    });
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

  it('reapplies only automatic steps after editing a mapped profile', async () => {
    await manageProfiles({} as any);

    expect(mockSaveProfile).toHaveBeenCalledWith(expect.objectContaining({
      id: profile.id,
      baseUrl: 'https://api.updated.example.com/v1'
    }));
    expect(mockBuildPlan).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: profile.id,
        baseUrl: 'https://api.updated.example.com/v1'
      }),
      ['cline']
    );
    expect(mockBuildPlan).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: profile.id,
        baseUrl: 'https://api.updated.example.com/v1'
      }),
      ['anythingllm']
    );

    const appliedPlan = mockApplyPlan.mock.calls[0][0];
    expect(appliedPlan.assistantKeys).toEqual(['cline']);
    expect(appliedPlan.steps).toEqual([
      expect.objectContaining({ action: 'edit-config-file', assistantKey: 'cline' })
    ]);
    expect(mockShowWarning).toHaveBeenCalledWith(
      expect.stringContaining('Reapplied 1 assistant(s) using "OpenAI Prod"')
    );
    expect(mockShowWarning).toHaveBeenCalledWith(
      expect.stringContaining('Manual-only assistants not updated automatically: anythingllm')
    );
  });

  it('routes the Assign Assistants action through the profile-scoped command', async () => {
    mockShowQuickPick.mockReset();
    mockGetAssistantMappings.mockResolvedValue([]);
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(plug) Assign Assistants (0)' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const context = {} as any;
    await manageProfiles(context);

    expect(mockAssignProfileAssistants).toHaveBeenCalledWith(context, profile.id);
  });

  it('activates the selected profile from the Set Active Profile flow and shows the activation notice', async () => {
    mockShowQuickPick.mockReset();
    const secondProfile: EndpointProfile = {
      ...profile,
      id: 'profile-2',
      name: 'OpenAI Stage',
      baseUrl: 'https://stage.example.com/v1'
    };
    mockGetProfiles.mockResolvedValue([profile, secondProfile]);
    mockGetAssistantMappings.mockResolvedValue([]);
    mockGetProfileActivationNotice.mockReturnValue({
      kind: 'warning',
      message: 'Manual switching is still required for one assistant'
    });
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(star) Set Active Profile' })
      .mockResolvedValueOnce({ label: secondProfile.name, profile: secondProfile })
      .mockResolvedValueOnce(undefined);

    const context = {} as any;
    await manageProfiles(context);

    expect(mockActivateProfileAndReapplyMappings).toHaveBeenCalledWith(context, secondProfile.id);
    expect(mockShowWarning).toHaveBeenCalledWith('Manual switching is still required for one assistant');
  });
});

describe('manageProfiles delete reassign flow', () => {
  const sourceProfile: EndpointProfile = {
    id: 'profile-source',
    name: 'OpenAI Prod',
    baseUrl: 'https://api.example.com/v1',
    dialect: 'openai.chat_completions',
    profileType: 'custom',
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z'
  };
  const targetProfile: EndpointProfile = {
    id: 'profile-target',
    name: 'OpenAI Stage',
    baseUrl: 'https://stage.example.com/v1',
    dialect: 'openai.chat_completions',
    profileType: 'custom',
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockShowQuickPick.mockReset();
    mockShowSuccess.mockReset();
    mockShowWarning.mockReset();
    mockShowError.mockReset();
    mockGetProfiles.mockReset();
    mockGetAssistantMappings.mockReset();
    mockSaveAssistantMapping.mockReset();
    mockDeleteAssistantMapping.mockReset();
    mockDeleteProfile.mockReset();
    mockGetActiveProfileId.mockReset();
    mockSetActiveProfile.mockReset();
    mockBuildPlan.mockReset();
    mockApplyPlan.mockReset();
    mockLoadRegistry.mockReset();
    mockWithProgress.mockImplementation(async (_options, task) => task({ report: vi.fn() }));
    mockSaveAssistantMapping.mockResolvedValue(undefined);
    mockDeleteAssistantMapping.mockResolvedValue(undefined);
    mockDeleteProfile.mockResolvedValue(undefined);
    mockSetActiveProfile.mockResolvedValue(undefined);
    mockLoadRegistry.mockResolvedValue({ assistants: [], dialectCatalog: {} });
  });

  it('reassigns assistants to the target profile before deleting the source profile', async () => {
    mockGetProfiles.mockResolvedValue([sourceProfile, targetProfile]);
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: sourceProfile.id,
        appliedMode: 'configFile',
        appliedAt: '2026-05-18T00:00:00.000Z'
      },
      {
        assistantKey: 'anythingllm',
        profileId: sourceProfile.id,
        appliedMode: 'guided',
        appliedAt: '2026-05-18T00:00:00.000Z'
      }
    ]);
    mockGetActiveProfileId.mockResolvedValue(sourceProfile.id);
    mockBuildPlan
      .mockResolvedValueOnce({
        id: 'plan-target-cline',
        profileId: targetProfile.id,
        assistantKeys: ['cline'],
        createdAt: '2026-05-18T00:00:00.000Z',
        status: 'pending',
        steps: [
          {
            id: 'step-1',
            action: 'edit-config-file',
            description: 'Rewrite Cline config',
            assistantKey: 'cline',
            data: {},
            reversible: true
          }
        ]
      })
      .mockResolvedValueOnce({
        id: 'plan-target-anythingllm',
        profileId: targetProfile.id,
        assistantKeys: ['anythingllm'],
        createdAt: '2026-05-18T00:00:00.000Z',
        status: 'pending',
        steps: [
          {
            id: 'step-2',
            action: 'show-guided-steps',
            description: 'Manual AnythingLLM config',
            assistantKey: 'anythingllm',
            data: {},
            reversible: false
          }
        ]
      });
    mockApplyPlan.mockResolvedValue({
      success: true,
      appliedSteps: [
        {
          id: 'step-1',
          action: 'edit-config-file',
          description: 'Rewrite Cline config',
          assistantKey: 'cline',
          data: {},
          reversible: true
        }
      ],
      failedSteps: [],
      assistantResults: new Map([['cline', { success: true }]])
    });
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile: sourceProfile })
      .mockResolvedValueOnce({ label: '$(trash) Delete Profile' })
      .mockResolvedValueOnce({ label: '$(arrow-right) Reassign to another profile' })
      .mockResolvedValueOnce({ label: targetProfile.name, profile: targetProfile })
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockBuildPlan).toHaveBeenNthCalledWith(1, targetProfile, ['cline']);
    expect(mockBuildPlan).toHaveBeenNthCalledWith(2, targetProfile, ['anythingllm']);
    expect(mockDeleteProfile).toHaveBeenCalledWith(sourceProfile.id);
    expect(mockDeleteProfile.mock.invocationCallOrder[0]).toBeGreaterThan(mockApplyPlan.mock.invocationCallOrder[0]);
    expect(mockSaveAssistantMapping).toHaveBeenCalledWith(expect.objectContaining({
      assistantKey: 'anythingllm',
      profileId: targetProfile.id
    }));
    expect(mockSetActiveProfile).toHaveBeenCalledWith(targetProfile.id);
    expect(mockUpdateStatusBar).toHaveBeenCalledWith(targetProfile.name);
    expect(mockShowWarning).toHaveBeenCalledWith(
      expect.stringContaining('Manual-only assistants still need manual switching: anythingllm')
    );
  });

  it('keeps the source profile when a later reassignment apply fails and restores earlier assistants', async () => {
    mockGetProfiles.mockResolvedValue([sourceProfile, targetProfile]);
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: sourceProfile.id,
        appliedMode: 'configFile',
        appliedAt: '2026-05-18T00:00:00.000Z'
      },
      {
        assistantKey: 'continue',
        profileId: sourceProfile.id,
        appliedMode: 'settings',
        appliedAt: '2026-05-18T00:00:00.000Z'
      }
    ]);
    mockGetActiveProfileId.mockResolvedValue(sourceProfile.id);
    mockBuildPlan
      .mockResolvedValueOnce({
        id: 'plan-target-cline',
        profileId: targetProfile.id,
        assistantKeys: ['cline'],
        createdAt: '2026-05-18T00:00:00.000Z',
        status: 'pending',
        steps: [
          {
            id: 'step-1',
            action: 'edit-config-file',
            description: 'Rewrite Cline config',
            assistantKey: 'cline',
            data: {},
            reversible: true
          }
        ]
      })
      .mockResolvedValueOnce({
        id: 'plan-target-continue',
        profileId: targetProfile.id,
        assistantKeys: ['continue'],
        createdAt: '2026-05-18T00:00:00.000Z',
        status: 'pending',
        steps: [
          {
            id: 'step-2',
            action: 'set-vscode-setting',
            description: 'Set Continue base URL',
            assistantKey: 'continue',
            data: {},
            reversible: true
          }
        ]
      })
      .mockResolvedValueOnce({
        id: 'plan-restore-cline',
        profileId: sourceProfile.id,
        assistantKeys: ['cline'],
        createdAt: '2026-05-18T00:00:00.000Z',
        status: 'pending',
        steps: [
          {
            id: 'step-3',
            action: 'edit-config-file',
            description: 'Restore Cline config',
            assistantKey: 'cline',
            data: {},
            reversible: true
          }
        ]
      });
    mockApplyPlan
      .mockResolvedValueOnce({
        success: true,
        appliedSteps: [
          {
            id: 'step-1',
            action: 'edit-config-file',
            description: 'Rewrite Cline config',
            assistantKey: 'cline',
            data: {},
            reversible: true
          }
        ],
        failedSteps: [],
        assistantResults: new Map([['cline', { success: true }]])
      })
      .mockResolvedValueOnce({
        success: false,
        appliedSteps: [],
        failedSteps: [
          {
            id: 'step-2',
            action: 'set-vscode-setting',
            description: 'Set Continue base URL',
            assistantKey: 'continue',
            data: {},
            reversible: true,
            error: 'settings update failed'
          }
        ],
        assistantResults: new Map([['continue', { success: false }]])
      })
      .mockResolvedValueOnce({
        success: true,
        appliedSteps: [
          {
            id: 'step-3',
            action: 'edit-config-file',
            description: 'Restore Cline config',
            assistantKey: 'cline',
            data: {},
            reversible: true
          }
        ],
        failedSteps: [],
        assistantResults: new Map([['cline', { success: true }]])
      });
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile: sourceProfile })
      .mockResolvedValueOnce({ label: '$(trash) Delete Profile' })
      .mockResolvedValueOnce({ label: '$(arrow-right) Reassign to another profile' })
      .mockResolvedValueOnce({ label: targetProfile.name, profile: targetProfile })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockBuildPlan).toHaveBeenNthCalledWith(1, targetProfile, ['cline']);
    expect(mockBuildPlan).toHaveBeenNthCalledWith(2, targetProfile, ['continue']);
    expect(mockBuildPlan).toHaveBeenNthCalledWith(3, sourceProfile, ['cline']);
    expect(mockDeleteAssistantMapping).toHaveBeenCalledWith('continue', targetProfile.id);
    expect(mockDeleteAssistantMapping).toHaveBeenCalledWith('cline', targetProfile.id);
    expect(mockDeleteProfile).not.toHaveBeenCalled();
    expect(mockSetActiveProfile).not.toHaveBeenCalled();
    expect(mockShowError).toHaveBeenCalledWith(
      expect.stringContaining('The original profile was kept and previously switched assistants were restored')
    );
  });

  it('keeps the source profile when reassignment fails before any assistant is switched', async () => {
    mockGetProfiles.mockResolvedValue([sourceProfile, targetProfile]);
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: sourceProfile.id,
        appliedMode: 'configFile',
        appliedAt: '2026-05-18T00:00:00.000Z'
      }
    ]);
    mockGetActiveProfileId.mockResolvedValue(sourceProfile.id);
    mockBuildPlan.mockResolvedValueOnce({
      id: 'plan-target-cline',
      profileId: targetProfile.id,
      assistantKeys: ['cline'],
      createdAt: '2026-05-18T00:00:00.000Z',
      status: 'pending',
      steps: [
        {
          id: 'step-1',
          action: 'edit-config-file',
          description: 'Rewrite Cline config',
          assistantKey: 'cline',
          data: {},
          reversible: true
        }
      ]
    });
    mockApplyPlan.mockResolvedValueOnce({
      success: false,
      appliedSteps: [],
      failedSteps: [
        {
          id: 'step-1',
          action: 'edit-config-file',
          description: 'Rewrite Cline config',
          assistantKey: 'cline',
          data: {},
          reversible: true,
          error: 'write failed'
        }
      ],
      assistantResults: new Map([['cline', { success: false }]])
    });
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile: sourceProfile })
      .mockResolvedValueOnce({ label: '$(trash) Delete Profile' })
      .mockResolvedValueOnce({ label: '$(arrow-right) Reassign to another profile' })
      .mockResolvedValueOnce({ label: targetProfile.name, profile: targetProfile })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockDeleteProfile).not.toHaveBeenCalled();
    expect(mockSetActiveProfile).not.toHaveBeenCalledWith(targetProfile.id);
    expect(mockShowError).toHaveBeenCalledWith(
      'Failed to reassign assistants to "OpenAI Stage". The original profile was kept. Failed assistants: cline.'
    );
  });
});