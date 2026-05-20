import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetProfiles,
  mockSetActiveProfile,
  mockGetAssistantMappings,
  mockDetectAll,
  mockBuildPlan,
  mockApplyPlan,
  mockUpdateStatusBar,
} = vi.hoisted(() => ({
  mockGetProfiles: vi.fn(),
  mockSetActiveProfile: vi.fn(),
  mockGetAssistantMappings: vi.fn(),
  mockDetectAll: vi.fn(),
  mockBuildPlan: vi.fn(),
  mockApplyPlan: vi.fn(),
  mockUpdateStatusBar: vi.fn(),
}));

vi.mock('../../src/core/profiles/profileStore', () => ({
  ProfileStore: vi.fn(function (this: Record<string, unknown>) {
    this.getProfiles = mockGetProfiles;
    this.setActiveProfile = mockSetActiveProfile;
    this.getAssistantMappings = mockGetAssistantMappings;
    this.saveProfile = vi.fn();
    this.saveAssistantMapping = vi.fn();
  }),
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn(function (this: Record<string, unknown>) {
    this.storeSecret = vi.fn();
    this.getSecret = vi.fn();
  }),
}));

vi.mock('../../src/core/orchestration/switchboard', () => ({
  Switchboard: vi.fn(function (this: Record<string, unknown>) {
    this.detectAll = mockDetectAll;
    this.buildPlan = mockBuildPlan;
    this.applyPlan = mockApplyPlan;
  }),
}));

vi.mock('../../src/core/registry/registryLoader', () => ({
  loadRegistry: vi.fn(async () => ({ assistants: [], dialectCatalog: {} })),
}));

vi.mock('../../src/ui/statusBar', () => ({ updateStatusBar: mockUpdateStatusBar }));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    })),
    initialize: vi.fn(),
  },
}));

vi.mock('vscode', () => ({
  window: {
    withProgress: vi.fn((_opts: unknown, fn: (progress: { report: () => void }) => Promise<unknown>) =>
      fn({ report: vi.fn() })
    ),
  },
  ProgressLocation: { Notification: 15 },
}));

import {
  activateProfileAndReapplyMappings,
  getProfileActivationNotice,
} from '../../src/commands/activateProfile';

const fakeContext = {
  globalState: { get: vi.fn(), update: vi.fn() },
  subscriptions: [],
} as any;

