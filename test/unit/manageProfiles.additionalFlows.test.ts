import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointProfile } from '../../src/core/profiles/profileTypes';

const {
  mockShowQuickPick,
  mockShowInputBox,
  mockShowInformationMessage,
  mockWithProgress,
  mockShowSuccess,
  mockShowWarning,
  mockShowError,
  mockShowInfo,
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
  mockGetSecret,
  mockDeleteSecret,
  mockStoreSecret,
} = vi.hoisted(() => ({
  mockShowQuickPick: vi.fn(),
  mockShowInputBox: vi.fn(),
  mockShowInformationMessage: vi.fn(),
  mockWithProgress: vi.fn(),
  mockShowSuccess: vi.fn(),
  mockShowWarning: vi.fn(),
  mockShowError: vi.fn(),
  mockShowInfo: vi.fn(),
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
  mockGetSecret: vi.fn(),
  mockDeleteSecret: vi.fn(),
  mockStoreSecret: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    showQuickPick: mockShowQuickPick,
    showInputBox: mockShowInputBox,
    showInformationMessage: mockShowInformationMessage,
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
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
    getActiveProfileId = mockGetActiveProfileId;
    setActiveProfile = mockSetActiveProfile;
    deleteProfile = mockDeleteProfile;
    saveAssistantMapping = mockSaveAssistantMapping;
    deleteAssistantMapping = mockDeleteAssistantMapping;
  }),
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn().mockImplementation(class {
    getSecret = mockGetSecret;
    deleteSecret = mockDeleteSecret;
    storeSecret = mockStoreSecret;
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
  updateStatusBar: mockUpdateStatusBar,
}));

vi.mock('../../src/ui/notifications', () => ({
  showInfo: mockShowInfo,
  showSuccess: mockShowSuccess,
  showWarning: mockShowWarning,
  showError: mockShowError,
}));

vi.mock('../../src/commands/assignProfileAssistants', () => ({
  assignProfileAssistants: vi.fn(),
}));

