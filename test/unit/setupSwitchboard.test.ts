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
}

// ---------- hoisted mock variables ----------
const {
  mockShowQuickPick,
  mockShowInputBox,
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
} = vi.hoisted(() => ({
  mockShowQuickPick: vi.fn(),
  mockShowInputBox: vi.fn(),
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
}));

// ---------- vscode mock ----------
vi.mock('vscode', () => ({
  window: {
    showQuickPick: mockShowQuickPick,
    showInputBox: mockShowInputBox,
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
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
  Switchboard: vi.fn().mockImplementation(() => ({
    detectAll: mockDetectAll,
    buildPlan: mockBuildPlan,
    applyPlan: mockApplyPlan,
  })),
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
  ProfileStore: vi.fn().mockImplementation(() => ({
    getProfiles: mockGetProfiles,
    saveProfile: vi.fn(),
    getAssistantMappings: vi.fn(async () => []),
    setActiveProfile: vi.fn(),
    saveAssistantMapping: vi.fn(),
  })),
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn().mockImplementation(() => ({
    storeSecret: vi.fn(),
    getSecret: vi.fn(),
  })),
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
    expect(labels).toContain('kilocode');
    expect(labels).not.toContain('github.copilot');
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
    const keys = items.map(i => i.label);
    expect(keys).toContain('kilocode');
    expect(keys).toContain('codex-cli');
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

  it('proceeds to profile selection when user picks assistants', async () => {
    mockDetectAll.mockResolvedValue({
      assistants: [makeAssistant('kilocode', 'A', 'Kilo Code')],
      clis: [],
    });
    mockShowQuickPick.mockResolvedValueOnce([{ label: 'kilocode', picked: true }]);
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
});
