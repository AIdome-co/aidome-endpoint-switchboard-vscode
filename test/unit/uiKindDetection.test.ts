/**
 * Unit tests for src/core/detection/uiKindDetection.ts — UI-kind (client-side)
 * extension fallback detection and the remote.extensionKind self-heal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const vscodeState = {
  remoteName: 'ssh-remote' as string | undefined,
  workspaceFolders: [{ uri: { fsPath: '/ws' }, name: 'ws', index: 0 }],
  inspected: { workspaceValue: { 'other.ext': ['ui'] } } as Record<string, unknown> | undefined,
  updates: [] as Array<{ section: string; key: string; value: unknown; target: string }>,
  messages: [] as unknown[],
};

vi.mock('vscode', () => {
  return {
    env: {
      get remoteName() {
        return vscodeState.remoteName;
      },
    },
    workspace: {
      get workspaceFolders() {
        return vscodeState.workspaceFolders;
      },
      getConfiguration: () => ({
        inspect: (key: string) =>
          key === 'extensionKind' ? vscodeState.inspected : undefined,
        update: (key: string, value: unknown, target: string) => {
          vscodeState.updates.push({ section: 'remote', key, value, target });
          return Promise.resolve();
        },
      }),
    },
    window: {
      showInformationMessage: vi.fn((...args: unknown[]) => {
        vscodeState.messages.push(args);
        return Promise.resolve(args[1]);
      }),
      showWarningMessage: vi.fn((...args: unknown[]) => {
        vscodeState.messages.push(args);
        return Promise.resolve(undefined);
      }),
    },
    commands: {
      executeCommand: vi.fn(() => Promise.resolve()),
    },
    ConfigurationTarget: { Workspace: 2, Global: 1 },
    ExtensionKind: { UI: 1, Workspace: 2 },
  };
});

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      scoped: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
      }),
    }),
  },
}));

import {
  findClientSideExtension,
  mergeExtensionKindOverride,
  applyWorkspaceExtensionKindOverride,
  offerUiKindSelfHeal,
} from '../../src/core/detection/uiKindDetection';

function makeExtensionDir(
  root: string,
  directoryName: string,
  manifest: Record<string, unknown>
): void {
  const dir = path.join(root, directoryName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
}

describe('mergeExtensionKindOverride', () => {
  it('adds the override without clobbering existing user entries', () => {
    const merged = mergeExtensionKindOverride({ 'other.ext': ['ui'] }, 'Continue.continue');
    expect(merged).toEqual({ 'other.ext': ['ui'], 'Continue.continue': ['workspace'] });
  });

  it('replaces an existing entry for the same ID only', () => {
    const merged = mergeExtensionKindOverride(
      { 'continue.continue': ['ui'], 'other.ext': ['workspace'] },
      'continue.continue'
    );
    expect(merged['continue.continue']).toEqual(['workspace']);
    expect(merged['other.ext']).toEqual(['workspace']);
  });

  it('handles a non-object existing value', () => {
    expect(mergeExtensionKindOverride(undefined, 'a.b')).toEqual({ 'a.b': ['workspace'] });
    expect(mergeExtensionKindOverride([['x', ['ui']]], 'a.b')).toEqual({ 'a.b': ['workspace'] });
  });
});

describe('findClientSideExtension', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-ext-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds an installed UI-preferring extension and parses its version', () => {
    makeExtensionDir(root, 'continue.continue-2.1.0', {
      publisher: 'Continue',
      name: 'continue',
      version: '2.1.0',
      extensionKind: ['ui', 'workspace'],
    });
    const found = findClientSideExtension('Continue.continue', [root]);
    expect(found?.extensionId).toBe('Continue.continue');
    expect(found?.version).toBe('2.1.0');
  });

  it('strips a platform-target suffix from the directory name', () => {
    makeExtensionDir(root, 'continue.continue-1.9.0-linux-x64', {
      publisher: 'Continue',
      name: 'continue',
      version: '1.9.0',
      extensionKind: ['ui', 'workspace'],
    });
    expect(findClientSideExtension('Continue.continue', [root])?.version).toBe('1.9.0');
  });

  it('ignores workspace-only manifests and mismatched IDs', () => {
    makeExtensionDir(root, 'kilocode.kilo-code-7.8.27-linux-x64', {
      publisher: 'kilocode',
      name: 'kilo-code',
      version: '7.8.27',
      extensionKind: ['workspace'],
    });
    makeExtensionDir(root, 'continue.continue-2.1.0', {
      publisher: 'SomeoneElse',
      name: 'continue',
      version: '2.1.0',
      extensionKind: ['ui'],
    });
    expect(findClientSideExtension('Continue.continue', [root])).toBeUndefined();
    expect(findClientSideExtension('kilocode.kilo-code', [root])).toBeUndefined();
  });

  it('returns undefined when the directory does not exist', () => {
    expect(findClientSideExtension('a.b', [path.join(root, 'missing')])).toBeUndefined();
  });
});

describe('applyWorkspaceExtensionKindOverride', () => {
  beforeEach(() => {
    vscodeState.updates.length = 0;
    vscodeState.inspected = { workspaceValue: { 'other.ext': ['ui'] } };
  });

  it('merges into the existing workspace map and targets the workspace', async () => {
    const applied = await applyWorkspaceExtensionKindOverride('Continue.continue');
    expect(applied).toBe(true);
    expect(vscodeState.updates).toHaveLength(1);
    expect(vscodeState.updates[0].target).toBe(2);
    expect(vscodeState.updates[0].value).toEqual({
      'other.ext': ['ui'],
      'Continue.continue': ['workspace'],
    });
  });

  it('starts from an empty map when no workspace value exists', async () => {
    vscodeState.inspected = undefined;
    await applyWorkspaceExtensionKindOverride('a.b');
    expect(vscodeState.updates[0].value).toEqual({ 'a.b': ['workspace'] });
  });

  it('fails closed when the configuration write throws (no workspace open)', async () => {
    const failing = await import('vscode') as unknown as {
      workspace: { getConfiguration: () => never };
    };
    const original = failing.workspace.getConfiguration;
    (failing.workspace as { getConfiguration: () => unknown }).getConfiguration = () => {
      throw new Error('no workspace');
    };
    try {
      const applied = await applyWorkspaceExtensionKindOverride('a.b');
      expect(applied).toBe(false);
    } finally {
      (failing.workspace as { getConfiguration: unknown }).getConfiguration = original;
    }
  });
});

describe('offerUiKindSelfHeal', () => {
  beforeEach(() => {
    vscodeState.updates.length = 0;
    vscodeState.messages.length = 0;
    vscodeState.remoteName = 'ssh-remote';
    vscodeState.inspected = { workspaceValue: {} };
  });

  it('is a no-op when not connected to a remote', async () => {
    vscodeState.remoteName = undefined;
    await offerUiKindSelfHeal([{ displayName: 'Continue.dev', extensionId: 'Continue.continue' }]);
    expect(vscodeState.messages).toHaveLength(0);
    expect(vscodeState.updates).toHaveLength(0);
  });

  it('is a no-op for an empty gap list', async () => {
    await offerUiKindSelfHeal([]);
    expect(vscodeState.messages).toHaveLength(0);
  });

  it('is a no-op without an open workspace folder', async () => {
    const state = vscodeState as unknown as { workspaceFolders: unknown[] };
    const original = state.workspaceFolders;
    state.workspaceFolders = [];
    try {
      await offerUiKindSelfHeal([{ displayName: 'Continue.dev', extensionId: 'Continue.continue' }]);
      expect(vscodeState.messages).toHaveLength(0);
    } finally {
      state.workspaceFolders = original;
    }
  });

  it('writes the override and offers a reload when accepted', async () => {
    const { window } = await import('vscode') as unknown as {
      window: { showInformationMessage: ReturnType<typeof vi.fn> };
    };
    window.showInformationMessage
      .mockResolvedValueOnce('Move to remote workspace')
      .mockResolvedValueOnce(undefined);

    await offerUiKindSelfHeal([{ displayName: 'Continue.dev', extensionId: 'Continue.continue' }]);

    expect(vscodeState.updates).toHaveLength(1);
    expect(vscodeState.updates[0].value).toEqual({ 'Continue.continue': ['workspace'] });
    // Modal self-heal prompt + reload offer
    expect(window.showInformationMessage).toHaveBeenCalledTimes(2);
  });

  it('writes nothing when the user dismisses the prompt', async () => {
    const { window } = await import('vscode') as unknown as {
      window: { showInformationMessage: ReturnType<typeof vi.fn> };
    };
    window.showInformationMessage.mockResolvedValueOnce(undefined);

    await offerUiKindSelfHeal([{ displayName: 'Continue.dev', extensionId: 'Continue.continue' }]);

    expect(vscodeState.updates).toHaveLength(0);
  });
});
