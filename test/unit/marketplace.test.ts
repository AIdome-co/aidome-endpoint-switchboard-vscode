/**
 * Unit tests for src/core/detection/marketplace.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketplaceClient, MarketplaceUnavailableError } from '../../src/core/detection/marketplace';

vi.mock('../../src/util/http', () => ({
  httpRequest: vi.fn(),
}));

import { httpRequest } from '../../src/util/http';

const mockHttpRequest = vi.mocked(httpRequest);

function galleryExtensions(exts: unknown[]) {
  return {
    results: [{ extensions: exts }],
  };
}

describe('MarketplaceClient', () => {
  beforeEach(() => {
    mockHttpRequest.mockReset();
  });

  it('maps a raw gallery extension to a normalized MarketplaceExtension', async () => {
    mockHttpRequest.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: galleryExtensions([
        {
          publisher: { publisherName: 'DanielSanMedium' },
          extensionName: 'dscodegpt',
          displayName: 'CodeGPT: Chat & AI Agents',
          versions: [{ version: '3.24.52' }],
        },
      ]),
    } as any);

    const client = new MarketplaceClient();
    const result = await client.getExtensionById('DanielSanMedium.dscodegpt');

    expect(result).toEqual({
      id: 'DanielSanMedium.dscodegpt',
      displayName: 'CodeGPT: Chat & AI Agents',
      extensionName: 'dscodegpt',
      version: '3.24.52',
    });
    expect(mockHttpRequest).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for a clean miss (extension not found)', async () => {
    mockHttpRequest.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: galleryExtensions([]),
    } as any);

    const client = new MarketplaceClient();
    const result = await client.getExtensionById('does-not.exist');
    expect(result).toBeUndefined();
  });

  it('returns the extension list from a search by display name', async () => {
    mockHttpRequest.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: galleryExtensions([
        { publisher: { publisherName: 'DanielSanMedium' }, extensionName: 'dscodegpt', displayName: 'CodeGPT' },
        { publisher: { publisherName: 'Other' }, extensionName: 'thing', displayName: 'Other Thing' },
      ]),
    } as any);

    const client = new MarketplaceClient();
    const results = await client.searchByDisplayName('CodeGPT');

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('DanielSanMedium.dscodegpt');
  });

  it('uses the configured timeout and retry policy', async () => {
    mockHttpRequest.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: galleryExtensions([]),
    } as any);

    const client = new MarketplaceClient({ timeoutMs: 1200, retries: 2 });
    await client.getExtensionById('does-not.exist');

    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 1200, retries: 2 })
    );
  });

  it('skips malformed entries without a publisher or extension name', async () => {
    mockHttpRequest.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: galleryExtensions([
        { extensionName: 'missing-publisher' },
        { publisher: { publisherName: 'missing-name' } },
        { publisher: { publisherName: 'A' }, extensionName: 'b', displayName: 'AB' },
      ]),
    } as any);

    const client = new MarketplaceClient();
    const results = await client.searchByDisplayName('anything');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('A.b');
  });

  it('throws MarketplaceUnavailableError on network failure', async () => {
    mockHttpRequest.mockRejectedValue(new Error('Network error: ECONNREFUSED'));

    const client = new MarketplaceClient();
    await expect(client.getExtensionById('any.id')).rejects.toBeInstanceOf(MarketplaceUnavailableError);
  });
});
