import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getExtension: vi.fn(),
  showWarningMessage: vi.fn(),
  executeCommand: vi.fn()
}));

vi.mock('vscode', () => ({
  extensions: { getExtension: mocks.getExtension },
  window: { showWarningMessage: mocks.showWarningMessage },
  commands: { executeCommand: mocks.executeCommand }
}));

import {
  promptReloadForExtensionIds,
  RELOAD_WINDOW_ACTION
} from '../../src/util/assistantReload';

describe('promptReloadForExtensionIds', () => {
  beforeEach(() => {
    mocks.getExtension.mockReset();
    mocks.showWarningMessage.mockReset();
    mocks.executeCommand.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function activeExtension(id: string) {
    return { id, isActive: true, packageJSON: { displayName: 'Cline' } };
  }

  it('prompts and reloads when the extension is active and confirmed', async () => {
    mocks.getExtension.mockReturnValue(activeExtension('saoudrizwan.claude-dev'));
    mocks.showWarningMessage.mockResolvedValue(RELOAD_WINDOW_ACTION);

    await promptReloadForExtensionIds(['saoudrizwan.claude-dev']);

    expect(mocks.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(mocks.showWarningMessage.mock.calls[0][1]).toBe(RELOAD_WINDOW_ACTION);
    expect(mocks.executeCommand).toHaveBeenCalledWith('workbench.action.reloadWindow');
  });

  it('does not reload when the user declines', async () => {
    mocks.getExtension.mockReturnValue(activeExtension('saoudrizwan.claude-dev'));
    mocks.showWarningMessage.mockResolvedValue(undefined);

    await promptReloadForExtensionIds(['saoudrizwan.claude-dev']);

    expect(mocks.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it('is a no-op when no listed extension is active', async () => {
    mocks.getExtension.mockReturnValue({ id: 'saoudrizwan.claude-dev', isActive: false });

    await promptReloadForExtensionIds(['saoudrizwan.claude-dev']);

    expect(mocks.showWarningMessage).not.toHaveBeenCalled();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it('is a no-op for an empty extension list', async () => {
    await promptReloadForExtensionIds([]);

    expect(mocks.getExtension).not.toHaveBeenCalled();
    expect(mocks.showWarningMessage).not.toHaveBeenCalled();
  });

  it('swallows host API failures so the prompt can never fail an apply', async () => {
    mocks.getExtension.mockImplementation(() => {
      throw new Error('host exploded');
    });

    await expect(promptReloadForExtensionIds(['saoudrizwan.claude-dev'])).resolves.toBeUndefined();
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it('mentions the extension display name in the prompt message', async () => {
    mocks.getExtension.mockReturnValue(activeExtension('saoudrizwan.claude-dev'));
    mocks.showWarningMessage.mockResolvedValue(undefined);

    await promptReloadForExtensionIds(['saoudrizwan.claude-dev']);

    expect(mocks.showWarningMessage.mock.calls[0][0]).toContain('Cline');
  });
});
