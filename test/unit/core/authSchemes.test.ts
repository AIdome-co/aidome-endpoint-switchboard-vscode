/**
 * Unit tests for src/core/dialects/authSchemes.ts
 */

import { describe, it, expect } from 'vitest';
import {
  applyAuth,
  extractAuth,
  getAuthHeadersForDialect,
  getAuthSchemeForDialect,
} from '../../../src/core/dialects/authSchemes';

describe('applyAuth', () => {
  it('applies bearer token', () => {
    const headers = applyAuth({}, {
      scheme: 'bearer',
      token: 'my-secret-token',
    });
    expect(headers['Authorization']).toBe('Bearer my-secret-token');
  });

  it('does not set Authorization without token for bearer scheme', () => {
    const headers = applyAuth({}, { scheme: 'bearer' });
    expect(headers['Authorization']).toBeUndefined();
  });

  it('applies api-key-header', () => {
    const headers = applyAuth({}, {
      scheme: 'api-key-header',
      apiKey: 'sk-1234',
    });
    expect(headers['X-API-Key']).toBe('sk-1234');
  });

  it('does not set X-API-Key without apiKey', () => {
    const headers = applyAuth({}, { scheme: 'api-key-header' });
    expect(headers['X-API-Key']).toBeUndefined();
  });

  it('applies proprietary custom headers', () => {
    const headers = applyAuth({}, {
      scheme: 'proprietary',
      customHeaders: { 'X-Custom': 'custom-value', 'X-Another': 'another-value' },
    });
    expect(headers['X-Custom']).toBe('custom-value');
    expect(headers['X-Another']).toBe('another-value');
  });

  it('does nothing for proprietary without customHeaders', () => {
    const headers = applyAuth({ existing: 'value' }, { scheme: 'proprietary' });
    expect(headers).toEqual({ existing: 'value' });
  });

  it('preserves existing headers', () => {
    const headers = applyAuth({ 'Content-Type': 'application/json' }, {
      scheme: 'bearer',
      token: 'tok',
    });
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Authorization']).toBe('Bearer tok');
  });
});

describe('extractAuth', () => {
  it('extracts bearer token from Authorization header', () => {
    const result = extractAuth({ 'Authorization': 'Bearer my-token' });
    expect(result).toEqual({
      scheme: 'bearer',
      token: 'my-token',
    });
  });

  it('extracts bearer token from lowercase header', () => {
    const result = extractAuth({ 'authorization': 'Bearer another-token' });
    expect(result).toEqual({
      scheme: 'bearer',
      token: 'another-token',
    });
  });

  it('extracts API key from X-API-Key header', () => {
    const result = extractAuth({ 'X-API-Key': 'sk-abc123' });
    expect(result).toEqual({
      scheme: 'api-key-header',
      apiKey: 'sk-abc123',
    });
  });

  it('extracts API key from lowercase x-api-key header', () => {
    const result = extractAuth({ 'x-api-key': 'sk-xyz' });
    expect(result).toEqual({
      scheme: 'api-key-header',
      apiKey: 'sk-xyz',
    });
  });

  it('returns undefined when no auth headers present', () => {
    const result = extractAuth({ 'Content-Type': 'application/json' });
    expect(result).toBeUndefined();
  });

  it('prefers Bearer over API key when both present', () => {
    const result = extractAuth({
      'Authorization': 'Bearer tok',
      'X-API-Key': 'key',
    });
    expect(result?.scheme).toBe('bearer');
  });
});

describe('getAuthHeadersForDialect', () => {
  it('returns Bearer for openai.chat_completions', () => {
    const headers = getAuthHeadersForDialect('openai.chat_completions', 'sk-key');
    expect(headers['Authorization']).toBe('Bearer sk-key');
  });

  it('returns Bearer for openai.responses', () => {
    const headers = getAuthHeadersForDialect('openai.responses', 'sk-key');
    expect(headers['Authorization']).toBe('Bearer sk-key');
  });

  it('returns x-api-key and anthropic-version for anthropic.messages', () => {
    const headers = getAuthHeadersForDialect('anthropic.messages', 'ant-key');
    expect(headers['x-api-key']).toBe('ant-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('returns Bearer for google.gemini.generate_content', () => {
    const headers = getAuthHeadersForDialect('google.gemini.generate_content', 'gem-key');
    expect(headers['Authorization']).toBe('Bearer gem-key');
  });

  it('returns empty headers for github.copilot', () => {
    const headers = getAuthHeadersForDialect('github.copilot', 'key');
    expect(Object.keys(headers)).toHaveLength(0);
  });

  it('returns empty headers for tabnine.proprietary', () => {
    const headers = getAuthHeadersForDialect('tabnine.proprietary', 'key');
    expect(Object.keys(headers)).toHaveLength(0);
  });

  it('returns Bearer for unknown dialect', () => {
    const headers = getAuthHeadersForDialect('unknown', 'my-key');
    expect(headers['Authorization']).toBe('Bearer my-key');
  });
});

describe('getAuthSchemeForDialect', () => {
  it('returns bearer for openai.chat_completions', () => {
    expect(getAuthSchemeForDialect('openai.chat_completions')).toBe('bearer');
  });

  it('returns bearer for openai.responses', () => {
    expect(getAuthSchemeForDialect('openai.responses')).toBe('bearer');
  });

  it('returns api-key-header for anthropic.messages', () => {
    expect(getAuthSchemeForDialect('anthropic.messages')).toBe('api-key-header');
  });

  it('returns query-param for google.gemini.generate_content', () => {
    expect(getAuthSchemeForDialect('google.gemini.generate_content')).toBe('query-param');
  });

  it('returns proprietary for github.copilot', () => {
    expect(getAuthSchemeForDialect('github.copilot')).toBe('proprietary');
  });

  it('returns proprietary for tabnine.proprietary', () => {
    expect(getAuthSchemeForDialect('tabnine.proprietary')).toBe('proprietary');
  });

  it('returns bearer for unknown dialect', () => {
    expect(getAuthSchemeForDialect('unknown')).toBe('bearer');
  });
});
