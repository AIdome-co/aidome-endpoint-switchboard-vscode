/**
 * Unit tests for src/core/detection/extensionIdResolver.ts
 */

import { describe, it, expect } from 'vitest';
import { ExtensionIdResolver } from '../../src/core/detection/extensionIdResolver';
import { MarketplaceClient, MarketplaceUnavailableError } from '../../src/core/detection/marketplace';
import type { AssistantEntry } from '../../src/core/registry/registryTypes';

// The resolver creates a default MarketplaceClient unless one is injected, and the
// client's http dependency transitively pulls in runtimeSettings -> vscode. Mock
// http so this unit test stays isolated from the vscode module.
vi.mock('../../src/util/http', () => ({ httpRequest: vi.fn() }));

function makeEntry(overrides: Partial<AssistantEntry> = {}): AssistantEntry {
  return {
    key: 'codegpt',
    displayName: 'CodeGPT',
    kind: 'vscode-extension',
    detection: { vscodeExtensionIds: ['CodeGPT.codegpt'] },
    dialect: { primary: 'openai.chat_completions', alsoPossible: [] },
    endpointSwitching: { supported: true, tier: 'B', configurationModes: [] },
    tlsVerification: { support: 'none', notes: '' },
    sources: [],
    ...overrides,
  } as AssistantEntry;
}

function makeClient(overrides: Partial<MarketplaceClient>): MarketplaceClient {
  return overrides as MarketplaceClient;
}

describe('ExtensionIdResolver.resolveForAssistant', () => {
  it('uses a declared ID when it exists on the marketplace', async () => {
    const client = makeClient({
      getExtensionById: async (id) =>
        id === 'valid.extension'
          ? { id: 'valid.extension', displayName: 'Valid', extensionName: 'extension', version: '1.0.0' }
          : undefined,
    });
    const resolver = new ExtensionIdResolver(client);

    const result = await resolver.resolveForAssistant(makeEntry({
      detection: { vscodeExtensionIds: ['valid.extension'] },
    }));

    expect(result.status).toBe('declared-valid');
    expect(result.resolvedIds).toEqual(['valid.extension']);
  });

  it('resolves the canonical ID from the market when the declared ID is stale', async () => {
    const client = makeClient({
      getExtensionById: async () => undefined,
      searchByDisplayName: async () => [
        { id: 'DanielSanMedium.dscodegpt', displayName: 'CodeGPT: Chat & AI Agents', extensionName: 'dscodegpt', version: '3.24.52' },
      ],
    });
    const resolver = new ExtensionIdResolver(client);

    const result = await resolver.resolveForAssistant(makeEntry());

    expect(result.status).toBe('resolved-from-market');
    expect(result.resolvedIds).toEqual(['DanielSanMedium.dscodegpt']);
  });

  it('prefers the first strong match respecting marketplace relevance order', async () => {
    const client = makeClient({
      getExtensionById: async () => undefined,
      searchByDisplayName: async () => [
        { id: 'DanielSanMedium.dscodegpt', displayName: 'CodeGPT: Chat & AI Agents', extensionName: 'dscodegpt', version: '3.24.52' },
        { id: 'OtherThings.unrelated', displayName: 'Unrelated Tool', extensionName: 'unrelated', version: '1.0.0' },
        { id: 'DanielSanMedium.CodeGPT', displayName: 'CodeGPT Chat and AI Agents', extensionName: 'CodeGPT', version: '1.3.39' },
      ],
    });
    const resolver = new ExtensionIdResolver(client);

    const result = await resolver.resolveForAssistant(makeEntry());

    expect(result.status).toBe('resolved-from-market');
    expect(result.resolvedIds).toEqual(['DanielSanMedium.dscodegpt']);
  });

  it('falls back to declared IDs when the marketplace is unreachable', async () => {
    const client = makeClient({
      getExtensionById: async () => {
        throw new MarketplaceUnavailableError('down');
      },
    });
    const resolver = new ExtensionIdResolver(client);

    const result = await resolver.resolveForAssistant(makeEntry());

    expect(result.status).toBe('offline-fallback');
    expect(result.resolvedIds).toEqual(['CodeGPT.codegpt']);
  });

  it('marks unresolvable when no declared ID and no market match', async () => {
    const client = makeClient({
      getExtensionById: async () => undefined,
      searchByDisplayName: async () => [],
    });
    const resolver = new ExtensionIdResolver(client);

    const result = await resolver.resolveForAssistant(makeEntry({
      detection: { vscodeExtensionIds: ['does-not.exist'] },
    }));

    expect(result.status).toBe('unresolvable');
    expect(result.resolvedIds).toEqual(['does-not.exist']);
  });
});

describe('ExtensionIdResolver.validateRegistry', () => {
  it('reports resolved-from-market as a warning and keeps the gate valid', async () => {
    const client = makeClient({
      getExtensionById: async () => undefined,
      searchByDisplayName: async () => [
        { id: 'DanielSanMedium.dscodegpt', displayName: 'CodeGPT: Chat & AI Agents', extensionName: 'dscodegpt' },
      ],
    });
    const resolver = new ExtensionIdResolver(client);

    const result = await resolver.validateRegistry([makeEntry()]);

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('codegpt'))).toBe(true);
  });

  it('fails the gate when an assistant is unresolvable', async () => {
    const client = makeClient({
      getExtensionById: async () => undefined,
      searchByDisplayName: async () => [],
    });
    const resolver = new ExtensionIdResolver(client);

    const result = await resolver.validateRegistry([makeEntry({
      key: 'ghost',
      displayName: 'Ghost Tool',
      detection: { vscodeExtensionIds: ['ghost.nothing'] },
    })]);

    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('ghost'))).toBe(true);
  });

  it('skips assistants without extension IDs', async () => {
    const resolver = new ExtensionIdResolver(makeClient({}));
    const result = await resolver.validateRegistry([makeEntry({
      detection: { vscodeExtensionIds: [] },
    })]);
    expect(result.resolutions).toHaveLength(0);
    expect(result.isValid).toBe(true);
  });
});