/**
 * Unit tests for src/core/detection/uiKindDetection.ts — UI-kind (client-side)
 * extension fallback detection and the remote.extensionKind self-heal guidance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const vscodeState = {
  appRoot: '/home/dev/.vscode-server/cli/servers/Stable-abc/server' as string | undefined,
  remoteName: 'ssh-remote' as string | undefined,
  clipboardWrites: [] as string[],
  messages: [] as unknown[],
};

vi.mock('vscode', () => {
  return {
    env: {
      get appRoot() {
        return vscodeState.appRoot;
      },
      get remoteName() {
        return vscodeState.remoteName;
      },
      clipboard: {
        writeText: vi.fn((text: string) => {
          vscodeState.clipboardWrites.push(text);
          return Promise.resolve();
        }),
      },
    },
    window: {
      showInformationMessage: vi.fn((...args: unknown[]) => {
        vscodeState.messages.push(args);
        return Promise.resolve(undefined);
      }),
      showWarningMessage: vi.fn((...args: unknown[]) => {
        vscodeState.messages.push(args);
        return Promise.resolve(undefined);
      }),
    },
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
  buildExtensionKindSnippet,
  partitionUiKindGaps,
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

describe('buildExtensionKindSnippet', () => {
  it('produces a single-ID snippet', () => {
    expect(buildExtensionKindSnippet(['Continue.continue'])).toBe(
      '{\n  "remote.extensionKind": {\n    "Continue.continue": ["workspace"]\n  }\n}'
    );
  });

  it('lists every ID for multi-ID assistants', () => {
    const snippet = buildExtensionKindSnippet(['GitHub.copilot', 'GitHub.copilot-chat']);
    expect(snippet).toContain('"GitHub.copilot": ["workspace"]');
    expect(snippet).toContain('"GitHub.copilot-chat": ["workspace"]');
  });
});

describe('partitionUiKindGaps', () => {
  it('splits gap assistants from switchable ones', () => {
    const detected = [
      { activationGap: undefined as 'ui-kind' | undefined },
      { activationGap: 'ui-kind' as const },
      { activationGap: 'ui-kind' as const },
    ];
    const { gaps, switchable } = partitionUiKindGaps(detected);
    expect(gaps).toHaveLength(2);
    expect(switchable).toHaveLength(1);
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

  it('skips directories recorded in the .obsolete marker (pending cleanup after uninstall)', () => {
    makeExtensionDir(root, 'continue.continue-2.1.0', {
      publisher: 'Continue',
      name: 'continue',
      version: '2.1.0',
      extensionKind: ['ui', 'workspace'],
    });
    fs.writeFileSync(path.join(root, '.obsolete'), JSON.stringify({ 'continue.continue-2.1.0': true }));
    expect(findClientSideExtension('Continue.continue', [root])).toBeUndefined();
  });

  it('returns undefined when the directory does not exist', () => {
    expect(findClientSideExtension('a.b', [path.join(root, 'missing')])).toBeUndefined();
  });
});

describe('active-server root derivation', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-server-'));
    fs.mkdirSync(path.join(root, 'cli', 'servers', 'Stable-abc', 'server'), { recursive: true });
    vscodeState.appRoot = path.join(root, 'cli', 'servers', 'Stable-abc', 'server');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    vscodeState.appRoot = '/home/dev/.vscode-server/cli/servers/Stable-abc/server';
  });

  it('derives the extensions root from appRoot and finds the installed gap extension', () => {
    const extRoot = path.join(root, 'extensions');
    makeExtensionDir(extRoot, 'continue.continue-2.1.0', {
      publisher: 'Continue',
      name: 'continue',
      version: '2.1.0',
      extensionKind: ['ui', 'workspace'],
    });
    const found = findClientSideExtension('Continue.continue');
    expect(found?.version).toBe('2.1.0');
  });

  it('ignores extensions under a different (inactive) server tree', () => {
    const otherServer = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-server-insiders-'));
    try {
      const extRoot = path.join(otherServer, 'extensions');
      makeExtensionDir(extRoot, 'continue.continue-2.1.0', {
        publisher: 'Continue',
        name: 'continue',
        version: '2.1.0',
        extensionKind: ['ui', 'workspace'],
      });
      expect(findClientSideExtension('Continue.continue')).toBeUndefined();
    } finally {
      fs.rmSync(otherServer, { recursive: true, force: true });
    }
  });
});

describe('offerUiKindSelfHeal', () => {
  beforeEach(() => {
    vscodeState.clipboardWrites.length = 0;
    vscodeState.messages.length = 0;
    vscodeState.remoteName = 'ssh-remote';
  });

  it('is a no-op when not connected to a remote', async () => {
    vscodeState.remoteName = undefined;
    await offerUiKindSelfHeal([{ displayName: 'Continue.dev', extensionId: 'Continue.continue' }]);
    expect(vscodeState.clipboardWrites).toHaveLength(0);
    expect(vscodeState.messages).toHaveLength(0);
  });

  it('is a no-op for an empty gap list', async () => {
    await offerUiKindSelfHeal([]);
    expect(vscodeState.clipboardWrites).toHaveLength(0);
  });

  it('copies the remote.extensionKind snippet and explains the gap', async () => {
    await offerUiKindSelfHeal([{ displayName: 'Continue.dev', extensionId: 'Continue.continue' }]);

    expect(vscodeState.clipboardWrites).toHaveLength(1);
    expect(vscodeState.clipboardWrites[0]).toContain('"Continue.continue": ["workspace"]');
    expect(vscodeState.messages).toHaveLength(1);
    const [message] = vscodeState.messages[0] as [string, unknown, string];
    expect(message).toContain('Continue.dev');
    expect(message).toContain('local user settings.json');
  });

  it('shows manual instructions when the clipboard write fails', async () => {
    const vscodeModule = await import('vscode') as unknown as {
      env: { clipboard: { writeText: ReturnType<typeof vi.fn> } };
    };
    vscodeModule.env.clipboard.writeText.mockRejectedValueOnce(new Error('clipboard denied'));

    await offerUiKindSelfHeal([{ displayName: 'Continue.dev', extensionId: 'Continue.continue' }]);

    expect(vscodeState.messages).toHaveLength(1);
    const [message] = vscodeState.messages[0] as [string, unknown, string];
    expect(message).toContain('Manual snippet');
  });
});
