import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointProfile } from '../../src/core/profiles/profileTypes';

const {
  registeredCommands,
  mockRegisterCommand,
  mockRegisterTreeDataProvider,
  mockShowQuickPick,
  mockShowInformationMessage,
  mockShowWarningMessage,
  mockShowErrorMessage,
  mockExecuteCommand,
  mockInitializeExtensionCaching,
  mockWithErrorBoundary,
  mockHandleBoundaryOutcome,
  mockSetupSwitchboard,
  mockVerifyRouting,
  mockShowModelsProviders,
  mockManageProfiles,
  mockAssignProfileAssistants,
  mockResetSwitchboard,
  mockExportDiagnostics,
  mockActivateProfileAndReapplyMappings,
  mockGetProfileActivationNotice,
  mockGetActiveProfile,
  mockGetProfiles,
  mockCreateStatusBarItem,
  mockSetConfigured,
  mockSetNotConfigured,
  mockTreeRefresh,
  mockTreeDispose,
  mockLoggerInfo,
  mockLoggerError,
} = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  return {
    registeredCommands: handlers,
    mockRegisterCommand: vi.fn((command: string, handler: (...args: any[]) => unknown) => {
      handlers.set(command, handler);
      return { dispose: vi.fn() };
    }),
    mockRegisterTreeDataProvider: vi.fn(() => ({ dispose: vi.fn() })),
    mockShowQuickPick: vi.fn(),
    mockShowInformationMessage: vi.fn(),
    mockShowWarningMessage: vi.fn(),
    mockShowErrorMessage: vi.fn(),
    mockExecuteCommand: vi.fn(),
    mockInitializeExtensionCaching: vi.fn(),
    mockWithErrorBoundary: vi.fn(async (fn: () => unknown | Promise<unknown>) => {
      try {
        await fn();
        return { kind: 'success' };
      } catch (error) {
        return { kind: 'error', error };
      }
    }),
    mockHandleBoundaryOutcome: vi.fn(),
    mockSetupSwitchboard: vi.fn(),
    mockVerifyRouting: vi.fn(),
    mockShowModelsProviders: vi.fn(),
    mockManageProfiles: vi.fn(),
    mockAssignProfileAssistants: vi.fn(),
    mockResetSwitchboard: vi.fn(),
    mockExportDiagnostics: vi.fn(),
    mockActivateProfileAndReapplyMappings: vi.fn(),
    mockGetProfileActivationNotice: vi.fn(),
    mockGetActiveProfile: vi.fn(),
    mockGetProfiles: vi.fn(),
    mockCreateStatusBarItem: vi.fn(() => ({ dispose: vi.fn(), show: vi.fn(), hide: vi.fn() })),
    mockSetConfigured: vi.fn(),
    mockSetNotConfigured: vi.fn(),
    mockTreeRefresh: vi.fn(),
    mockTreeDispose: vi.fn(),
    mockLoggerInfo: vi.fn(),
    mockLoggerError: vi.fn(),
  };
});

vi.mock('vscode', () => ({
  window: {
    registerTreeDataProvider: mockRegisterTreeDataProvider,
    showQuickPick: mockShowQuickPick,
    showInformationMessage: mockShowInformationMessage,
    showWarningMessage: mockShowWarningMessage,
    showErrorMessage: mockShowErrorMessage,
  },
  commands: {
    registerCommand: mockRegisterCommand,
    executeCommand: mockExecuteCommand,
  },
  Disposable: class {
    dispose: () => void;

    constructor(dispose: () => void) {
      this.dispose = dispose;
    }
  },
  QuickPickItemKind: { Default: 0, Separator: -1 },
}));

vi.mock('../../src/commands/setupSwitchboard', () => ({
  setupSwitchboard: mockSetupSwitchboard,
}));

vi.mock('../../src/commands/verifyRouting', () => ({
  verifyRouting: mockVerifyRouting,
}));

vi.mock('../../src/commands/showModelsProviders', () => ({
  showModelsProviders: mockShowModelsProviders,
}));

vi.mock('../../src/commands/manageProfiles', () => ({
  manageProfiles: mockManageProfiles,
}));

vi.mock('../../src/commands/assignProfileAssistants', () => ({
  assignProfileAssistants: mockAssignProfileAssistants,
}));

vi.mock('../../src/commands/resetSwitchboard', () => ({
  resetSwitchboard: mockResetSwitchboard,
}));

vi.mock('../../src/commands/exportDiagnostics', () => ({
  exportDiagnostics: mockExportDiagnostics,
}));

vi.mock('../../src/ui/output', () => ({
  getOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() })),
}));

vi.mock('../../src/ui/statusBar', () => ({
  createStatusBarItem: mockCreateStatusBarItem,
  StatusBarManager: vi.fn().mockImplementation(class {
    setConfigured = mockSetConfigured;
    setNotConfigured = mockSetNotConfigured;
  }),
}));

