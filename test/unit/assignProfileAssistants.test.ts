import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointProfile } from '../../src/core/profiles/profileTypes';

const {
  mockShowQuickPick,
  mockShowInformationMessage,
  mockWithProgress,
  mockShowSuccess,
  mockShowWarning,
  mockShowError,
  mockGetProfiles,
  mockGetAssistantMappings,
  mockGetActiveProfileId,
  mockDeleteAssistantMapping,
  mockSaveAssistantMapping,
  mockDetectAll,
  mockBuildPlan,
  mockApplyPlan,
  mockLoadRegistry,
  mockLoggerInfo,
  mockLoggerError
} = vi.hoisted(() => ({
  mockShowQuickPick: vi.fn(),
  mockShowInformationMessage: vi.fn(),
  mockWithProgress: vi.fn(),
  mockShowSuccess: vi.fn(),
  mockShowWarning: vi.fn(),
  mockShowError: vi.fn(),
  mockGetProfiles: vi.fn(),
  mockGetAssistantMappings: vi.fn(),
  mockGetActiveProfileId: vi.fn(),
  mockDeleteAssistantMapping: vi.fn(),
  mockSaveAssistantMapping: vi.fn(),
  mockDetectAll: vi.fn(),
  mockBuildPlan: vi.fn(),
  mockApplyPlan: vi.fn(),
  mockLoadRegistry: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn()
}));

vi.mock('vscode', () => ({
  window: {
    showQuickPick: mockShowQuickPick,
    showInformationMessage: mockShowInformationMessage,
    withProgress: vi.fn()
  },
  ProgressLocation: { Notification: 15 }
}));

vi.mock('../../src/ui/notifications', () => ({
  showSuccess: mockShowSuccess,
  showWarning: mockShowWarning,
  showError: mockShowError,
  withProgress: mockWithProgress
}));

vi.mock('../../src/core/profiles/profileStore', () => ({
  ProfileStore: vi.fn().mockImplementation(class {
    getProfiles = mockGetProfiles;
    getAssistantMappings = mockGetAssistantMappings;
    getActiveProfileId = mockGetActiveProfileId;
    deleteAssistantMapping = mockDeleteAssistantMapping;
    saveAssistantMapping = mockSaveAssistantMapping;
  })
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn().mockImplementation(class {})
}));

vi.mock('../../src/core/orchestration/switchboard', () => ({
  Switchboard: vi.fn().mockImplementation(class {
    detectAll = mockDetectAll;
    buildPlan = mockBuildPlan;
    applyPlan = mockApplyPlan;
  })
}));

vi.mock('../../src/core/registry/registryLoader', () => ({
  loadRegistry: mockLoadRegistry
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      info: mockLoggerInfo,
      warning: vi.fn(),
      error: mockLoggerError
    })
  }
}));

import { assignProfileAssistants } from '../../src/commands/assignProfileAssistants';

