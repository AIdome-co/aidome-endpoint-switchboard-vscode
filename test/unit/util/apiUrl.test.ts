/**
 * Unit tests for API URL joining helpers.
 */

import { describe, expect, it } from 'vitest';
import { joinApiPath } from '../../../src/util/apiUrl';

describe('joinApiPath', () => {
  it('appends versioned paths to unversioned base URLs', () => {
    expect(joinApiPath('https://demo.aidome.cloud', '/v1/models')).toBe(
      'https://demo.aidome.cloud/v1/models'
    );
  });

  it('does not duplicate /v1 when the base URL already ends with a version segment', () => {
    expect(joinApiPath('https://demo.aidome.cloud/v1', '/v1/models')).toBe(
      'https://demo.aidome.cloud/v1/models'
    );
  });
});