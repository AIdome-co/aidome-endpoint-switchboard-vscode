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

import { activateProfileAndReapplyMappings } from '../../src/commands/profileActivation';

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
        profileName: 'old-profile',
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
          data: { steps: ['Use ANTHROPIC_API_KEY'] },
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
        profileName: 'old-profile',
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
});