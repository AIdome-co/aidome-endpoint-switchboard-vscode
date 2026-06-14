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

describe('detectExtensions', () => {
  beforeEach(() => {
    invalidateExtensionsCache();
    vi.clearAllMocks();
  });

  it('detects installed extensions from registry', () => {
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

    const results = detectExtensions(registry);
    expect(results).toHaveLength(1);
    expect(results[0].assistantKey).toBe('continue');
    expect(results[0].displayName).toBe('Continue.dev');
    expect(results[0].version).toBe('0.9.1');
    expect(results[0].isActive).toBe(true);
  });

  it('returns empty when no extensions match', () => {
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

    const results = detectExtensions(registry);
    expect(results).toHaveLength(0);
  });

  it('detects only the first matching extension ID per assistant', () => {
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

    const results = detectExtensions(registry);
    expect(results).toHaveLength(1);
    expect(results[0].extensionId).toBe('saoudrizwan.claude-dev');
  });

  it('is case-insensitive for extension IDs', () => {
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

    const results = detectExtensions(registry);
    expect(results).toHaveLength(1);
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