describe('assignProfileAssistants', () => {
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
    mockWithProgress.mockImplementation(async (_title, task) => task({ report: vi.fn() }));
    mockGetProfiles.mockResolvedValue([profile]);
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: profile.id,
        profileName: profile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      }
    ]);
    mockGetActiveProfileId.mockResolvedValue(undefined);
    mockDetectAll.mockResolvedValue({
      assistants: [
        {
          assistantKey: 'cline',
          displayName: 'Cline',
          extensionId: 'saoudrizwan.claude-dev',
          version: '1.0.0',
          isActive: true,
          tier: 'A',
          kind: 'vscode-extension'
        }
      ],
      clis: []
    });
    mockLoadRegistry.mockResolvedValue({
      assistants: [
        {
          key: 'cline',
          displayName: 'Cline',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['saoudrizwan.claude-dev'] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'A', configurationModes: ['config-file'], notes: [] },
          tlsVerification: { support: 'vscode-global', notes: '' },
          sources: []
        }
      ],
      dialectCatalog: {},
      $schemaVersion: '0.1.0',
      updatedAt: '2026-05-18'
    });
    mockBuildPlan.mockResolvedValue({
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
      changeLogEntry: {
        id: 'entry-1',
        timestamp: '2026-05-18T00:00:00.000Z',
        assistantKey: 'cline',
        profileName: profile.name,
        steps: []
      },
      assistantResults: new Map([['cline', { success: true }]])
    });
    mockShowQuickPick.mockResolvedValue([{ assistantKey: 'cline', label: 'Cline' }]);
    mockShowInformationMessage.mockResolvedValue('Apply');
    mockDeleteAssistantMapping.mockResolvedValue(undefined);
    mockSaveAssistantMapping.mockResolvedValue(undefined);
  });

  it('builds and applies the selected assistants to the chosen profile', async () => {
    await assignProfileAssistants({} as any, profile.id);

    expect(mockDetectAll).toHaveBeenCalledTimes(1);
    expect(mockBuildPlan).toHaveBeenCalledWith(profile, ['cline']);
    expect(mockApplyPlan).toHaveBeenCalledWith(expect.objectContaining({
      profileId: profile.id,
      assistantKeys: ['cline']
    }));
    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      'Apply "OpenAI Prod" to 1 assistant(s)?',
      { modal: true },
      'Apply'
    );
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('Assigned "OpenAI Prod" to 1 assistant'));
  });

  it('auto-switches detached assistants to a fallback profile when one can be chosen', async () => {
    const otherProfile: EndpointProfile = {
      ...profile,
      id: 'profile-2',
      name: 'OpenAI Stage',
      baseUrl: 'https://stage.example.com/v1'
    };
    mockGetProfiles.mockResolvedValue([profile, otherProfile]);
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: profile.id,
        profileName: profile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      },
      {
        assistantKey: 'kilo-code',
        profileId: profile.id,
        profileName: profile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      },
      {
        assistantKey: 'kilo-code',
        profileId: otherProfile.id,
        profileName: otherProfile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      }
    ]);
    mockDetectAll.mockResolvedValue({
      assistants: [
        {
          assistantKey: 'cline',
          displayName: 'Cline',
          extensionId: 'saoudrizwan.claude-dev',
          version: '1.0.0',
          isActive: true,
          tier: 'A',
          kind: 'vscode-extension'
        },
        {
          assistantKey: 'kilo-code',
          displayName: 'Kilo Code',
          extensionId: 'kilocode.kilo-code',
          version: '1.0.0',
          isActive: true,
          tier: 'A',
          kind: 'vscode-extension'
        }
      ],
      clis: []
    });
    mockLoadRegistry.mockResolvedValue({
      assistants: [
        {
          key: 'cline',
          displayName: 'Cline',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['saoudrizwan.claude-dev'] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'A', configurationModes: ['config-file'], notes: [] },
          tlsVerification: { support: 'vscode-global', notes: '' },
          sources: []
        },
        {
          key: 'kilo-code',
          displayName: 'Kilo Code',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['kilocode.kilo-code'] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'A', configurationModes: ['config-file'], notes: [] },
          tlsVerification: { support: 'vscode-global', notes: '' },
          sources: []
        }
      ],
      dialectCatalog: {},
      $schemaVersion: '0.1.0',
      updatedAt: '2026-05-18'
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
        profileId: otherProfile.id,
        assistantKeys: ['kilo-code'],
        createdAt: '2026-05-18T00:00:00.000Z',
        status: 'pending',
        steps: [
          {
            id: 'step-2',
            action: 'set-vscode-setting',
            description: 'Switch Kilo Code to the fallback profile',
            assistantKey: 'kilo-code',
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
        success: true,
        appliedSteps: [
          {
            id: 'step-2',
            action: 'set-vscode-setting',
            description: 'Switch Kilo Code to the fallback profile',
            assistantKey: 'kilo-code',
            data: {},
            reversible: true
          }
        ],
        failedSteps: [],
        assistantResults: new Map([['kilo-code', { success: true }]])
      });
    mockShowQuickPick.mockResolvedValue([{ assistantKey: 'cline', label: 'Cline' }]);

    await assignProfileAssistants({} as any, profile.id);

    expect(mockBuildPlan).toHaveBeenCalledWith(profile, ['cline']);
    expect(mockBuildPlan).toHaveBeenCalledWith(otherProfile, ['kilo-code']);
    expect(mockDeleteAssistantMapping).toHaveBeenCalledWith('kilo-code', profile.id);
    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      'Apply "OpenAI Prod" to 1 assistant(s) and detach 1 assistant(s)?',
      { modal: true },
      'Apply'
    );
    expect(mockShowSuccess).toHaveBeenCalledWith(
      'Assigned "OpenAI Prod" to 1 assistant(s) and detached 1 assistant(s). Auto-switched detached assistants to: kilo-code -> OpenAI Stage.'
    );
  });

  it('warns that detached assistants keep their current configuration when no fallback profile exists', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: profile.id,
        profileName: profile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      }
    ]);
    mockShowQuickPick.mockResolvedValue([]);

    await assignProfileAssistants({} as any, profile.id);

    expect(mockBuildPlan).not.toHaveBeenCalled();
    expect(mockApplyPlan).not.toHaveBeenCalled();
    expect(mockDeleteAssistantMapping).toHaveBeenCalledWith('cline', profile.id);
    expect(mockShowInformationMessage).toHaveBeenCalledWith(
      'Detach 1 assistant(s) from "OpenAI Prod"?',
      { modal: true },
      'Apply'
    );
    expect(mockShowWarning).toHaveBeenCalledWith(
      'Detached 1 assistant(s) from "OpenAI Prod". cline has no remaining mapped profile, so its current configuration was left unchanged.'
    );
  });

  it('does not detach assigned assistants that were omitted from the picker', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: profile.id,
        profileName: profile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      },
      {
        assistantKey: 'unknown-assistant',
        profileId: profile.id,
        profileName: profile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      }
    ]);
    mockShowQuickPick.mockResolvedValue([{ assistantKey: 'cline', label: 'Cline' }]);

    await assignProfileAssistants({} as any, profile.id);

    expect(mockBuildPlan).toHaveBeenCalledWith(profile, ['cline']);
    expect(mockDeleteAssistantMapping).not.toHaveBeenCalledWith('unknown-assistant', profile.id);
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('Assigned "OpenAI Prod" to 1 assistant'));
  });

  it('marks an assistant as picked when it is assigned to the current and another profile', async () => {
    const otherProfile: EndpointProfile = {
      ...profile,
      id: 'profile-2',
      name: 'OpenAI Stage'
    };
    mockGetProfiles.mockResolvedValue([profile, otherProfile]);
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: otherProfile.id,
        profileName: otherProfile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      },
      {
        assistantKey: 'cline',
        profileId: profile.id,
        profileName: profile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      }
    ]);

    await assignProfileAssistants({} as any, profile.id);

    const items = mockShowQuickPick.mock.calls[0][0] as Array<{ assistantKey: string; picked?: boolean; detail?: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].assistantKey).toBe('cline');
    expect(items[0].picked).toBe(true);
    expect(items[0].detail).toContain('assigned to this profile');
  });

  it('shows an error when the requested profile does not exist', async () => {
    await assignProfileAssistants({} as any, 'missing-profile');

    expect(mockShowError).toHaveBeenCalledWith(
      'Profile not found. Open Manage Profiles and choose a valid profile first.'
    );
    expect(mockDetectAll).not.toHaveBeenCalled();
  });

  it('warns when no profiles exist and no profileId is provided', async () => {
    mockGetProfiles.mockResolvedValue([]);

    await assignProfileAssistants({} as any);

    expect(mockShowWarning).toHaveBeenCalledWith(
      'No profiles exist yet. Run setup or Manage Profiles first.'
    );
    expect(mockDetectAll).not.toHaveBeenCalled();
  });

  it('prompts for a profile when profileId is omitted and sorts profile names', async () => {
    const otherProfile: EndpointProfile = {
      ...profile,
      id: 'profile-2',
      name: 'Alpha Stage',
      baseUrl: 'https://stage.example.com/v1'
    };
    mockGetProfiles.mockResolvedValue([profile, otherProfile]);
    mockShowQuickPick
      .mockResolvedValueOnce({
        label: otherProfile.name,
        description: otherProfile.baseUrl,
        detail: otherProfile.dialect,
        profile: otherProfile
      })
      .mockResolvedValueOnce([{ assistantKey: 'cline', label: 'Cline' }]);

    await assignProfileAssistants({} as any);

    const [profileItems, profileOptions] = mockShowQuickPick.mock.calls[0] as [
      Array<{ label: string; profile: EndpointProfile }>,
      { title: string; placeHolder: string; matchOnDetail: boolean }
    ];
    expect(profileItems.map((item) => item.label)).toEqual(['Alpha Stage', 'OpenAI Prod']);
    expect(profileOptions).toEqual(expect.objectContaining({
      title: 'Assign Assistants to Profile',
      matchOnDetail: true
    }));
    expect(mockBuildPlan).toHaveBeenCalledWith(otherProfile, ['cline']);
  });

  it('warns when no switchable assistants are detected for the selected profile', async () => {
    mockGetAssistantMappings.mockResolvedValue([]);
    mockDetectAll.mockResolvedValue({ assistants: [], clis: [] });

    await assignProfileAssistants({} as any, profile.id);

    expect(mockShowWarning).toHaveBeenCalledWith(
      'No switchable assistants are currently detected. Run setup after installing an assistant or CLI first.'
    );
    expect(mockShowQuickPick).not.toHaveBeenCalled();
  });

  it('logs and returns when the assistant picker is dismissed', async () => {
    mockShowQuickPick.mockResolvedValue(undefined);

    await assignProfileAssistants({} as any, profile.id);

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'Assistant assignment cancelled for profile OpenAI Prod'
    );
    expect(mockBuildPlan).not.toHaveBeenCalled();
  });

  it('warns when nothing is selected and there is nothing to detach', async () => {
    mockGetAssistantMappings.mockResolvedValue([]);
    mockShowQuickPick.mockResolvedValue([]);

    await assignProfileAssistants({} as any, profile.id);

    expect(mockShowWarning).toHaveBeenCalledWith('No assistants selected. Nothing changed.');
    expect(mockBuildPlan).not.toHaveBeenCalled();
  });

  it('warns when selected assistants have no available assignment steps', async () => {
    mockBuildPlan.mockResolvedValue({
      id: 'plan-empty',
      profileId: profile.id,
      assistantKeys: ['cline'],
      createdAt: '2026-05-18T00:00:00.000Z',
      status: 'pending',
      steps: []
    });

    await assignProfileAssistants({} as any, profile.id);

    expect(mockShowWarning).toHaveBeenCalledWith('No assignment steps are available for: cline.');
    expect(mockShowInformationMessage).not.toHaveBeenCalled();
  });

  it('logs and returns when the confirmation prompt is cancelled', async () => {
    mockShowInformationMessage.mockResolvedValue('Cancel');

    await assignProfileAssistants({} as any, profile.id);

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'Assistant assignment confirmation dismissed for profile OpenAI Prod'
    );
    expect(mockApplyPlan).not.toHaveBeenCalled();
    expect(mockDeleteAssistantMapping).not.toHaveBeenCalled();
  });

  it('shows a warning when assignment partially succeeds with guided follow-up and skipped assistants', async () => {
    mockShowQuickPick.mockResolvedValue([
      { assistantKey: 'cline', label: 'Cline' },
      { assistantKey: 'anythingllm', label: 'AnythingLLM' }
    ]);
    mockLoadRegistry.mockResolvedValue({
      assistants: [
        {
          key: 'cline',
          displayName: 'Cline',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['saoudrizwan.claude-dev'] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'A', configurationModes: ['config-file'], notes: [] },
          tlsVerification: { support: 'vscode-global', notes: '' },
          sources: []
        },
        {
          key: 'anythingllm',
          displayName: 'AnythingLLM',
          kind: 'desktop-app',
          detection: { executableNames: ['anythingllm'] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'B', configurationModes: ['guided'], notes: [] },
          tlsVerification: { support: 'custom', notes: '' },
          sources: []
        }
      ],
      dialectCatalog: {},
      $schemaVersion: '0.1.0',
      updatedAt: '2026-05-18'
    });
    mockDetectAll.mockResolvedValue({
      assistants: [
        {
          assistantKey: 'cline',
          displayName: 'Cline',
          extensionId: 'saoudrizwan.claude-dev',
          version: '1.0.0',
          isActive: true,
          tier: 'A',
          kind: 'vscode-extension'
        },
        {
          assistantKey: 'anythingllm',
          displayName: 'AnythingLLM',
          extensionId: 'anythingllm.desktop',
          version: '1.0.0',
          isActive: true,
          tier: 'B',
          kind: 'desktop-app'
        }
      ],
      clis: []
    });
    mockBuildPlan.mockResolvedValue({
      id: 'plan-guided',
      profileId: profile.id,
      assistantKeys: ['cline', 'anythingllm'],
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
        },
        {
          id: 'step-2',
          action: 'show-guided-steps',
          description: 'Open AnythingLLM settings',
          assistantKey: 'anythingllm',
          data: {},
          reversible: false
        }
      ]
    });
    mockApplyPlan.mockResolvedValue({
      success: false,
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
      failedSteps: [
        {
          id: 'step-2',
          action: 'show-guided-steps',
          description: 'Open AnythingLLM settings',
          assistantKey: 'anythingllm',
          data: {},
          reversible: false,
          error: 'manual follow-up required'
        }
      ],
      assistantResults: new Map([
        ['cline', { success: true }],
        ['anythingllm', { success: false, reason: 'manual follow-up required' }]
      ])
    });

    await assignProfileAssistants({} as any, profile.id);

    expect(mockShowWarning).toHaveBeenCalledWith(
      'Assigned "OpenAI Prod" to 1 assistant(s). Failures: anythingllm (manual follow-up required). Guided follow-up is required for: anythingllm.'
    );
  });

  it('includes skipped assistants in the success message when no plan is generated for part of the selection', async () => {
    mockShowQuickPick.mockResolvedValue([
      { assistantKey: 'cline', label: 'Cline' },
      { assistantKey: 'anythingllm', label: 'AnythingLLM' }
    ]);
    mockLoadRegistry.mockResolvedValue({
      assistants: [
        {
          key: 'cline',
          displayName: 'Cline',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['saoudrizwan.claude-dev'] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'A', configurationModes: ['config-file'], notes: [] },
          tlsVerification: { support: 'vscode-global', notes: '' },
          sources: []
        },
        {
          key: 'anythingllm',
          displayName: 'AnythingLLM',
          kind: 'desktop-app',
          detection: { executableNames: ['anythingllm'] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'B', configurationModes: ['guided'], notes: [] },
          tlsVerification: { support: 'custom', notes: '' },
          sources: []
        }
      ],
      dialectCatalog: {},
      $schemaVersion: '0.1.0',
      updatedAt: '2026-05-18'
    });
    mockDetectAll.mockResolvedValue({
      assistants: [
        {
          assistantKey: 'cline',
          displayName: 'Cline',
          extensionId: 'saoudrizwan.claude-dev',
          version: '1.0.0',
          isActive: true,
          tier: 'A',
          kind: 'vscode-extension'
        },
        {
          assistantKey: 'anythingllm',
          displayName: 'AnythingLLM',
          extensionId: 'anythingllm.desktop',
          version: '1.0.0',
          isActive: true,
          tier: 'B',
          kind: 'desktop-app'
        }
      ],
      clis: []
    });
    mockBuildPlan.mockResolvedValue({
      id: 'plan-partial-build',
      profileId: profile.id,
      assistantKeys: ['cline', 'anythingllm'],
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

    await assignProfileAssistants({} as any, profile.id);

    expect(mockShowSuccess).toHaveBeenCalledWith(
      'Assigned "OpenAI Prod" to 1 assistant(s). No plan was generated for: anythingllm.'
    );
  });

  it('shows an error when every update fails', async () => {
    mockApplyPlan.mockResolvedValue({
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
      assistantResults: new Map([
        ['cline', { success: false, reason: 'write failed' }]
      ])
    });

    await assignProfileAssistants({} as any, profile.id);

    expect(mockShowError).toHaveBeenCalledWith(
      'Failed to update assistants for "OpenAI Prod". Failures: cline (write failed).'
    );
  });

  it('omits failure reasons when an assistant result does not provide one', async () => {
    mockApplyPlan.mockResolvedValue({
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
      assistantResults: new Map([
        ['cline', { success: false }]
      ])
    });

    await assignProfileAssistants({} as any, profile.id);

    expect(mockShowError).toHaveBeenCalledWith(
      'Failed to update assistants for "OpenAI Prod". Failures: cline.'
    );
  });

  it('reports detach failures and shows a warning when at least one change succeeded', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: profile.id,
        profileName: profile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      },
      {
        assistantKey: 'kilo-code',
        profileId: profile.id,
        profileName: profile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      }
    ]);
    mockDetectAll.mockResolvedValue({
      assistants: [
        {
          assistantKey: 'cline',
          displayName: 'Cline',
          extensionId: 'saoudrizwan.claude-dev',
          version: '1.0.0',
          isActive: true,
          tier: 'A',
          kind: 'vscode-extension'
        },
        {
          assistantKey: 'kilo-code',
          displayName: 'Kilo Code',
          extensionId: 'kilocode.kilo-code',
          version: '1.0.0',
          isActive: true,
          tier: 'A',
          kind: 'vscode-extension'
        }
      ],
      clis: []
    });
    mockLoadRegistry.mockResolvedValue({
      assistants: [
        {
          key: 'cline',
          displayName: 'Cline',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['saoudrizwan.claude-dev'] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'A', configurationModes: ['config-file'], notes: [] },
          tlsVerification: { support: 'vscode-global', notes: '' },
          sources: []
        },
        {
          key: 'kilo-code',
          displayName: 'Kilo Code',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['kilocode.kilo-code'] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'A', configurationModes: ['config-file'], notes: [] },
          tlsVerification: { support: 'vscode-global', notes: '' },
          sources: []
        }
      ],
      dialectCatalog: {},
      $schemaVersion: '0.1.0',
      updatedAt: '2026-05-18'
    });
    mockShowQuickPick.mockResolvedValue([{ assistantKey: 'cline', label: 'Cline' }]);
    mockDeleteAssistantMapping.mockRejectedValueOnce(new Error('storage failure'));

    await assignProfileAssistants({} as any, profile.id);

    expect(mockShowWarning).toHaveBeenCalledWith(
      'Assigned "OpenAI Prod" to 1 assistant(s). Failures: kilo-code (storage failure).'
    );
  });

  it('stringifies non-Error detach failures and still reports the warning summary', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: profile.id,
        profileName: profile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      },
      {
        assistantKey: 'kilo-code',
        profileId: profile.id,
        profileName: profile.name,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      }
    ]);
    mockDetectAll.mockResolvedValue({
      assistants: [
        {
          assistantKey: 'cline',
          displayName: 'Cline',
          extensionId: 'saoudrizwan.claude-dev',
          version: '1.0.0',
          isActive: true,
          tier: 'A',
          kind: 'vscode-extension'
        },
        {
          assistantKey: 'kilo-code',
          displayName: 'Kilo Code',
          extensionId: 'kilocode.kilo-code',
          version: '1.0.0',
          isActive: true,
          tier: 'A',
          kind: 'vscode-extension'
        }
      ],
      clis: []
    });
    mockLoadRegistry.mockResolvedValue({
      assistants: [
        {
          key: 'cline',
          displayName: 'Cline',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['saoudrizwan.claude-dev'] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'A', configurationModes: ['config-file'], notes: [] },
          tlsVerification: { support: 'vscode-global', notes: '' },
          sources: []
        },
        {
          key: 'kilo-code',
          displayName: 'Kilo Code',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['kilocode.kilo-code'] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'A', configurationModes: ['config-file'], notes: [] },
          tlsVerification: { support: 'vscode-global', notes: '' },
          sources: []
        }
      ],
      dialectCatalog: {},
      $schemaVersion: '0.1.0',
      updatedAt: '2026-05-18'
    });
    mockShowQuickPick.mockResolvedValue([{ assistantKey: 'cline', label: 'Cline' }]);
    mockDeleteAssistantMapping.mockRejectedValueOnce('storage failure');

    await assignProfileAssistants({} as any, profile.id);

    expect(mockShowWarning).toHaveBeenCalledWith(
      'Assigned "OpenAI Prod" to 1 assistant(s). Failures: kilo-code (storage failure).'
    );
  });

  it('labels assistants detected as both extension and CLI', async () => {
    mockGetAssistantMappings.mockResolvedValue([]);
    mockLoadRegistry.mockResolvedValue({
      assistants: [
        {
          key: 'claude-code',
          displayName: 'Claude Code',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['anthropic.claude-code'] },
          dialect: { primary: 'anthropic.messages', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'B', configurationModes: ['config-file'], notes: [] },
          tlsVerification: { support: 'custom', notes: '' },
          sources: []
        }
      ],
      dialectCatalog: {},
      $schemaVersion: '0.1.0',
      updatedAt: '2026-05-18'
    });
    mockDetectAll.mockResolvedValue({
      assistants: [
        {
          assistantKey: 'claude-code',
          displayName: 'Claude Code',
          extensionId: 'anthropic.claude-code',
          version: '1.0.0',
          isActive: true,
          tier: 'B',
          kind: 'vscode-extension'
        }
      ],
      clis: [
        {
          assistantKey: 'claude-code',
          command: 'claude',
          version: '1.0.0'
        }
      ]
    });
    mockShowQuickPick.mockResolvedValue(undefined);

    await assignProfileAssistants({} as any, profile.id);

    const items = mockShowQuickPick.mock.calls[0][0] as Array<{ label: string; detail?: string }>;
    expect(items).toEqual([
      expect.objectContaining({
        label: 'Claude Code',
        detail: 'Detected as extension and CLI'
      })
    ]);
  });

  it('labels assistants detected only via CLI', async () => {
    mockGetAssistantMappings.mockResolvedValue([]);
    mockLoadRegistry.mockResolvedValue({
      assistants: [
        {
          key: 'claude-code',
          displayName: 'Claude Code',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['anthropic.claude-code'] },
          dialect: { primary: 'anthropic.messages', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'B', configurationModes: ['config-file'], notes: [] },
          tlsVerification: { support: 'custom', notes: '' },
          sources: []
        }
      ],
      dialectCatalog: {},
      $schemaVersion: '0.1.0',
      updatedAt: '2026-05-18'
    });
    mockDetectAll.mockResolvedValue({
      assistants: [],
      clis: [
        {
          assistantKey: 'claude-code',
          command: 'claude',
          version: '1.0.0'
        }
      ]
    });
    mockShowQuickPick.mockResolvedValue(undefined);

    await assignProfileAssistants({} as any, profile.id);

    const items = mockShowQuickPick.mock.calls[0][0] as Array<{ label: string; detail?: string }>;
    expect(items).toEqual([
      expect.objectContaining({
        label: 'Claude Code',
        detail: 'Detected as CLI'
      })
    ]);
  });

  it('shows previously assigned assistants with raw profile ids when they are not currently detected', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'claude-code',
        profileId: profile.id,
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      },
      {
        assistantKey: 'claude-code',
        profileId: 'profile-missing',
        appliedMode: 'settings',
        appliedAt: '2026-05-17T00:00:00.000Z'
      }
    ]);
    mockDetectAll.mockResolvedValue({ assistants: [], clis: [] });
    mockLoadRegistry.mockResolvedValue({
      assistants: [
        {
          key: 'claude-code',
          displayName: 'Claude Code',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['anthropic.claude-code'] },
          dialect: { primary: 'anthropic.messages', alsoPossible: [] },
          endpointSwitching: { supported: true, tier: 'B', configurationModes: ['config-file'], notes: [] },
          tlsVerification: { support: 'custom', notes: '' },
          sources: []
        }
      ],
      dialectCatalog: {},
      $schemaVersion: '0.1.0',
      updatedAt: '2026-05-18'
    });
    mockShowQuickPick.mockResolvedValue(undefined);

    await assignProfileAssistants({} as any, profile.id);

    const items = mockShowQuickPick.mock.calls[0][0] as Array<{ label: string; detail?: string }>;
    expect(items).toEqual([
      expect.objectContaining({
        label: 'Claude Code',
        detail: 'Previously assigned · assigned to this profile and profile-missing'
      })
    ]);
  });
});