/**
 * Unit tests for setupSwitchboard command handler.
 * Covers assistant selection QuickPick behaviour, Tier C filtering,
 * and cancellation reason logging.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EndpointProfile } from '../../src/core/profiles/profileTypes';

/** Shape of a QuickPick item as returned by the mock. */
interface QuickPickItem {
  label: string;
  picked?: boolean;
  assistantKey?: string;
  detail?: string;
}

// ---------- hoisted mock variables ----------
const {
  mockShowQuickPick,
  mockShowInputBox,
  mockShowInformationMessage,
  mockExecuteCommand,
  mockLoggerInfo,
  mockLoggerWarning,
  mockLoggerError,
  mockShowWarning,
  mockWithProgress,
  mockShowSuccess,
  mockShowError,
  mockDetectAll,
  mockBuildPlan,
  mockApplyPlan,
  mockGetProfiles,
  mockSetActiveProfile,
} = vi.hoisted(() => ({
  mockShowQuickPick: vi.fn(),
  mockShowInputBox: vi.fn(),
  mockShowInformationMessage: vi.fn(),
  mockExecuteCommand: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarning: vi.fn(),
  mockLoggerError: vi.fn(),
  mockShowWarning: vi.fn(),
  mockWithProgress: vi.fn(),
  mockShowSuccess: vi.fn(),
  mockShowError: vi.fn(),
  mockDetectAll: vi.fn(),
  mockBuildPlan: vi.fn(),
  mockApplyPlan: vi.fn(),
  mockGetProfiles: vi.fn(async (): Promise<EndpointProfile[]> => []),
  mockSetActiveProfile: vi.fn(),
}));

// ---------- vscode mock ----------
vi.mock('vscode', () => ({
  window: {
    showQuickPick: mockShowQuickPick,
    showInputBox: mockShowInputBox,
    showWarningMessage: vi.fn(),
    showInformationMessage: mockShowInformationMessage,
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
    withProgress: vi.fn(),
  },
  ProgressLocation: { Notification: 15 },
  extensions: {
    all: [],
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
  },
  commands: {
    executeCommand: mockExecuteCommand,
  },
  ExtensionContext: vi.fn(),
  SecretStorage: vi.fn(),
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      info: mockLoggerInfo,
      warning: mockLoggerWarning,
      error: mockLoggerError,
    }),
  },
}));

vi.mock('../../src/ui/notifications', () => ({
  showWarning: mockShowWarning,
  showError: mockShowError,
  showSuccess: mockShowSuccess,
  withProgress: mockWithProgress,
}));

vi.mock('../../src/ui/statusBar', () => ({ updateStatusBar: vi.fn() }));
vi.mock('../../src/ui/output', () => ({ showPlan: vi.fn() }));
vi.mock('../../src/ui/wizard/renderResults', () => ({
  renderDetectionSummary: vi.fn(() => '🔍 Detection Summary'),
  renderPlanSummary: vi.fn(() => 'Plan summary'),
}));

vi.mock('../../src/core/orchestration/switchboard', () => ({
  Switchboard: vi.fn(function (this: Record<string, unknown>) {
    this.detectAll = mockDetectAll;
    this.buildPlan = mockBuildPlan;
    this.applyPlan = mockApplyPlan;
  }),
}));

vi.mock('../../src/core/registry/registryLoader', () => ({
  loadRegistry: vi.fn(async () => ({
    assistants: [
      { key: 'cline', displayName: 'Cline', endpointSwitching: { tier: 'A' } },
      { key: 'kilocode', displayName: 'Kilo Code', endpointSwitching: { tier: 'A' } },
    ],
    dialectCatalog: {},
  })),
  getAssistantsByTier: vi.fn((registry: { assistants: Array<{ key: string; displayName: string; endpointSwitching: { tier: string } }> }, tier: string) =>
    registry.assistants.filter(a => a.endpointSwitching.tier === tier)
  ),
}));