vi.mock('../../src/core/profiles/profileStore', () => ({
  ProfileStore: vi.fn().mockImplementation(class {
    getActiveProfile = mockGetActiveProfile;
    getProfiles = mockGetProfiles;
  }),
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    initialize: vi.fn(),
    getInstance: () => ({
      info: mockLoggerInfo,
      warning: vi.fn(),
      error: mockLoggerError,
    }),
  },
}));

vi.mock('../../src/core/detection/detectExtensions', () => ({
  initializeExtensionCaching: mockInitializeExtensionCaching,
}));

vi.mock('../../src/util/errors', () => ({
  withErrorBoundary: mockWithErrorBoundary,
}));

vi.mock('../../src/ui/notifications', () => ({
  handleBoundaryOutcome: mockHandleBoundaryOutcome,
}));

vi.mock('../../src/commands/activateProfile', () => ({
  activateProfileAndReapplyMappings: mockActivateProfileAndReapplyMappings,
  getProfileActivationNotice: mockGetProfileActivationNotice,
}));

vi.mock('../../src/ui/assistantsTreeView', () => ({
  AssistantsTreeProvider: vi.fn().mockImplementation(class {
    refresh = mockTreeRefresh;
    dispose = mockTreeDispose;
  }),
}));

import { activate } from '../../src/extension';

function makeContext(initialState: Record<string, unknown> = {}) {
  const state = new Map<string, unknown>(Object.entries(initialState));
  return {
    subscriptions: [] as Array<{ dispose?: () => void }>,
    globalState: {
      get: vi.fn((key: string) => state.get(key)),
      update: vi.fn(async (key: string, value: unknown) => {
        state.set(key, value);
      }),
    },
  } as any;
}