vi.mock('../../src/commands/activateProfile', () => ({
  activateProfileAndReapplyMappings: mockActivateProfileAndReapplyMappings,
  buildAutomatedReapplyPlan: (plan: { steps: Array<{ action: string }> }) => ({
    ...plan,
    steps: plan.steps.filter((step) => step.action === 'set-vscode-setting' || step.action === 'edit-config-file'),
  }),
  getProfileActivationNotice: mockGetProfileActivationNotice,
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

const profile: EndpointProfile = {
  id: 'profile-1',
  name: 'OpenAI Prod',
  baseUrl: 'https://api.example.com/v1',
  dialect: 'openai.chat_completions',
  profileType: 'custom',
  authRef: 'OpenAI Prod',
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
};

const targetProfile: EndpointProfile = {
  id: 'profile-2',
  name: 'OpenAI Stage',
  baseUrl: 'https://stage.example.com/v1',
  dialect: 'openai.chat_completions',
  profileType: 'custom',
  createdAt: '2026-05-18T00:00:00.000Z',
  updatedAt: '2026-05-18T00:00:00.000Z',
};

function automaticPlan(profileId: string, assistantKey: string, stepId: string) {
  return {
    id: `plan-${profileId}-${assistantKey}`,
    profileId,
    assistantKeys: [assistantKey],
    createdAt: '2026-05-18T00:00:00.000Z',
    status: 'pending',
    steps: [
      {
        id: stepId,
        action: 'edit-config-file',
        description: `Rewrite ${assistantKey} config`,
        assistantKey,
        data: {},
        reversible: true,
      },
    ],
  };
}

function applyResult(assistantKey: string, success: boolean) {
  return {
    success,
    appliedSteps: success ? [automaticPlan(profile.id, assistantKey, `step-${assistantKey}`).steps[0]] : [],
    failedSteps: success
      ? []
      : [
          {
            ...automaticPlan(profile.id, assistantKey, `step-${assistantKey}`).steps[0],
            error: `${assistantKey} failed`,
          },
        ],
    assistantResults: new Map([[assistantKey, { success }]]),
  };
}

describe('manageProfiles additional flows', () => {
  beforeEach(() => {
    Object.assign(profile, {
      id: 'profile-1',
      name: 'OpenAI Prod',
      baseUrl: 'https://api.example.com/v1',
      dialect: 'openai.chat_completions',
      profileType: 'custom',
      authRef: 'OpenAI Prod',
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
    });
    Object.assign(targetProfile, {
      id: 'profile-2',
      name: 'OpenAI Stage',
      baseUrl: 'https://stage.example.com/v1',
      dialect: 'openai.chat_completions',
      profileType: 'custom',
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
    });

    vi.clearAllMocks();
    mockShowQuickPick.mockReset();
    mockShowInputBox.mockReset();
    mockShowInformationMessage.mockReset();
    mockWithProgress.mockReset();
    mockShowSuccess.mockReset();
    mockShowWarning.mockReset();
    mockShowError.mockReset();
    mockShowInfo.mockReset();
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
    mockUpdateStatusBar.mockReset();
    mockActivateProfileAndReapplyMappings.mockReset();
    mockGetProfileActivationNotice.mockReset();
    mockGetSecret.mockReset();
    mockDeleteSecret.mockReset();
    mockStoreSecret.mockReset();

    mockWithProgress.mockImplementation(async (_options, task) => task({ report: vi.fn() }));
    mockGetProfiles.mockResolvedValue([profile]);
    mockGetAssistantMappings.mockResolvedValue([]);
    mockSaveProfile.mockResolvedValue(undefined);
    mockSaveAssistantMapping.mockResolvedValue(undefined);
    mockDeleteAssistantMapping.mockResolvedValue(undefined);
    mockDeleteProfile.mockResolvedValue(undefined);
    mockGetActiveProfileId.mockResolvedValue(undefined);
    mockSetActiveProfile.mockResolvedValue(undefined);
    mockLoadRegistry.mockResolvedValue({ assistants: [], dialectCatalog: {} });
    mockActivateProfileAndReapplyMappings.mockResolvedValue({ status: 'error' });
    mockGetProfileActivationNotice.mockReturnValue({ kind: 'error', message: 'Activation failed' });
    mockGetSecret.mockResolvedValue('secret-token');
    mockDeleteSecret.mockResolvedValue(undefined);
    mockStoreSecret.mockResolvedValue(undefined);
  });

  it('shows success when all edited mapped assistants reapply automatically', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      { assistantKey: 'cline', profileId: profile.id, appliedMode: 'configFile', appliedAt: '2026-05-18T00:00:00.000Z' },
    ]);
    mockBuildPlan.mockResolvedValueOnce(automaticPlan(profile.id, 'cline', 'step-1'));
    mockApplyPlan.mockResolvedValueOnce(applyResult('cline', true));
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(pencil) Edit Profile' })
      .mockResolvedValueOnce({ label: '$(globe) Base URL' })
      .mockResolvedValueOnce({ label: 'No', value: false })
      .mockResolvedValueOnce({ label: 'Yes', value: true })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mockShowInputBox.mockResolvedValueOnce('https://api.updated.example.com/v1');

    await manageProfiles({} as any);

    expect(mockShowSuccess).toHaveBeenCalledWith(
      'Profile "OpenAI Prod" updated successfully. Reapplied 1 assistant(s) using "OpenAI Prod".'
    );
  });

  it('shows a warning when edited mapped assistants reapply only partially', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      { assistantKey: 'cline', profileId: profile.id, appliedMode: 'configFile', appliedAt: '2026-05-18T00:00:00.000Z' },
      { assistantKey: 'continue', profileId: profile.id, appliedMode: 'settings', appliedAt: '2026-05-18T00:00:00.000Z' },
    ]);
    mockBuildPlan
      .mockResolvedValueOnce(automaticPlan(profile.id, 'cline', 'step-1'))
      .mockResolvedValueOnce(automaticPlan(profile.id, 'continue', 'step-2'));
    mockApplyPlan
      .mockResolvedValueOnce(applyResult('cline', true))
      .mockResolvedValueOnce(applyResult('continue', false));
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(pencil) Edit Profile' })
      .mockResolvedValueOnce({ label: '$(globe) Base URL' })
      .mockResolvedValueOnce({ label: 'No', value: false })
      .mockResolvedValueOnce({ label: 'Yes', value: true })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mockShowInputBox.mockResolvedValueOnce('https://api.updated.example.com/v1');

    await manageProfiles({} as any);

    expect(mockShowWarning).toHaveBeenCalledWith(
      'Profile "OpenAI Prod" updated successfully. Reapplied 1 assistant(s) using "OpenAI Prod", but 1 failed.'
    );
  });

  it('shows an error when automatic reapply setup throws a non-Error value', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      { assistantKey: 'cline', profileId: profile.id, appliedMode: 'configFile', appliedAt: '2026-05-18T00:00:00.000Z' },
    ]);
    mockLoadRegistry.mockRejectedValueOnce('registry unavailable');
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(pencil) Edit Profile' })
      .mockResolvedValueOnce({ label: '$(globe) Base URL' })
      .mockResolvedValueOnce({ label: 'No', value: false })
      .mockResolvedValueOnce({ label: 'Yes', value: true })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mockShowInputBox.mockResolvedValueOnce('https://api.updated.example.com/v1');

    await manageProfiles({} as any);

    expect(mockShowError).toHaveBeenCalledWith(
      'Profile "OpenAI Prod" updated successfully. Failed to reapply automatic configuration for "OpenAI Prod": registry unavailable'
    );
  });

  it('shows an error when automatic reapply setup throws an Error instance', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      { assistantKey: 'cline', profileId: profile.id, appliedMode: 'configFile', appliedAt: '2026-05-18T00:00:00.000Z' },
    ]);
    mockLoadRegistry.mockRejectedValueOnce(new Error('registry unavailable'));
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(pencil) Edit Profile' })
      .mockResolvedValueOnce({ label: '$(globe) Base URL' })
      .mockResolvedValueOnce({ label: 'No', value: false })
      .mockResolvedValueOnce({ label: 'Yes', value: true })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mockShowInputBox.mockResolvedValueOnce('https://api.updated.example.com/v1');

    await manageProfiles({} as any);

    expect(mockShowError).toHaveBeenCalledWith(
      'Profile "OpenAI Prod" updated successfully. Failed to reapply automatic configuration for "OpenAI Prod": registry unavailable'
    );
  });

  it('migrates the stored auth secret when a profile is renamed', async () => {
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(pencil) Edit Profile' })
      .mockResolvedValueOnce({ label: '$(edit) Name' })
      .mockResolvedValueOnce({ label: 'No', value: false })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mockShowInputBox.mockResolvedValueOnce('OpenAI Renamed');

    await manageProfiles({} as any);

    expect(mockGetSecret).toHaveBeenCalledWith('OpenAI Prod');
    expect(mockDeleteSecret).toHaveBeenCalledWith('OpenAI Prod');
    expect(mockStoreSecret).toHaveBeenCalledWith('OpenAI Renamed', 'secret-token');
    expect(mockSaveProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'OpenAI Renamed',
      authRef: 'OpenAI Renamed',
    }));
  });

  it('deletes an active unmapped profile and promotes the remaining profile', async () => {
    mockGetProfiles
      .mockResolvedValueOnce([profile, targetProfile])
      .mockResolvedValueOnce([targetProfile])
      .mockResolvedValueOnce([targetProfile]);
    mockGetActiveProfileId.mockResolvedValue(profile.id);
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(trash) Delete Profile' })
      .mockResolvedValueOnce({ label: '$(trash) Remove mappings and delete' })
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockDeleteProfile).toHaveBeenCalledWith(profile.id);
    expect(mockSetActiveProfile).toHaveBeenCalledWith(targetProfile.id);
    expect(mockUpdateStatusBar).toHaveBeenCalledWith(targetProfile.name);
    expect(mockShowSuccess).toHaveBeenCalledWith('Profile "OpenAI Prod" deleted successfully');
  });

  it('deletes the last active unmapped profile and clears the status bar', async () => {
    mockGetProfiles
      .mockResolvedValueOnce([profile])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mockGetActiveProfileId.mockResolvedValue(profile.id);
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(trash) Delete Profile' })
      .mockResolvedValueOnce({ label: '$(trash) Remove mappings and delete' })
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockSetActiveProfile).not.toHaveBeenCalled();
    expect(mockUpdateStatusBar).toHaveBeenCalledWith(undefined);
  });

  it('shows success when reassignment completes without manual-only assistants', async () => {
    mockGetProfiles.mockResolvedValue([profile, targetProfile]);
    mockGetAssistantMappings.mockResolvedValue([
      { assistantKey: 'cline', profileId: profile.id, appliedMode: 'configFile', appliedAt: '2026-05-18T00:00:00.000Z' },
    ]);
    mockGetActiveProfileId.mockResolvedValue(profile.id);
    mockBuildPlan.mockResolvedValueOnce(automaticPlan(targetProfile.id, 'cline', 'step-1'));
    mockApplyPlan.mockResolvedValueOnce(applyResult('cline', true));
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(trash) Delete Profile' })
      .mockResolvedValueOnce({ label: '$(arrow-right) Reassign to another profile' })
      .mockResolvedValueOnce({ label: targetProfile.name, profile: targetProfile })
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockDeleteProfile).toHaveBeenCalledWith(profile.id);
    expect(mockSetActiveProfile).toHaveBeenCalledWith(targetProfile.id);
    expect(mockUpdateStatusBar).toHaveBeenCalledWith(targetProfile.name);
    expect(mockShowSuccess).toHaveBeenCalledWith(
      'Profile "OpenAI Prod" deleted. 1 assistant mapping reassigned to "OpenAI Stage".'
    );
  });

  it('keeps the source profile when restoration after reassignment is incomplete', async () => {
    mockGetProfiles.mockResolvedValue([profile, targetProfile]);
    mockGetAssistantMappings.mockResolvedValue([
      { assistantKey: 'cline', profileId: profile.id, appliedMode: 'configFile', appliedAt: '2026-05-18T00:00:00.000Z' },
      { assistantKey: 'continue', profileId: profile.id, appliedMode: 'settings', appliedAt: '2026-05-18T00:00:00.000Z' },
    ]);
    mockGetActiveProfileId.mockResolvedValue(profile.id);
    mockBuildPlan
      .mockResolvedValueOnce(automaticPlan(targetProfile.id, 'cline', 'step-1'))
      .mockResolvedValueOnce(automaticPlan(targetProfile.id, 'continue', 'step-2'))
      .mockResolvedValueOnce(automaticPlan(profile.id, 'cline', 'step-3'));
    mockApplyPlan
      .mockResolvedValueOnce(applyResult('cline', true))
      .mockResolvedValueOnce(applyResult('continue', false))
      .mockResolvedValueOnce(applyResult('cline', false));
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(trash) Delete Profile' })
      .mockResolvedValueOnce({ label: '$(arrow-right) Reassign to another profile' })
      .mockResolvedValueOnce({ label: targetProfile.name, profile: targetProfile })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockDeleteProfile).not.toHaveBeenCalled();
    expect(mockShowError).toHaveBeenCalledWith(
      'Failed to reassign assistants to "OpenAI Stage" and automatic restoration to "OpenAI Prod" was incomplete. Manual recovery may be required. Failed assistants: continue. Restore failures: cline.'
    );
  });

  it('surfaces reassignment setup errors from the catch path', async () => {
    mockGetProfiles.mockResolvedValue([profile, targetProfile]);
    mockGetAssistantMappings.mockResolvedValue([
      { assistantKey: 'cline', profileId: profile.id, appliedMode: 'configFile', appliedAt: '2026-05-18T00:00:00.000Z' },
    ]);
    mockLoadRegistry.mockRejectedValueOnce(new Error('registry unavailable'));
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(trash) Delete Profile' })
      .mockResolvedValueOnce({ label: '$(arrow-right) Reassign to another profile' })
      .mockResolvedValueOnce({ label: targetProfile.name, profile: targetProfile })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockDeleteProfile).not.toHaveBeenCalled();
    expect(mockShowError).toHaveBeenCalledWith('Failed to reassign assistants to "OpenAI Stage": registry unavailable');
  });

  it('stringifies non-Error reassignment setup failures from the catch path', async () => {
    mockGetProfiles.mockResolvedValue([profile, targetProfile]);
    mockGetAssistantMappings.mockResolvedValue([
      { assistantKey: 'cline', profileId: profile.id, appliedMode: 'configFile', appliedAt: '2026-05-18T00:00:00.000Z' },
    ]);
    mockLoadRegistry.mockRejectedValueOnce('registry unavailable');
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(trash) Delete Profile' })
      .mockResolvedValueOnce({ label: '$(arrow-right) Reassign to another profile' })
      .mockResolvedValueOnce({ label: targetProfile.name, profile: targetProfile })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockDeleteProfile).not.toHaveBeenCalled();
    expect(mockShowError).toHaveBeenCalledWith('Failed to reassign assistants to "OpenAI Stage": registry unavailable');
  });

  it('shows a success notice when Set Active Profile returns a success outcome', async () => {
    mockGetProfiles.mockResolvedValue([profile, targetProfile]);
    mockActivateProfileAndReapplyMappings.mockResolvedValue({ status: 'success' });
    mockGetProfileActivationNotice.mockReturnValue({ kind: 'success', message: 'Activation succeeded' });
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(star) Set Active Profile' })
      .mockResolvedValueOnce({ label: targetProfile.name, profile: targetProfile })
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockShowSuccess).toHaveBeenCalledWith('Activation succeeded');
  });

  it('shows an error notice when Set Active Profile returns an error outcome', async () => {
    mockGetProfiles.mockResolvedValue([profile, targetProfile]);
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(star) Set Active Profile' })
      .mockResolvedValueOnce({ label: targetProfile.name, profile: targetProfile })
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockActivateProfileAndReapplyMappings).toHaveBeenCalledWith({} as any, targetProfile.id);
    expect(mockShowError).toHaveBeenCalledWith('Activation failed');
  });

  it('shows an information message when a profile has no mapped assistants', async () => {
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(link) View Mapped Assistants (0)' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockShowInfo).toHaveBeenCalledWith('No assistants are currently mapped to "OpenAI Prod"');
  });

  it('renders mapped assistants with unknown defaults and singular placeholder text', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      { assistantKey: 'cline', profileId: profile.id },
    ]);
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(link) View Mapped Assistants (1)' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockShowQuickPick).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        expect.objectContaining({
          label: 'cline',
          description: 'Applied via unknown',
          detail: 'Applied at: unknown',
        }),
      ]),
      expect.objectContaining({
        placeHolder: '1 assistant mapped to this profile',
      })
    );
  });

  it('renders mapped assistants with a concrete applied timestamp when present', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      { assistantKey: 'cline', profileId: profile.id, appliedMode: 'configFile', appliedAt: '2026-05-18T00:00:00.000Z' },
    ]);
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(list-unordered) OpenAI Prod', profile })
      .mockResolvedValueOnce({ label: '$(link) View Mapped Assistants (1)' })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await manageProfiles({} as any);

    expect(mockShowQuickPick).toHaveBeenNthCalledWith(
      3,
      expect.arrayContaining([
        expect.objectContaining({
          label: 'cline',
          description: 'Applied via configFile',
          detail: expect.stringContaining('Applied at:'),
        }),
      ]),
      expect.objectContaining({
        placeHolder: '1 assistant mapped to this profile',
      })
    );
  });
});