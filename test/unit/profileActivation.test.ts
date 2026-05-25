import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointProfile } from '../../src/core/profiles/profileTypes';

const {
  mockWithProgress,
  mockGetProfiles,
  mockGetAssistantMappings,
  mockSetActiveProfile,
  mockBuildPlan,
  mockApplyPlan,
  mockUpdateStatusBar,
  mockLoggerInfo,
  mockLoggerWarning,
  mockLoggerError,
  mockLoadRegistry
} = vi.hoisted(() => ({
  mockWithProgress: vi.fn(),
  mockGetProfiles: vi.fn(),
  mockGetAssistantMappings: vi.fn(),
  mockSetActiveProfile: vi.fn(),
  mockBuildPlan: vi.fn(),
  mockApplyPlan: vi.fn(),
  mockUpdateStatusBar: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarning: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoadRegistry: vi.fn()
}));

vi.mock('vscode', () => ({
  window: {
    withProgress: mockWithProgress
  },
  ProgressLocation: { Notification: 15 }
}));

vi.mock('../../src/core/profiles/profileStore', () => ({
  ProfileStore: vi.fn().mockImplementation(class {
    getProfiles = mockGetProfiles;
    getAssistantMappings = mockGetAssistantMappings;
    setActiveProfile = mockSetActiveProfile;
  })
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn().mockImplementation(class {})
}));

vi.mock('../../src/core/orchestration/switchboard', () => ({
  Switchboard: vi.fn().mockImplementation(class {
    buildPlan = mockBuildPlan;
    applyPlan = mockApplyPlan;
  })
}));

vi.mock('../../src/core/registry/registryLoader', () => ({
  loadRegistry: mockLoadRegistry
}));

