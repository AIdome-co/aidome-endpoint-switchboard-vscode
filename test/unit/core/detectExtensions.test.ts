import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const { mockExtensionsAll, mockOnDidChange, mockGetExtension } = vi.hoisted(() => ({
  mockExtensionsAll: [] as Array<{ id: string; packageJSON?: { version?: string }; isActive: boolean }>,
  mockOnDidChange: vi.fn(() => ({ dispose: vi.fn() })),
  mockGetExtension: vi.fn(),
}));

vi.mock('vscode', () => ({
  extensions: {
    all: mockExtensionsAll,
    onDidChange: mockOnDidChange,
    getExtension: mockGetExtension,
  },
}));

vi.mock('../../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      scoped: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        error: vi.fn(),
      }),
    }),
  },
}));

import { detectExtensions, invalidateExtensionsCache } from '../../../src/core/detection/detectExtensions';
import type { AssistantRegistry } from '../../../src/core/registry/registryTypes';

describe('detectExtensions', () => {
  beforeEach(() => {
    mockExtensionsAll.length = 0;
    invalidateExtensionsCache();
  });

  it('detects an installed extension from vscode.extensions.all', () => {
    mockExtensionsAll.push({
      id: 'continue.continue',
      packageJSON: { version: '1.2.22' },
      isActive: true,
    });

    const registry: AssistantRegistry = {
      $schemaVersion: '0.1.0',
      updatedAt: '2026-05-19T00:00:00.000Z',
      dialectCatalog: {},
      assistants: [
        {
          key: 'continue',
          displayName: 'Continue.dev',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: ['Continue.continue'] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: {
            supported: true,
            tier: 'A',
            configurationModes: ['config-file'],
            notes: [],
          },
          tlsVerification: { support: 'native', notes: 'test' },
          sources: [],
        },
      ],
    };

    const detected = detectExtensions(registry);
    expect(detected).toHaveLength(1);
    expect(detected[0].assistantKey).toBe('continue');
    expect(detected[0].version).toBe('1.2.22');
    expect(detected[0].isActive).toBe(true);
  });

  it('falls back to on-disk extension directories when vscode API misses an installed extension', () => {
    const extensionId = 'aidome.detect-fallback-test';
    const extensionDir = path.join(os.homedir(), '.vscode-server', 'extensions', `${extensionId}-1.2.22-linux-x64`);
    fs.mkdirSync(extensionDir, { recursive: true });
    fs.writeFileSync(
      path.join(extensionDir, 'package.json'),
      JSON.stringify({ name: 'detect-fallback-test', publisher: 'aidome', version: '1.2.22' })
    );

    const registry: AssistantRegistry = {
      $schemaVersion: '0.1.0',
      updatedAt: '2026-05-19T00:00:00.000Z',
      dialectCatalog: {},
      assistants: [
        {
          key: 'detect-fallback-test',
          displayName: 'Detect Fallback Test',
          kind: 'vscode-extension',
          detection: { vscodeExtensionIds: [extensionId] },
          dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
          endpointSwitching: {
            supported: true,
            tier: 'A',
            configurationModes: ['config-file'],
            notes: [],
          },
          tlsVerification: { support: 'native', notes: 'test' },
          sources: [],
        },
      ],
    };

    try {
      const detected = detectExtensions(registry);
      expect(detected).toHaveLength(1);
      expect(detected[0].assistantKey).toBe('detect-fallback-test');
      expect(detected[0].version).toBe('1.2.22');
      expect(detected[0].isActive).toBe(false);
    } finally {
      fs.rmSync(extensionDir, { recursive: true, force: true });
    }
  });
});