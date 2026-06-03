import { describe, expect, it } from 'vitest';

import { validateInputUrl, validateUrl } from '../../src/core/profiles/profileValidator';

describe('profileValidator', () => {
  it('accepts parseable internal http URLs for user input', () => {
    expect(validateInputUrl('http://internal-host:8080')).toBe(true);
  });

  it('accepts https URLs for user input', () => {
    expect(validateInputUrl('https://api.example.com/v1')).toBe(true);
  });

  it('rejects malformed or unsupported URL schemes for user input', () => {
    expect(validateInputUrl('not-a-url')).toBe(false);
    expect(validateInputUrl('javascript:alert(1)')).toBe(false);
    expect(validateInputUrl('ftp://example.com')).toBe(false);
  });

  it('keeps strict profile URL validation unchanged', () => {
    expect(validateUrl('http://internal-host:8080')).toBe(false);
    expect(validateUrl('http://localhost:8080')).toBe(true);
  });
});