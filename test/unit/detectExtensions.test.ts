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
      id: 'DanielSanMedium.dscodegpt',
      packageJSON: { version: '3.24.53' },
      isActive: true,
    },
  ];
  const onDidChangeFn = vi.fn(() => ({ dispose: vi.fn() }));
  return {
    extensions: {
      all: extensionsList,
      getExtension: vi.fn((id: string) => {
        return extensionsList.find(e => e.id.toLowerCase() === id.toLowerCase()) || undefined;
      }),
      onDidChange: onDidChangeFn,
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

  it('detects CodeGPT from its real marketplace extension ID', async () => {
    const registry: AssistantRegistry = {
      version: '1.0',
      assistants: [
        {
          key: 'codegpt',
          displayName: 'CodeGPT',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['DanielSanMedium.dscodegpt'] },
          endpointSwitching: { tier: 'B', dialect: 'openai.chat_completions' },
        } as any,
      ],
    };

    const results = await detectExtensions(registry, fakeResolver());
    expect(results).toHaveLength(1);
    expect(results[0].assistantKey).toBe('codegpt');
    expect(results[0].extensionId).toBe('DanielSanMedium.dscodegpt');
    expect(results[0].version).toBe('3.24.53');
    expect(results[0].isActive).toBe(true);
  });

  it('returns empty when only the old nonexistent CodeGPT extension ID is registered', async () => {
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

    // Regression guard: the old CodeGPT.codegpt ID returns HTTP 404 on the
    // VS Code Marketplace and is not installed, so detection must be empty.
    const results = await detectExtensions(registry, fakeResolver());
    expect(results).toHaveLength(0);
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
