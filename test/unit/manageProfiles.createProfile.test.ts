import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockShowQuickPick,
  mockShowInputBox,
  mockShowInformationMessage,
  mockWithProgress,
  mockShowSuccess,
  mockShowWarning,
  mockShowError,
  mockGetProfiles,
  mockGetAssistantMappings,
  mockSaveProfile,
  mockStoreSecret,
  mockRunVerificationPipeline,
} = vi.hoisted(() => ({
  mockShowQuickPick: vi.fn(),
  mockShowInputBox: vi.fn(),
  mockShowInformationMessage: vi.fn(),
  mockWithProgress: vi.fn(),
  mockShowSuccess: vi.fn(),
  mockShowWarning: vi.fn(),
  mockShowError: vi.fn(),
  mockGetProfiles: vi.fn(),
  mockGetAssistantMappings: vi.fn(),
  mockSaveProfile: vi.fn(),
  mockStoreSecret: vi.fn(),
  mockRunVerificationPipeline: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    showQuickPick: mockShowQuickPick,
    showInputBox: mockShowInputBox,
    showInformationMessage: mockShowInformationMessage,
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
    storeSecret = mockStoreSecret;
  }),
}));

vi.mock('../../src/core/orchestration/switchboard', () => ({
  Switchboard: vi.fn().mockImplementation(class {
    buildPlan = vi.fn();
    applyPlan = vi.fn();
  }),
}));

vi.mock('../../src/core/orchestration/verifier', () => ({
  Verifier: vi.fn().mockImplementation(class {
    runVerificationPipeline = mockRunVerificationPipeline;
  }),
}));

vi.mock('../../src/core/registry/registryLoader', () => ({
  loadRegistry: vi.fn(),
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
  getOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    show: vi.fn(),
  })),
}));

vi.mock('../../src/ui/statusBar', () => ({
  updateStatusBar: vi.fn(),
}));

vi.mock('../../src/ui/notifications', () => ({
  showInfo: mockShowInformationMessage,
  showBlockingSuccess: mockShowSuccess,
  showBlockingWarning: mockShowWarning,
  showBlockingError: mockShowError,
  withProgress: mockWithProgress,
  showSuccess: mockShowSuccess,
  showWarning: mockShowWarning,
  showError: mockShowError,
}));

vi.mock('../../src/commands/assignProfileAssistants', () => ({
  assignProfileAssistants: vi.fn(),
}));