vi.mock('../../src/core/profiles/profileStore', () => ({
  ProfileStore: vi.fn(function (this: Record<string, unknown>) {
    this.getProfiles = mockGetProfiles;
    this.saveProfile = vi.fn();
    this.getAssistantMappings = vi.fn(async () => []);
    this.setActiveProfile = mockSetActiveProfile;
    this.saveAssistantMapping = vi.fn();
  }),
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn(function (this: Record<string, unknown>) {
    this.storeSecret = vi.fn();
    this.getSecret = vi.fn();
  }),
}));

import { setupSwitchboard } from '../../src/commands/setupSwitchboard';

// ---------- helpers ----------
function makeContext() {
  return {
    globalState: { get: vi.fn(), update: vi.fn() },
    subscriptions: [],
  } as any;
}

function makeAssistant(key: string, tier: 'A' | 'B' | 'C', displayName: string) {
  return {
    assistantKey: key,
    displayName,
    tier,
    version: '1.0.0',
    isActive: true,
    extensionId: key,
    kind: 'extension',
  };
}

const progressCallback = async (_title: string, fn: () => Promise<unknown>) => fn();

// ---------- tests ----------
describe('setupSwitchboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithProgress.mockImplementation(progressCallback);
    mockGetProfiles.mockResolvedValue([]);
    mockSetActiveProfile.mockResolvedValue(undefined);
    mockShowInformationMessage.mockResolvedValue(undefined);
    mockShowSuccess.mockResolvedValue(undefined);
  });

  it('shows a warning and returns early when only Tier C assistants are detected', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('github.copilot', 'C', 'GitHub Copilot')],
      clis: [],
    });

    await setupSwitchboard(makeContext());

    expect(mockShowWarning).toHaveBeenCalledWith(
      expect.stringContaining('GitHub Copilot')
    );
    expect(mockShowWarning).toHaveBeenCalledWith(
      expect.stringContaining('Tier A assistant')
    );
    expect(mockShowQuickPick).not.toHaveBeenCalled();
  });

  it('logs only non-switchable names when only Tier C are detected', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [
        makeAssistant('github.copilot', 'C', 'GitHub Copilot'),
        makeAssistant('tabnine', 'C', 'Tabnine'),
      ],
      clis: [],
    });

    await setupSwitchboard(makeContext());

    expect(mockLoggerWarning).toHaveBeenCalledWith(
      expect.stringContaining('GitHub Copilot')
    );
    expect(mockLoggerWarning).toHaveBeenCalledWith(
      expect.stringContaining('Tabnine')
    );
  });

  it('offers only switchable (non-Tier-C) assistants in the QuickPick', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [
        makeAssistant('github.copilot', 'C', 'GitHub Copilot'),
        makeAssistant('kilocode', 'A', 'Kilo Code'),
      ],
      clis: [],
    });
    mockShowQuickPick.mockResolvedValueOnce(undefined);

    await setupSwitchboard(makeContext());

    const [items] = mockShowQuickPick.mock.calls[0] as [QuickPickItem[], unknown];
    const labels = items.map(i => i.label);
    const assistantKeys = items.map(i => i.assistantKey);
    expect(labels).toContain('Kilo Code');
    expect(assistantKeys).toContain('kilocode');
    expect(assistantKeys).not.toContain('github.copilot');
  });

  it('logs "user dismissed" when user closes the assistant QuickPick', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('kilocode', 'A', 'Kilo Code')],
      clis: [],
    });
    mockShowQuickPick.mockResolvedValueOnce(undefined);

    await setupSwitchboard(makeContext());

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'Setup cancelled - user dismissed assistant selection'
    );
  });

  it('logs "user unchecked all" when user deselects every assistant', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('kilocode', 'A', 'Kilo Code')],
      clis: [],
    });
    mockShowQuickPick.mockResolvedValueOnce([]);

    await setupSwitchboard(makeContext());

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'Setup cancelled - user unchecked all assistants'
    );
  });

  it('shows QuickPick with ignoreFocusOut and step title', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('kilocode', 'A', 'Kilo Code')],
      clis: [],
    });
    mockShowQuickPick.mockResolvedValueOnce(undefined);

    await setupSwitchboard(makeContext());

    const [, options] = mockShowQuickPick.mock.calls[0] as [unknown, { ignoreFocusOut: boolean; title: string }];
    expect(options.ignoreFocusOut).toBe(true);
    expect(options.title).toContain('Step 2/5');
  });

  it('includes CLI tool keys in the QuickPick offer', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('kilocode', 'A', 'Kilo Code')],
      clis: [{ assistantKey: 'codex-cli', command: 'codex', version: '1.0.0' }],
    });
    mockShowQuickPick.mockResolvedValueOnce(undefined);

    await setupSwitchboard(makeContext());

    const [items] = mockShowQuickPick.mock.calls[0] as [QuickPickItem[], unknown];
    const labels = items.map(i => i.label);
    const keys = items.map(i => i.assistantKey);
    expect(labels).toContain('Kilo Code');
    expect(keys).toContain('kilocode');
    expect(keys).toContain('codex-cli');
  });

  it('deduplicates assistants detected as both extension and CLI', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('claude-code', 'A', 'Claude Code')],
      clis: [{ assistantKey: 'claude-code', command: 'claude', version: '1.0.0' }],
    });
    mockShowQuickPick.mockResolvedValueOnce(undefined);

    await setupSwitchboard(makeContext());

    const [items] = mockShowQuickPick.mock.calls[0] as [QuickPickItem[], unknown];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      assistantKey: 'claude-code',
      label: 'Claude Code (Extension + CLI)',
      detail: 'Detected as VS Code extension and CLI'
    });
  });

  it('falls back to the assistant key when registry metadata has no display name', async () => {
    const registryLoader = await import('../../src/core/registry/registryLoader');
    vi.mocked(registryLoader.loadRegistry).mockResolvedValueOnce({
      assistants: [
        { key: 'mystery-cli', displayName: '', endpointSwitching: { tier: 'A' } },
      ] as any,
      dialectCatalog: {},
    });
    mockDetectAll.mockResolvedValue({
      assistants: [],
      clis: [{ assistantKey: 'mystery-cli', command: 'mystery', version: '1.0.0' }],
    });
    mockShowQuickPick.mockResolvedValueOnce(undefined);

    await setupSwitchboard(makeContext());

    const [items] = mockShowQuickPick.mock.calls[0] as [QuickPickItem[], unknown];
    expect(items).toEqual([
      expect.objectContaining({
        assistantKey: 'mystery-cli',
        label: 'mystery-cli',
        detail: 'Detected as CLI'
      })
    ]);
  });

  it('falls back to the detected extension display name when registry metadata has no display name', async () => {
    const registryLoader = await import('../../src/core/registry/registryLoader');
    vi.mocked(registryLoader.loadRegistry).mockResolvedValueOnce({
      assistants: [
        { key: 'mystery-extension', displayName: '', endpointSwitching: { tier: 'A' } },
      ] as any,
      dialectCatalog: {},
    });
    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('mystery-extension', 'A', 'Mystery Extension')],
      clis: [],
    });
    mockShowQuickPick.mockResolvedValueOnce(undefined);

    await setupSwitchboard(makeContext());

    const [items] = mockShowQuickPick.mock.calls[0] as [QuickPickItem[], unknown];
    expect(items).toEqual([
      expect.objectContaining({
        assistantKey: 'mystery-extension',
        label: 'Mystery Extension',
        detail: 'Detected as VS Code extension'
      })
    ]);
  });

  it('logs the offered assistant keys before showing QuickPick', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('cline', 'A', 'Cline')],
      clis: [],
    });
    mockShowQuickPick.mockResolvedValueOnce(undefined);

    await setupSwitchboard(makeContext());

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining('Offering 1 assistant(s) for selection: cline')
    );
  });

  it('shows a warning when no assistants are detected at all', async () => {
    mockDetectAll.mockResolvedValue({ assistants: [], clis: [] });

    await setupSwitchboard(makeContext());

    expect(mockShowWarning).toHaveBeenCalledWith(
      expect.stringContaining('No supported AI assistants detected')
    );
    expect(mockShowQuickPick).not.toHaveBeenCalled();
  });

  it('logs and exits when detected assistants are switchable but none survive registry filtering', async () => {
    const registryLoader = await import('../../src/core/registry/registryLoader');
    vi.mocked(registryLoader.loadRegistry).mockResolvedValueOnce({
      assistants: [
        { key: 'github.copilot', displayName: 'GitHub Copilot', endpointSwitching: { tier: 'C' } },
      ] as any,
      dialectCatalog: {},
    });
    mockDetectAll.mockResolvedValue({
      assistants: [],
      clis: [{ assistantKey: 'github.copilot', command: 'copilot', version: '1.0.0' }],
    });

    await setupSwitchboard(makeContext());

    expect(mockLoggerWarning).toHaveBeenCalledWith(
      'No switchable assistants to offer in selection QuickPick'
    );
    expect(mockShowQuickPick).not.toHaveBeenCalled();
  });

  it('proceeds to profile selection when user picks assistants', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('kilocode', 'A', 'Kilo Code')],
      clis: [],
    });
    mockShowQuickPick.mockResolvedValueOnce([{ label: 'Kilo Code', assistantKey: 'kilocode', picked: true }]);
    mockShowQuickPick.mockResolvedValueOnce(undefined);

    await setupSwitchboard(makeContext());

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'Setup cancelled - no profile selected'
    );
  });

  it('uses singular grammar when only one Tier C assistant detected', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('github.copilot', 'C', 'GitHub Copilot')],
      clis: [],
    });

    await setupSwitchboard(makeContext());

    expect(mockShowWarning).toHaveBeenCalledWith(
      expect.stringContaining('it does not support')
    );
  });

  it('uses plural grammar when multiple Tier C assistants detected', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [
        makeAssistant('github.copilot', 'C', 'GitHub Copilot'),
        makeAssistant('tabnine', 'C', 'Tabnine'),
      ],
      clis: [],
    });

    await setupSwitchboard(makeContext());

    expect(mockShowWarning).toHaveBeenCalledWith(
      expect.stringContaining('they do not support')
    );
  });

  it('shows userMessage (not technical message) when ConfigurationError is thrown', async () => {
    const { ConfigurationError } = await import('../../src/util/errors');
    mockDetectAll.mockRejectedValue(
      new ConfigurationError('technical detail hidden from user', 'Endpoint is misconfigured. Please re-run setup.', 'kilocode')
    );

    await setupSwitchboard(makeContext());

    // Should show the userMessage, not the technical message
    expect(mockShowError).toHaveBeenCalledWith(
      'Endpoint is misconfigured. Please re-run setup.'
    );
    expect(mockShowError).not.toHaveBeenCalledWith(
      expect.stringContaining('technical detail hidden from user')
    );
  });

  it('logs ConfigurationError at warning level (not error)', async () => {
    const { ConfigurationError } = await import('../../src/util/errors');
    mockDetectAll.mockRejectedValue(
      new ConfigurationError('internal', 'User message', 'kilocode')
    );

    await setupSwitchboard(makeContext());

    expect(mockLoggerWarning).toHaveBeenCalled();
    expect(mockLoggerError).not.toHaveBeenCalledWith(
      expect.stringContaining('Failed to setup'),
      expect.anything()
    );
  });

  it('runs Verify when the setup success notification action is selected', async () => {
    const profile = {
      id: 'profile-1',
      name: 'Production',
      baseUrl: 'https://gateway.example.com',
      apiPath: '/v1/chat/completions',
      apiKeySource: 'user',
      dialect: 'openai.chat_completions',
      profileType: 'custom',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z'
    } satisfies EndpointProfile;

    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('kilocode', 'A', 'Kilo Code')],
      clis: [],
    });
    mockGetProfiles.mockResolvedValue([profile]);
    mockShowQuickPick
      .mockResolvedValueOnce([{ label: 'Kilo Code', assistantKey: 'kilocode', picked: true }])
      .mockResolvedValueOnce({ label: profile.name, profile });
    mockBuildPlan.mockResolvedValue({
      profileId: profile.id,
      assistantKeys: ['kilocode'],
      steps: [{ id: 'step-1', assistantKey: 'kilocode', action: 'edit-config-file' }]
    });
    mockShowInformationMessage.mockResolvedValue('Apply');
    mockApplyPlan.mockResolvedValue({
      success: true,
      appliedSteps: [{ id: 'step-1', assistantKey: 'kilocode', action: 'edit-config-file' }],
      assistantResults: new Map([['kilocode', { success: true }]])
    });
    mockShowSuccess.mockResolvedValue('Verify');

    await setupSwitchboard(makeContext());

    expect(mockExecuteCommand).toHaveBeenCalledWith('aidome-switchboard.verifyRouting');
  });

  it('refreshes the assistants view when setup succeeds', async () => {
    const profile = {
      id: 'profile-2',
      name: 'Staging',
      baseUrl: 'https://staging.example.com',
      dialect: 'openai.chat_completions',
      profileType: 'custom',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z'
    } satisfies EndpointProfile;

    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('kilocode', 'A', 'Kilo Code')],
      clis: [],
    });
    mockGetProfiles.mockResolvedValue([profile]);
    mockShowQuickPick
      .mockResolvedValueOnce([{ label: 'Kilo Code', assistantKey: 'kilocode', picked: true }])
      .mockResolvedValueOnce({ label: profile.name, profile });
    mockBuildPlan.mockResolvedValue({
      profileId: profile.id,
      assistantKeys: ['kilocode'],
      steps: [{ id: 'step-1', assistantKey: 'kilocode', action: 'edit-config-file' }]
    });
    mockShowInformationMessage.mockResolvedValue('Apply');
    mockApplyPlan.mockResolvedValue({
      success: true,
      appliedSteps: [{ id: 'step-1', assistantKey: 'kilocode', action: 'edit-config-file' }],
      assistantResults: new Map([['kilocode', { success: true }]])
    });

    await setupSwitchboard(makeContext());

    expect(mockSetActiveProfile).toHaveBeenCalledWith(profile.id);
    expect(mockExecuteCommand).toHaveBeenCalledWith('aidome-switchboard.refreshAssistantsView');
  });

  it('refreshes the assistants view when setup partially succeeds', async () => {
    const profile = {
      id: 'profile-3',
      name: 'Partial',
      baseUrl: 'https://partial.example.com',
      dialect: 'openai.chat_completions',
      profileType: 'custom',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z'
    } satisfies EndpointProfile;

    mockDetectAll.mockResolvedValue({
      assistants: [
        makeAssistant('kilocode', 'A', 'Kilo Code'),
        makeAssistant('cline', 'A', 'Cline')
      ],
      clis: [],
    });
    mockGetProfiles.mockResolvedValue([profile]);
    mockShowQuickPick
      .mockResolvedValueOnce([
        { label: 'Kilo Code', assistantKey: 'kilocode', picked: true },
        { label: 'Cline', assistantKey: 'cline', picked: true }
      ])
      .mockResolvedValueOnce({ label: profile.name, profile });
    mockBuildPlan.mockResolvedValue({
      profileId: profile.id,
      assistantKeys: ['kilocode', 'cline'],
      steps: [
        { id: 'step-1', assistantKey: 'kilocode', action: 'edit-config-file' },
        { id: 'step-2', assistantKey: 'cline', action: 'set-vscode-setting' }
      ]
    });
    mockShowInformationMessage.mockResolvedValue('Apply');
    mockApplyPlan.mockResolvedValue({
      success: false,
      appliedSteps: [{ id: 'step-1', assistantKey: 'kilocode', action: 'edit-config-file' }],
      failedSteps: [{ id: 'step-2', assistantKey: 'cline', action: 'set-vscode-setting', error: 'settings failed' }],
      assistantResults: new Map([
        ['kilocode', { success: true }],
        ['cline', { success: false, reason: 'settings failed' }]
      ])
    });

    await setupSwitchboard(makeContext());

    expect(mockSetActiveProfile).toHaveBeenCalledWith(profile.id);
    expect(mockExecuteCommand).toHaveBeenCalledWith('aidome-switchboard.refreshAssistantsView');
    expect(mockShowError).toHaveBeenCalledWith(
      'Partial setup: 1 assistant(s) configured (kilocode). 1 failed: cline (settings failed). Check the output channel for details.',
      'View Output'
    );
  });
});