describe('extension activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registeredCommands.clear();
    vi.useFakeTimers();
    mockGetActiveProfile.mockResolvedValue(undefined);
    mockGetProfiles.mockResolvedValue([]);
    mockShowQuickPick.mockResolvedValue(undefined);
    mockShowInformationMessage.mockResolvedValue(undefined);
    mockActivateProfileAndReapplyMappings.mockResolvedValue({});
    mockGetProfileActivationNotice.mockReturnValue({ kind: 'success', message: 'Activated' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('migrates state, registers commands, and shows the first-run prompt when no profile is active', async () => {
    const context = makeContext();
    mockShowInformationMessage.mockResolvedValueOnce('Configure Now');

    await activate(context);
    await vi.runAllTimersAsync();

    expect(mockInitializeExtensionCaching).toHaveBeenCalledWith(context);
    expect(context.globalState.update).toHaveBeenCalledWith('aidome.switchboard.stateVersion', '1');
    expect(context.globalState.update).toHaveBeenCalledWith('aidome.switchboard.firstRunNotificationShown', true);
    expect(mockRegisterTreeDataProvider).toHaveBeenCalledWith('aidome-switchboard.assistantsView', expect.any(Object));
    expect([...registeredCommands.keys()]).toEqual(expect.arrayContaining([
      'aidome-switchboard.refreshAssistantsView',
      'aidome-switchboard.statusBarAction',
      'aidome-switchboard.assignProfileAssistants',
      'aidome-switchboard.activateProfile',
    ]));
    expect(mockSetNotConfigured).toHaveBeenCalled();
    expect(mockExecuteCommand).toHaveBeenCalledWith('aidome-switchboard.setupSwitchboard');
  });

  it('sets the configured status and skips the first-run prompt when an active profile exists', async () => {
    const profile: EndpointProfile = {
      id: 'profile-1',
      name: 'Production',
      baseUrl: 'https://gateway.example.com',
      dialect: 'openai.chat_completions',
      profileType: 'custom',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    };
    const context = makeContext({
      'aidome.switchboard.stateVersion': '1',
      'aidome.switchboard.firstRunNotificationShown': true,
    });
    mockGetActiveProfile.mockResolvedValue(profile);

    await activate(context);
    await vi.runAllTimersAsync();

    expect(context.globalState.update).not.toHaveBeenCalledWith('aidome.switchboard.stateVersion', '1');
    expect(mockSetConfigured).toHaveBeenCalledWith('Production');
    expect(mockShowInformationMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('AIdome endpoint not configured'),
      expect.anything(),
      expect.anything()
    );
  });

  it('refreshes the assistants tree when the refresh command is invoked', async () => {
    const context = makeContext({ 'aidome.switchboard.stateVersion': '1' });

    await activate(context);

    const handler = registeredCommands.get('aidome-switchboard.refreshAssistantsView');
    expect(handler).toBeTypeOf('function');

    await handler?.();

    expect(mockTreeRefresh).toHaveBeenCalledTimes(1);
  });

  it('dispatches the selected quick action from the status bar command', async () => {
    const context = makeContext({ 'aidome.switchboard.stateVersion': '1' });
    mockGetActiveProfile.mockResolvedValue({
      id: 'profile-1',
      name: 'Production',
      baseUrl: 'https://gateway.example.com',
      dialect: 'openai.chat_completions',
      profileType: 'custom',
    });
    mockShowQuickPick.mockResolvedValueOnce({ label: 'Assign', value: 'assign' });

    await activate(context);

    const handler = registeredCommands.get('aidome-switchboard.statusBarAction');
    await handler?.();

    expect(mockExecuteCommand).toHaveBeenCalledWith('aidome-switchboard.assignProfileAssistants');
  });

  it('rejects non-string profile ids for the assign assistants command', async () => {
    const context = makeContext({ 'aidome.switchboard.stateVersion': '1' });

    await activate(context);

    const handler = registeredCommands.get('aidome-switchboard.assignProfileAssistants');
    await handler?.({ profileId: 'bad' });

    expect(mockShowErrorMessage).toHaveBeenCalledWith('assignProfileAssistants expects a string profileId.');
    expect(mockAssignProfileAssistants).not.toHaveBeenCalled();
  });

  it('routes valid assign assistants arguments through the error boundary handler', async () => {
    const context = makeContext({ 'aidome.switchboard.stateVersion': '1' });

    await activate(context);

    const handler = registeredCommands.get('aidome-switchboard.assignProfileAssistants');
    await handler?.('profile-1');

    expect(mockAssignProfileAssistants).toHaveBeenCalledWith(context, 'profile-1');
    expect(mockHandleBoundaryOutcome).toHaveBeenCalledWith({ kind: 'success' }, expect.anything(), 'Assign profile assistants');
  });

  it('warns when activating a profile with no saved profiles', async () => {
    const context = makeContext({ 'aidome.switchboard.stateVersion': '1' });
    mockGetProfiles.mockResolvedValue([]);

    await activate(context);

    const handler = registeredCommands.get('aidome-switchboard.activateProfile');
    await handler?.();

    expect(mockShowWarningMessage).toHaveBeenCalledWith(
      'No profiles exist yet. Run setup or Manage Profiles first.'
    );
  });

  it('offers Assign Assistants after activating an unmapped profile', async () => {
    const context = makeContext({ 'aidome.switchboard.stateVersion': '1' });
    mockGetActiveProfile.mockResolvedValue({
      id: 'profile-1',
      name: 'Production',
      baseUrl: 'https://gateway.example.com',
      dialect: 'openai.chat_completions',
      profileType: 'custom',
    });
    mockActivateProfileAndReapplyMappings.mockResolvedValue({
      status: 'active-only',
      mappedAssistantKeys: [],
      skippedAssistantKeys: [],
      appliedAssistantKeys: [],
      failedAssistantKeys: [],
      profile: {
        id: 'profile-1',
        name: 'Production',
        baseUrl: 'https://gateway.example.com',
        dialect: 'openai.chat_completions',
        profileType: 'custom',
      },
    });
    mockGetProfileActivationNotice.mockReturnValue({
      kind: 'success',
      message: 'Profile activated but no assistants are assigned.',
    });
    mockShowInformationMessage.mockResolvedValueOnce('Assign Assistants');

    await activate(context);

    const handler = registeredCommands.get('aidome-switchboard.activateProfile');
    await handler?.('profile-1');

    expect(mockActivateProfileAndReapplyMappings).toHaveBeenCalledWith(context, 'profile-1');
    expect(mockExecuteCommand).toHaveBeenCalledWith('aidome-switchboard.assignProfileAssistants', 'profile-1');
  });

  it('shows the activation success message directly when assistants are already mapped', async () => {
    const context = makeContext({ 'aidome.switchboard.stateVersion': '1' });
    mockGetActiveProfile.mockResolvedValue({
      id: 'profile-1',
      name: 'Production',
      baseUrl: 'https://gateway.example.com',
      dialect: 'openai.chat_completions',
      profileType: 'custom',
    });
    mockActivateProfileAndReapplyMappings.mockResolvedValue({
      status: 'success',
      mappedAssistantKeys: ['cline'],
      skippedAssistantKeys: [],
      appliedAssistantKeys: ['cline'],
      failedAssistantKeys: [],
      profile: {
        id: 'profile-1',
        name: 'Production',
        baseUrl: 'https://gateway.example.com',
        dialect: 'openai.chat_completions',
        profileType: 'custom',
      },
    });
    mockGetProfileActivationNotice.mockReturnValue({
      kind: 'success',
      message: 'Profile activated successfully.',
    });

    await activate(context);

    const handler = registeredCommands.get('aidome-switchboard.activateProfile');
    await handler?.('profile-1');

    expect(mockShowInformationMessage).toHaveBeenCalledWith('Profile activated successfully.');
    expect(mockExecuteCommand).not.toHaveBeenCalledWith('aidome-switchboard.assignProfileAssistants', 'profile-1');
  });

  it('disposes the assistants tree provider when extension subscriptions are disposed', async () => {
    const context = makeContext({ 'aidome.switchboard.stateVersion': '1' });

    await activate(context);

    for (const subscription of context.subscriptions) {
      subscription.dispose?.();
    }

    expect(mockTreeDispose).toHaveBeenCalled();
  });
});