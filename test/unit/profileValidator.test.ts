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

  it('applies the same policy as validateInputUrl (self-hosted http accepted)', () => {
    // Regression: validateUrl used to reject plain-http non-localhost URLs
    // that the creation flow accepted, which failed plan builds halfway and
    // left assistants in mixed states.
    expect(validateUrl('http://internal-host:8080')).toBe(true);
    expect(validateUrl('http://80.240.29.183:8100/v1')).toBe(true);
    expect(validateUrl('http://localhost:8080')).toBe(true);
    expect(validateUrl('https://api.example.com/v1')).toBe(true);
    expect(validateUrl('ftp://example.com')).toBe(false);
    expect(validateUrl('javascript:alert(1)')).toBe(false);
    expect(validateUrl('not-a-url')).toBe(false);
  });
});