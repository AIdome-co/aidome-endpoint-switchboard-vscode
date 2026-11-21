/**
 * Unit tests for src/core/detection/detectExtensions.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('vscode', () => {
  const extensionsList = [
    {
      id: 'continue.continue',
      packageJSON: { version: '0.9.1' },
      isActive: true,
    },
    {
      id: 'saoudrizwan.claude-dev',
      packageJSON: { version: '3.2.0' },
      isActive: false,
    },
    {
      id: 'danielsanmedium.dscodegpt',
      packageJSON: { version: '3.24.52' },
      isActive: true,
    },
  ];
  const onDidChangeFn = vi.fn(() => ({ dispose: vi.fn() }));
  return {
    extensions: {
      all: extensionsList,
      getExtension: vi.fn((id: string) => {
        return extensionsList.find(e => e.id === id.toLowerCase()) || undefined;
      }),
      onDidChange: onDidChangeFn,
    },
    env: {
      get remoteName() {
        return (globalThis as { __mockRemoteName?: string }).__mockRemoteName;
      },
    },
  };
});

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      scoped: () => ({
        debug: vi.fn(),
        info: vi.fn(),
      }),
    }),
  },
}));

import {
  detectExtensions,
  invalidateExtensionsCache,
  getExtensionVersion,
  isExtensionActive,
  initializeExtensionCaching,
} from '../../src/core/detection/detectExtensions';
import type { AssistantRegistry } from '../../src/core/registry/registryTypes';
import type { ExtensionIdResolver } from '../../src/core/detection/extensionIdResolver';

/**
 * Fake resolver that returns the declared IDs unchanged — no marketplace
 * network access during fast unit tests.
 */
function fakeResolver(): ExtensionIdResolver {
  return {
    resolveForAssistant: async (entry) => ({
      assistantKey: entry.key,
      displayName: entry.displayName,
      declaredIds: entry.detection.vscodeExtensionIds ?? [],
      resolvedIds: entry.detection.vscodeExtensionIds ?? [],
      status: 'declared-valid',
    }),
  } as unknown as ExtensionIdResolver;
}

describe('detectExtensions', () => {
  beforeEach(() => {
    invalidateExtensionsCache();
    vi.clearAllMocks();
  });

  it('detects installed extensions from registry', async () => {
    const registry: AssistantRegistry = {
      version: '1.0',
      assistants: [
        {
          key: 'continue',
          displayName: 'Continue.dev',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['continue.continue'] },
          endpointSwitching: { tier: 'A', dialect: 'openai.chat_completions' },
        } as any,
      ],
    };

    const results = await detectExtensions(registry, fakeResolver());
    expect(results).toHaveLength(1);
    expect(results[0].assistantKey).toBe('continue');
    expect(results[0].displayName).toBe('Continue.dev');
    expect(results[0].version).toBe('0.9.1');
    expect(results[0].isActive).toBe(true);
  });

  it('returns empty when no extensions match', async () => {
    const registry: AssistantRegistry = {
      version: '1.0',
      assistants: [
        {
          key: 'unknown-ext',
          displayName: 'Unknown',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['unknown.publisher'] },
          endpointSwitching: { tier: 'C', dialect: 'unknown' },
        } as any,
      ],
    };

    const results = await detectExtensions(registry, fakeResolver());
    expect(results).toHaveLength(0);
  });

  it('detects only the first matching extension ID per assistant', async () => {
    const registry: AssistantRegistry = {
      version: '1.0',
      assistants: [
        {
          key: 'cline',
          displayName: 'Cline',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['saoudrizwan.claude-dev', 'continue.continue'] },
          endpointSwitching: { tier: 'A', dialect: 'openai.chat_completions' },
        } as any,
      ],
    };

    const results = await detectExtensions(registry, fakeResolver());
    expect(results).toHaveLength(1);
    expect(results[0].extensionId).toBe('saoudrizwan.claude-dev');
  });

  it('is case-insensitive for extension IDs', async () => {
    const registry: AssistantRegistry = {
      version: '1.0',
      assistants: [
        {
          key: 'continue',
          displayName: 'Continue.dev',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['Continue.Continue'] },
          endpointSwitching: { tier: 'A', dialect: 'openai.chat_completions' },
        } as any,
      ],
    };

    const results = await detectExtensions(registry, fakeResolver());
    expect(results).toHaveLength(1);
  });

  it('detects an installed extension via the resolver when the declared ID is stale', async () => {
    // The registry declares a non-existent ID ('CodeGPT.codegpt'); the installed
    // extension is DanielSanMedium.dscodegpt. The resolver supplies the canonical
    // ID so the assistant is still detected (the class of bug this layer fixes).
    const registry: AssistantRegistry = {
      version: '1.0',
      assistants: [
        {
          key: 'codegpt',
          displayName: 'CodeGPT',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['CodeGPT.codegpt'] },
          endpointSwitching: { tier: 'B', dialect: 'openai.chat_completions' },
        } as any,
      ],
    };

    const resolver = {
      resolveForAssistant: async (entry: any) => ({
        assistantKey: entry.key,
        displayName: entry.displayName,
        declaredIds: ['CodeGPT.codegpt'],
        resolvedIds: ['DanielSanMedium.dscodegpt'],
        status: 'resolved-from-market' as const,
      }),
    } as unknown as ExtensionIdResolver;

    const results = await detectExtensions(registry, resolver);
    expect(results).toHaveLength(1);
    expect(results[0].assistantKey).toBe('codegpt');
    expect(results[0].extensionId).toBe('DanielSanMedium.dscodegpt');
  });

  it('does not detect when neither declared nor resolved IDs match', async () => {
    const registry: AssistantRegistry = {
      version: '1.0',
      assistants: [
        {
          key: 'codegpt',
          displayName: 'CodeGPT',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['CodeGPT.codegpt'] },
          endpointSwitching: { tier: 'B', dialect: 'openai.chat_completions' },
        } as any,
      ],
    };

    const resolver = {
      resolveForAssistant: async (entry: any) => ({
        assistantKey: entry.key,
        displayName: entry.displayName,
        declaredIds: ['CodeGPT.codegpt'],
        resolvedIds: ['something.else'],
        status: 'resolved-from-market' as const,
      }),
    } as unknown as ExtensionIdResolver;

    const results = await detectExtensions(registry, resolver);
    expect(results).toHaveLength(0);
  });
});

