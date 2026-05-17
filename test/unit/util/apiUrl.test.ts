import { describe, expect, it } from 'vitest';
import { joinApiPath } from '../../../src/util/apiUrl';

describe('joinApiPath', () => {
  it('joins a base URL and API path with one slash', () => {
    expect(joinApiPath('https://gateway.example.com', '/v1/models'))
      .toBe('https://gateway.example.com/v1/models');
  });

  it('deduplicates an overlapping version prefix already present in the base URL', () => {
    expect(joinApiPath('https://gateway.example.com/v1', '/v1/models'))
      .toBe('https://gateway.example.com/v1/models');
    expect(joinApiPath('https://gateway.example.com/v1', '/v1/chat/completions'))
      .toBe('https://gateway.example.com/v1/chat/completions');
  });

  it('deduplicates the longest overlapping suffix/prefix between base and path', () => {
    expect(joinApiPath('https://gateway.example.com/api/v1', 'v1/models'))
      .toBe('https://gateway.example.com/api/v1/models');
  });
});