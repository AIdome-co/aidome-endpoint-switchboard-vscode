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
  mockDeleteAssistantMapping,
  mockDetectAll,
  mockBuildPlan,
  mockApplyPlan,
  mockLoadRegistry,
  mockLoggerInfo
} = vi.hoisted(() => ({
  mockShowQuickPick: vi.fn(),
  mockShowInformationMessage: vi.fn(),
  mockWithProgress: vi.fn(),
  mockShowSuccess: vi.fn(),
  mockShowWarning: vi.fn(),
  mockShowError: vi.fn(),
  mockGetProfiles: vi.fn(),
  mockGetAssistantMappings: vi.fn(),
  mockDeleteAssistantMapping: vi.fn(),
  mockDetectAll: vi.fn(),
  mockBuildPlan: vi.fn(),
  mockApplyPlan: vi.fn(),
  mockLoadRegistry: vi.fn(),
  mockLoggerInfo: vi.fn()
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
    deleteAssistantMapping = mockDeleteAssistantMapping;
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
      error: vi.fn()
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
  });

  it('builds and applies the selected assistants to the chosen profile', async () => {
    await assignProfileAssistants({} as any, profile.id);

    expect(mockDetectAll).toHaveBeenCalledTimes(1);
    expect(mockBuildPlan).toHaveBeenCalledWith(profile, ['cline']);
    expect(mockApplyPlan).toHaveBeenCalledWith(expect.objectContaining({
      profileId: profile.id,
      assistantKeys: ['cline']
    }));
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('Assigned "OpenAI Prod" to 1 assistant'));
  });

  it('detaches assistants that were previously assigned but are now unchecked', async () => {
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

    await assignProfileAssistants({} as any, profile.id);

    expect(mockBuildPlan).toHaveBeenCalledWith(profile, ['cline']);
    expect(mockDeleteAssistantMapping).toHaveBeenCalledWith('kilo-code', profile.id);
    expect(mockShowSuccess).toHaveBeenCalledWith(expect.stringContaining('detached 1 assistant'));
  });

  it('detaches all assistants when everything is unchecked', async () => {
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
    expect(mockShowSuccess).toHaveBeenCalledWith('Detached 1 assistant(s) from "OpenAI Prod".');
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
});