describe('getExtensionVersion', () => {
  it('returns version for installed extension', () => {
    const version = getExtensionVersion('continue.continue');
    expect(version).toBe('0.9.1');
  });

  it('returns undefined for unknown extension', () => {
    const version = getExtensionVersion('nonexistent.ext');
    expect(version).toBeUndefined();
  });
});

describe('isExtensionActive', () => {
  it('returns true for active extension', () => {
    expect(isExtensionActive('continue.continue')).toBe(true);
  });

  it('returns false for inactive extension', () => {
    expect(isExtensionActive('saoudrizwan.claude-dev')).toBe(false);
  });

  it('returns false for unknown extension', () => {
    expect(isExtensionActive('nonexistent.ext')).toBe(false);
  });
});

describe('invalidateExtensionsCache', () => {
  it('clears the cache so next detection re-reads extensions', () => {
    // Simply verifying it doesn't throw
    invalidateExtensionsCache();
  });
});

describe('initializeExtensionCaching', () => {
  it('registers an onDidChange listener', () => {
    const mockContext = {
      subscriptions: [] as any[],
    };

    initializeExtensionCaching(mockContext as any);
    expect(vscode.extensions.onDidChange).toHaveBeenCalled();
    expect(mockContext.subscriptions).toHaveLength(1);
  });
});

describe('UI-kind activation-gap fallback', () => {
  const entry = {
    key: 'continue',
    displayName: 'Continue.dev',
    kind: 'vscode-extension',
    detection: { vscodeExtensionIds: ['Acme.fictional-assistant'] },
    dialect: {},
    endpointSwitching: { tier: 'A' },
  } as unknown as Parameters<typeof detectExtensions>[0]['assistants'][number];

  const registry = { assistants: [entry] } as unknown as Parameters<typeof detectExtensions>[0];
  const fakeResolver = { resolveForAssistant: vi.fn(async () => ({ resolvedIds: ['Acme.fictional-assistant'], status: 'not-found' })) } as unknown as ExtensionIdResolver;

  it('reports a UI-kind assistant installed on disk with an activation gap when remote', async () => {
    (globalThis as { __mockRemoteName?: string }).__mockRemoteName = 'ssh-remote';
    try {
      const lookup = vi.fn(() => ({ extensionId: 'Acme.fictional-assistant', version: '2.1.0', directory: '/x' }));
      const detected = await detectExtensions(registry, fakeResolver, lookup);
      expect(detected).toHaveLength(1);
      expect(detected[0].activationGap).toBe('ui-kind');
      expect(detected[0].extensionId).toBe('Acme.fictional-assistant');
      expect(detected[0].isActive).toBe(false);
      expect(detected[0].tier).toBe('A');
    } finally {
      delete (globalThis as { __mockRemoteName?: string }).__mockRemoteName;
    }
  });

  it('does not consult the on-disk fallback when not connected to a remote', async () => {
    (globalThis as { __mockRemoteName?: string }).__mockRemoteName = undefined;
    const lookup = vi.fn(() => ({ extensionId: 'Continue.continue', version: '2.1.0', directory: '/x' }));
    const detected = await detectExtensions(registry, fakeResolver, lookup);
    expect(detected).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('reports nothing when the on-disk lookup finds no UI-kind manifest', async () => {
    (globalThis as { __mockRemoteName?: string }).__mockRemoteName = 'ssh-remote';
    try {
      const detected = await detectExtensions(registry, fakeResolver, () => undefined);
      expect(detected).toHaveLength(0);
    } finally {
      delete (globalThis as { __mockRemoteName?: string }).__mockRemoteName;
    }
  });
});