vi.mock('../../src/commands/activateProfile', () => ({
  activateProfileAndReapplyMappings: vi.fn(),
  buildAutomatedReapplyPlan: vi.fn((plan) => plan),
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

function buildVerificationReport(overallStatus: 'passed' | 'partial' | 'failed') {
  return {
    profileName: 'New Profile',
    baseUrl: 'https://api.new.example.com/v1',
    dialect: 'openai.chat_completions',
    timestamp: '2026-05-21T00:00:00.000Z',
    overallStatus,
    steps: [],
    actionableErrors: [],
    suggestions: [],
  };
}

describe('manageProfiles create profile verification outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockShowQuickPick.mockReset();
    mockShowInputBox.mockReset();
    mockShowInformationMessage.mockReset();
    mockWithProgress.mockReset();
    mockShowSuccess.mockReset();
    mockShowWarning.mockReset();
    mockShowError.mockReset();
    mockGetProfiles.mockReset();
    mockGetAssistantMappings.mockReset();
    mockSaveProfile.mockReset();
    mockStoreSecret.mockReset();
    mockRunVerificationPipeline.mockReset();

    mockWithProgress.mockImplementation(async (_options, task) => task({ report: vi.fn() }));
    mockGetProfiles.mockResolvedValue([]);
    mockGetAssistantMappings.mockResolvedValue([]);
    mockSaveProfile.mockResolvedValue(undefined);
    mockStoreSecret.mockResolvedValue(undefined);

    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(add) Create New Profile' })
      .mockResolvedValueOnce({ label: 'Custom Endpoint', value: 'custom' })
      .mockResolvedValueOnce({ label: 'openai.chat_completions', dialect: 'openai.chat_completions' })
      .mockResolvedValueOnce({ label: 'Yes', value: true })
      .mockResolvedValueOnce(undefined);
    mockShowInputBox
      .mockResolvedValueOnce('New Profile')
      .mockResolvedValueOnce('https://api.new.example.com/v1')
      .mockResolvedValueOnce('team-a')
      .mockResolvedValueOnce('secret-token');
  });

  it('shows success after creating and verifying a profile', async () => {
    mockRunVerificationPipeline.mockResolvedValue(buildVerificationReport('passed'));

    await manageProfiles({} as any);

    expect(mockStoreSecret).toHaveBeenCalledWith('New Profile', 'secret-token');
    expect(mockShowSuccess).toHaveBeenCalledWith('Profile "New Profile" created and verified successfully!');
    expect(mockSaveProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New Profile',
      profileType: 'custom',
      tenant: 'team-a',
    }));
    expect(mockSaveProfile).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'New Profile',
      lastVerified: '2026-05-21T00:00:00.000Z',
    }));
  });

  it('uses sequential create-profile titles in manage profiles', async () => {
    mockRunVerificationPipeline.mockResolvedValue(buildVerificationReport('passed'));

    await manageProfiles({} as any);

    expect(mockShowInputBox.mock.calls.map(([options]) => options.title)).toEqual([
      'Create Profile (1/7): Profile Name',
      'Create Profile (3/7): Base URL',
      'Create Profile (5/7): Tenant',
      'Create Profile (7/7): Authentication Token',
    ]);
    expect(
      mockShowQuickPick.mock.calls
        .map(([, options]) => options?.title)
        .filter(Boolean)
    ).toEqual(expect.arrayContaining([
      'Create Profile (2/7): Profile Type',
      'Create Profile (4/7): Dialect',
      'Create Profile (6/7): Authentication',
    ]));
  });

  it('creates an AIdome profile with an optional tenant before verification', async () => {
    mockShowQuickPick.mockReset();
    mockShowInputBox.mockReset();
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(add) Create New Profile' })
      .mockResolvedValueOnce({ label: 'AIdome Gateway', value: 'aidome' })
      .mockResolvedValueOnce({ label: 'openai.chat_completions', dialect: 'openai.chat_completions' })
      .mockResolvedValueOnce({ label: 'No', value: false })
      .mockResolvedValueOnce(undefined);
    mockShowInputBox
      .mockResolvedValueOnce('AIdome Profile')
      .mockResolvedValueOnce('https://api.aidome.ai')
      .mockResolvedValueOnce('team-a');
    mockRunVerificationPipeline.mockResolvedValue(buildVerificationReport('passed'));

    await manageProfiles({} as any);

    expect(mockSaveProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'AIdome Profile',
      profileType: 'aidome',
      baseUrl: 'https://api.aidome.ai',
      tenant: 'team-a',
      authRef: undefined,
    }));
    expect(mockStoreSecret).not.toHaveBeenCalled();
  });

  it('uses openai.chat_completions as the auto-detect default without probing the endpoint', async () => {
    mockShowQuickPick.mockReset();
    mockShowInputBox.mockReset();
    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(add) Create New Profile' })
      .mockResolvedValueOnce({ label: 'Custom Endpoint', value: 'custom' })
      .mockResolvedValueOnce({ label: '$(search) Auto-detect', dialect: undefined })
      .mockResolvedValueOnce({ label: 'No', value: false })
      .mockResolvedValueOnce(undefined);
    mockShowInputBox
      .mockResolvedValueOnce('Auto Profile')
      .mockResolvedValueOnce('https://api.auto.example.com/v1')
      .mockResolvedValueOnce('');
    mockRunVerificationPipeline.mockResolvedValue(buildVerificationReport('passed'));

    await manageProfiles({} as any);

    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      'Auto-detect currently defaults to openai.chat_completions. It does not probe the endpoint.'
    );
    expect(mockSaveProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Auto Profile',
      profileType: 'custom',
      baseUrl: 'https://api.auto.example.com/v1',
      dialect: 'openai.chat_completions',
    }));
  });

  it('does not block profile creation on the auto-detect notification', async () => {
    mockShowQuickPick.mockReset();
    mockShowInputBox.mockReset();
    mockShowInformationMessage.mockReset();

    let resolveNotification: (() => void) | undefined;
    const pendingNotification = new Promise<void>((resolve) => {
      resolveNotification = resolve;
    });

    mockShowQuickPick
      .mockResolvedValueOnce({ label: '$(add) Create New Profile' })
      .mockResolvedValueOnce({ label: 'Custom Endpoint', value: 'custom' })
      .mockResolvedValueOnce({ label: '$(search) Auto-detect', dialect: undefined })
      .mockResolvedValueOnce({ label: 'No', value: false })
      .mockResolvedValueOnce(undefined);
    mockShowInputBox
      .mockResolvedValueOnce('Auto Profile')
      .mockResolvedValueOnce('https://api.auto.example.com/v1')
      .mockResolvedValueOnce('');
    mockShowInformationMessage.mockReturnValueOnce(pendingNotification as any);
    mockRunVerificationPipeline.mockResolvedValue(buildVerificationReport('passed'));

    const managePromise = manageProfiles({} as any);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(mockSaveProfile).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Auto Profile',
      dialect: 'openai.chat_completions',
    }));

    resolveNotification?.();
    await managePromise;
  });

  it('shows a warning when verification completes with warnings', async () => {
    mockRunVerificationPipeline.mockResolvedValue(buildVerificationReport('partial'));

    await manageProfiles({} as any);

    expect(mockShowWarning).toHaveBeenCalledWith('Profile "New Profile" created with warnings. Check output for details.');
  });

  it('shows an error when verification fails after profile creation', async () => {
    mockRunVerificationPipeline.mockResolvedValue(buildVerificationReport('failed'));

    await manageProfiles({} as any);

    expect(mockShowError).toHaveBeenCalledWith('Profile "New Profile" created but verification failed. Check output for details.');
  });

  it('shows a warning when verification throws after the profile is created', async () => {
    mockRunVerificationPipeline.mockRejectedValue(new Error('network down'));

    await manageProfiles({} as any);

    expect(mockShowWarning).toHaveBeenCalledWith('Profile created but verification encountered an error: network down');
  });

  it('stringifies non-Error verification failures after profile creation', async () => {
    mockRunVerificationPipeline.mockRejectedValue('network down');

    await manageProfiles({} as any);

    expect(mockShowWarning).toHaveBeenCalledWith('Profile created but verification encountered an error: network down');
  });
});