vi.mock('../../src/ui/statusBar', () => ({
  updateStatusBar: mockUpdateStatusBar
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

import {
  activateProfileAndReapplyMappings,
  getProfileActivationNotice
} from '../../src/commands/activateProfile';

describe('activateProfileAndReapplyMappings', () => {
  const profile: EndpointProfile = {
    id: 'profile-1',
    name: 'claude-test3',
    baseUrl: 'https://demo-lab-vm-8a4ad0fc.aidome.cloud/v1',
    dialect: 'openai.chat_completions',
    profileType: 'aidome',
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWithProgress.mockImplementation(async (_options, task) => task({ report: vi.fn() }));
    mockLoadRegistry.mockResolvedValue({ assistants: [], dialectCatalog: {} });
    mockGetProfiles.mockResolvedValue([profile]);
    mockSetActiveProfile.mockResolvedValue(undefined);
    mockApplyPlan.mockResolvedValue({
      success: true,
      appliedSteps: [],
      failedSteps: [],
      changeLogEntry: { id: 'entry-1', timestamp: '2026-05-16T00:00:00.000Z', assistantKey: 'claude-code', profileName: 'claude-test3', steps: [] },
      assistantResults: new Map([['claude-code', { success: true }]])
    });
  });

  it('reapplies only automated steps for mapped assistants before setting active', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'claude-code',
        profileId: profile.id,
        appliedMode: 'settings',
        appliedAt: '2026-05-16T00:00:00.000Z'
      }
    ]);
    mockBuildPlan.mockResolvedValue({
      id: 'plan-1',
      profileId: profile.id,
      assistantKeys: ['claude-code'],
      createdAt: '2026-05-16T00:00:00.000Z',
      status: 'pending',
      steps: [
        {
          id: 'step-1',
          action: 'edit-config-file',
          description: 'Rewrite Claude settings',
          assistantKey: 'claude-code',
          targetPath: '/home/aidome-dev/.claude/settings.json',
          data: {},
          reversible: true
        },
        {
          id: 'step-2',
          action: 'show-guided-steps',
          description: 'Show auth guidance',
          assistantKey: 'claude-code',
          data: { steps: ['Use ANTHROPIC_AUTH_TOKEN'] },
          reversible: false
        },
        {
          id: 'step-3',
          action: 'verify-endpoint',
          description: 'Verify endpoint',
          assistantKey: 'claude-code',
          data: {},
          reversible: false
        }
      ]
    });

    const result = await activateProfileAndReapplyMappings({} as any, profile.id);

    expect(mockBuildPlan).toHaveBeenCalledWith(profile, ['claude-code']);
    expect(mockApplyPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantKeys: ['claude-code'],
        steps: [
          expect.objectContaining({ action: 'edit-config-file', assistantKey: 'claude-code' })
        ]
      })
    );
    expect(mockSetActiveProfile).toHaveBeenCalledWith(profile.id);
    expect(mockUpdateStatusBar).toHaveBeenCalledWith(profile.name);
    expect(result.status).toBe('success');
    expect(result.appliedAssistantKeys).toEqual(['claude-code']);
    expect(result.skippedAssistantKeys).toEqual([]);
  });

  it('sets the active profile without applying when no assistants are mapped', async () => {
    mockGetAssistantMappings.mockResolvedValue([]);

    const result = await activateProfileAndReapplyMappings({} as any, profile.id);

    expect(mockBuildPlan).not.toHaveBeenCalled();
    expect(mockApplyPlan).not.toHaveBeenCalled();
    expect(mockSetActiveProfile).toHaveBeenCalledWith(profile.id);
    expect(mockUpdateStatusBar).toHaveBeenCalledWith(profile.name);
    expect(result.status).toBe('active-only');
    expect(result.appliedAssistantKeys).toEqual([]);
  });

  it('marks guided-only assistants as skipped and still switches the active profile', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'anythingllm',
        profileId: profile.id,
        appliedMode: 'guided',
        appliedAt: '2026-05-16T00:00:00.000Z'
      }
    ]);
    mockBuildPlan.mockResolvedValue({
      id: 'plan-2',
      profileId: profile.id,
      assistantKeys: ['anythingllm'],
      createdAt: '2026-05-16T00:00:00.000Z',
      status: 'pending',
      steps: [
        {
          id: 'step-1',
          action: 'show-guided-steps',
          description: 'Show desktop guidance',
          assistantKey: 'anythingllm',
          data: { steps: ['Open the desktop settings UI'] },
          reversible: false
        }
      ]
    });

    const result = await activateProfileAndReapplyMappings({} as any, profile.id);

    expect(mockApplyPlan).not.toHaveBeenCalled();
    expect(mockSetActiveProfile).toHaveBeenCalledWith(profile.id);
    expect(result.status).toBe('active-only');
    expect(result.skippedAssistantKeys).toEqual(['anythingllm']);
  });

  it('logs "none" when mapped assistant keys are empty strings and no automatic steps exist', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: '',
        profileId: profile.id,
        appliedMode: 'guided',
        appliedAt: '2026-05-16T00:00:00.000Z'
      }
    ]);
    mockBuildPlan.mockResolvedValue({
      id: 'plan-empty-key',
      profileId: profile.id,
      assistantKeys: [''],
      createdAt: '2026-05-16T00:00:00.000Z',
      status: 'pending',
      steps: []
    });

    const result = await activateProfileAndReapplyMappings({} as any, profile.id);

    expect(result.status).toBe('active-only');
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'Activated profile claude-test3 but no assigned assistants had automatic reapply steps: none'
    );
  });

  it('returns failed when the profile ID does not exist', async () => {
    const result = await activateProfileAndReapplyMappings({} as any, 'missing-profile');

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('missing-profile');
    expect(mockSetActiveProfile).not.toHaveBeenCalled();
  });

  it('returns failed when buildPlan throws', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: profile.id,
        appliedMode: 'settings',
        appliedAt: '2026-05-16T00:00:00.000Z'
      }
    ]);
    mockBuildPlan.mockRejectedValueOnce(new Error('Registry load failed'));

    const result = await activateProfileAndReapplyMappings({} as any, profile.id);

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Registry load failed');
    expect(mockSetActiveProfile).not.toHaveBeenCalled();
  });

  it('returns partial when some assistants fail to reapply', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: profile.id,
        appliedMode: 'settings',
        appliedAt: '2026-05-16T00:00:00.000Z'
      },
      {
        assistantKey: 'continue',
        profileId: profile.id,
        appliedMode: 'settings',
        appliedAt: '2026-05-16T00:00:00.000Z'
      }
    ]);
    mockBuildPlan.mockResolvedValueOnce({
      id: 'plan-3',
      profileId: profile.id,
      assistantKeys: ['cline', 'continue'],
      createdAt: '2026-05-16T00:00:00.000Z',
      status: 'pending',
      steps: [
        {
          id: 'step-1',
          action: 'set-vscode-setting',
          description: 'Set Cline base URL',
          assistantKey: 'cline',
          targetPath: 'cline.baseUrl',
          data: {},
          reversible: true
        },
        {
          id: 'step-2',
          action: 'set-vscode-setting',
          description: 'Set Continue base URL',
          assistantKey: 'continue',
          targetPath: 'continue.apiBase',
          data: {},
          reversible: true
        }
      ]
    });
    mockApplyPlan.mockResolvedValueOnce({
      success: false,
      appliedSteps: [
        {
          id: 'step-1',
          action: 'set-vscode-setting',
          description: 'Set Cline base URL',
          assistantKey: 'cline',
          targetPath: 'cline.baseUrl',
          data: {},
          reversible: true
        }
      ],
      failedSteps: [
        {
          id: 'step-2',
          action: 'set-vscode-setting',
          description: 'Set Continue base URL',
          assistantKey: 'continue',
          targetPath: 'continue.apiBase',
          data: {},
          reversible: true,
          error: 'settings update failed'
        }
      ],
      changeLogEntry: { id: 'entry-2', timestamp: '2026-05-16T00:00:00.000Z', assistantKey: 'cline', profileName: profile.name, steps: [] },
      assistantResults: new Map([
        ['cline', { success: true }],
        ['continue', { success: false }]
      ])
    });

    const result = await activateProfileAndReapplyMappings({} as any, profile.id);

    expect(result.status).toBe('partial');
    expect(result.appliedAssistantKeys).toEqual(['cline']);
    expect(result.failedAssistantKeys).toEqual(['continue']);
    expect(mockSetActiveProfile).toHaveBeenCalledWith(profile.id);
  });

  it('returns failed without activating when all assistant reapply steps fail', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: profile.id,
        appliedMode: 'settings',
        appliedAt: '2026-05-16T00:00:00.000Z'
      }
    ]);
    mockBuildPlan.mockResolvedValueOnce({
      id: 'plan-4',
      profileId: profile.id,
      assistantKeys: ['cline'],
      createdAt: '2026-05-16T00:00:00.000Z',
      status: 'pending',
      steps: [
        {
          id: 'step-1',
          action: 'set-vscode-setting',
          description: 'Set Cline base URL',
          assistantKey: 'cline',
          targetPath: 'cline.baseUrl',
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
          action: 'set-vscode-setting',
          description: 'Set Cline base URL',
          assistantKey: 'cline',
          targetPath: 'cline.baseUrl',
          data: {},
          reversible: true,
          error: 'settings update failed'
        }
      ],
      changeLogEntry: { id: 'entry-3', timestamp: '2026-05-16T00:00:00.000Z', assistantKey: 'cline', profileName: profile.name, steps: [] },
      assistantResults: new Map([
        ['cline', { success: false }]
      ])
    });

    const result = await activateProfileAndReapplyMappings({} as any, profile.id);

    expect(result.status).toBe('failed');
    expect(result.failedAssistantKeys).toEqual(['cline']);
    expect(result.appliedAssistantKeys).toEqual([]);
    expect(mockSetActiveProfile).not.toHaveBeenCalled();
  });

  it('returns failed when setActiveProfile throws after a successful reapply', async () => {
    mockGetAssistantMappings.mockResolvedValue([
      {
        assistantKey: 'cline',
        profileId: profile.id,
        appliedMode: 'settings',
        appliedAt: '2026-05-16T00:00:00.000Z'
      }
    ]);
    mockBuildPlan.mockResolvedValueOnce({
      id: 'plan-5',
      profileId: profile.id,
      assistantKeys: ['cline'],
      createdAt: '2026-05-16T00:00:00.000Z',
      status: 'pending',
      steps: [
        {
          id: 'step-1',
          action: 'set-vscode-setting',
          description: 'Set Cline base URL',
          assistantKey: 'cline',
          targetPath: 'cline.baseUrl',
          data: {},
          reversible: true
        }
      ]
    });
    mockApplyPlan.mockResolvedValueOnce({
      success: true,
      appliedSteps: [
        {
          id: 'step-1',
          action: 'set-vscode-setting',
          description: 'Set Cline base URL',
          assistantKey: 'cline',
          targetPath: 'cline.baseUrl',
          data: {},
          reversible: true
        }
      ],
      failedSteps: [],
      changeLogEntry: { id: 'entry-4', timestamp: '2026-05-16T00:00:00.000Z', assistantKey: 'cline', profileName: profile.name, steps: [] },
      assistantResults: new Map([
        ['cline', { success: true }]
      ])
    });
    mockSetActiveProfile.mockRejectedValueOnce(new Error('Storage quota exceeded'));

    const result = await activateProfileAndReapplyMappings({} as any, profile.id);

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Storage quota exceeded');
  });
});