const baseProfile = {
  id: 'profile-1',
  name: 'Test Gateway',
  baseUrl: 'https://gw.example.com/v1',
  dialect: 'openai.chat_completions',
  profileType: 'aidome',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('activateProfileAndReapplyMappings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reapplies only automated steps for mapped assistants before setting active', async () => {
    mockGetProfiles.mockResolvedValue([baseProfile]);
    mockGetAssistantMappings.mockResolvedValue([{ assistantKey: 'cline' }]);
    mockBuildPlan.mockResolvedValue({
      id: 'plan-1',
      profileId: 'profile-1',
      assistantKeys: ['cline'],
      steps: [
        { id: 's1', action: 'set-vscode-setting', assistantKey: 'cline', targetPath: 'x', newValue: 'y', data: {}, reversible: true, description: 'set' },
        { id: 's2', action: 'show-guided-steps', assistantKey: 'cline', data: {}, reversible: false, description: 'guide' },
      ],
      createdAt: new Date().toISOString(),
      status: 'pending',
    });
    mockApplyPlan.mockResolvedValue({
      success: true,
      appliedSteps: [{ id: 's1' }],
      failedSteps: [],
      changeLogEntry: {},
      assistantResults: new Map([['cline', { success: true }]]),
    });

    const result = await activateProfileAndReapplyMappings(fakeContext, 'profile-1');

    expect(result.status).toBe('success');
    expect(result.appliedAssistantKeys).toEqual(['cline']);
    expect(mockSetActiveProfile).toHaveBeenCalledWith('profile-1');
    expect(mockUpdateStatusBar).toHaveBeenCalledWith('Test Gateway');
  });

  it('sets the active profile without applying when no assistants are mapped', async () => {
    mockGetProfiles.mockResolvedValue([baseProfile]);
    mockGetAssistantMappings.mockResolvedValue([]);

    const result = await activateProfileAndReapplyMappings(fakeContext, 'profile-1');

    expect(result.status).toBe('active-only');
    expect(mockSetActiveProfile).toHaveBeenCalledWith('profile-1');
    expect(mockBuildPlan).not.toHaveBeenCalled();
  });

  it('marks guided-only assistants as skipped and still switches the active profile', async () => {
    mockGetProfiles.mockResolvedValue([baseProfile]);
    mockGetAssistantMappings.mockResolvedValue([{ assistantKey: 'claude-code' }]);
    mockBuildPlan.mockResolvedValue({
      id: 'plan-2',
      profileId: 'profile-1',
      assistantKeys: ['claude-code'],
      steps: [
        { id: 's1', action: 'show-guided-steps', assistantKey: 'claude-code', data: {}, reversible: false, description: 'guide' },
      ],
      createdAt: new Date().toISOString(),
      status: 'pending',
    });

    const result = await activateProfileAndReapplyMappings(fakeContext, 'profile-1');

    expect(result.status).toBe('active-only');
    expect(result.skippedAssistantKeys).toEqual(['claude-code']);
    expect(mockSetActiveProfile).toHaveBeenCalledWith('profile-1');
  });

  it('returns failed when profileId is not found', async () => {
    mockGetProfiles.mockResolvedValue([baseProfile]);

    const result = await activateProfileAndReapplyMappings(fakeContext, 'nonexistent-id');

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('nonexistent-id');
    expect(mockSetActiveProfile).not.toHaveBeenCalled();
  });

  it('returns failed when buildPlan throws', async () => {
    mockGetProfiles.mockResolvedValue([baseProfile]);
    mockGetAssistantMappings.mockResolvedValue([{ assistantKey: 'cline' }]);
    mockBuildPlan.mockRejectedValue(new Error('Registry load failed'));

    const result = await activateProfileAndReapplyMappings(fakeContext, 'profile-1');

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Registry load failed');
    expect(mockSetActiveProfile).not.toHaveBeenCalled();
  });

  it('returns partial when some assistants fail', async () => {
    mockGetProfiles.mockResolvedValue([baseProfile]);
    mockGetAssistantMappings.mockResolvedValue([
      { assistantKey: 'cline' },
      { assistantKey: 'continue' },
    ]);
    mockBuildPlan.mockResolvedValue({
      id: 'plan-3',
      profileId: 'profile-1',
      assistantKeys: ['cline', 'continue'],
      steps: [
        { id: 's1', action: 'set-vscode-setting', assistantKey: 'cline', targetPath: 'x', newValue: 'y', data: {}, reversible: true, description: 'set' },
        { id: 's2', action: 'set-vscode-setting', assistantKey: 'continue', targetPath: 'z', newValue: 'w', data: {}, reversible: true, description: 'set' },
      ],
      createdAt: new Date().toISOString(),
      status: 'pending',
    });
    mockApplyPlan.mockResolvedValue({
      success: false,
      appliedSteps: [{ id: 's1' }],
      failedSteps: [{ id: 's2' }],
      changeLogEntry: {},
      assistantResults: new Map([
        ['cline', { success: true }],
        ['continue', { success: false }],
      ]),
    });

    const result = await activateProfileAndReapplyMappings(fakeContext, 'profile-1');

    expect(result.status).toBe('partial');
    expect(result.appliedAssistantKeys).toEqual(['cline']);
    expect(result.failedAssistantKeys).toEqual(['continue']);
    expect(mockSetActiveProfile).toHaveBeenCalledWith('profile-1');
  });
});

describe('getProfileActivationNotice', () => {
  it('returns success for full activation', () => {
    const notice = getProfileActivationNotice({
      status: 'success',
      profile: baseProfile as any,
      mappedAssistantKeys: ['cline'],
      appliedAssistantKeys: ['cline'],
      failedAssistantKeys: [],
      skippedAssistantKeys: [],
    });
    expect(notice.kind).toBe('success');
    expect(notice.message).toContain('Test Gateway');
  });

  it('returns error for failed activation', () => {
    const notice = getProfileActivationNotice({
      status: 'failed',
      profile: baseProfile as any,
      mappedAssistantKeys: [],
      appliedAssistantKeys: [],
      failedAssistantKeys: [],
      skippedAssistantKeys: [],
      errorMessage: 'Profile not found.',
    });
    expect(notice.kind).toBe('error');
    expect(notice.message).toBe('Profile not found.');
  });

  it('returns warning for partial activation', () => {
    const notice = getProfileActivationNotice({
      status: 'partial',
      profile: baseProfile as any,
      mappedAssistantKeys: ['cline', 'claude-code'],
      appliedAssistantKeys: ['cline'],
      failedAssistantKeys: ['claude-code'],
      skippedAssistantKeys: [],
    });
    expect(notice.kind).toBe('warning');
    expect(notice.message).toContain('1 failed');
  });
});
