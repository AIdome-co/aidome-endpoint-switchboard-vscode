import { describe, expect, it } from 'vitest';
import { normalizeOpenAiBaseUrl } from '../../src/core/providerConfig/endpointUrl';

describe('normalizeOpenAiBaseUrl', () => {
  it('adds the API version to a gateway root', () => {
    expect(normalizeOpenAiBaseUrl('https://gateway.example.com/'))
      .toBe('https://gateway.example.com/v1');
  });

  it('preserves an existing versioned path and removes trailing slashes', () => {
    expect(normalizeOpenAiBaseUrl('https://gateway.example.com/proxy/v1/'))
      .toBe('https://gateway.example.com/proxy/v1');
  });

  it('rejects unsafe schemes', () => {
    expect(() => normalizeOpenAiBaseUrl('file:///tmp/gateway')).toThrow('Invalid OpenAI-compatible endpoint URL');
  });
});