describe('getProfileActivationNotice', () => {
  const profile: EndpointProfile = {
    id: 'profile-1',
    name: 'claude-test3',
    baseUrl: 'https://demo-lab-vm-8a4ad0fc.aidome.cloud/v1',
    dialect: 'openai.chat_completions',
    profileType: 'aidome',
    createdAt: '2026-05-16T00:00:00.000Z',
    updatedAt: '2026-05-16T00:00:00.000Z'
  };

  it('returns success for full activation', () => {
    const notice = getProfileActivationNotice({
      status: 'success',
      profile,
      mappedAssistantKeys: ['cline'],
      appliedAssistantKeys: ['cline'],
      failedAssistantKeys: [],
      skippedAssistantKeys: []
    });

    expect(notice.kind).toBe('success');
    expect(notice.message).toContain('claude-test3');
  });

  it('returns warning for active-only activation with skipped assistants', () => {
    const notice = getProfileActivationNotice({
      status: 'active-only',
      profile,
      mappedAssistantKeys: ['anythingllm'],
      appliedAssistantKeys: [],
      failedAssistantKeys: [],
      skippedAssistantKeys: ['anythingllm']
    });

    expect(notice.kind).toBe('warning');
    expect(notice.message).toContain('require manual switching');
  });

  it('returns warning for partial activation', () => {
    const notice = getProfileActivationNotice({
      status: 'partial',
      profile,
      mappedAssistantKeys: ['cline', 'continue'],
      appliedAssistantKeys: ['cline'],
      failedAssistantKeys: ['continue'],
      skippedAssistantKeys: []
    });

    expect(notice.kind).toBe('warning');
    expect(notice.message).toContain('1 failed');
  });

  it('returns error for failed activation', () => {
    const notice = getProfileActivationNotice({
      status: 'failed',
      profile,
      mappedAssistantKeys: [],
      appliedAssistantKeys: [],
      failedAssistantKeys: [],
      skippedAssistantKeys: [],
      errorMessage: 'Profile not found.'
    });

    expect(notice.kind).toBe('error');
    expect(notice.message).toBe('Profile not found.');
  });
});