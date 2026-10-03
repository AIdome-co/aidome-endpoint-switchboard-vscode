/**
 * Unit tests for Continue config patcher.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { patchContinueConfig } from '../../src/adapters/continue/continueConfigPatcher';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as fsSafe from '../../src/util/fsSafe';
import { Logger } from '../../src/util/log';

vi.mock('../../src/util/fsSafe');
vi.mock('../../src/adapters/continue/paths', () => ({
  getContinueConfigPath: () => '/home/user/.continue/config.json'
}));
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warning: vi.fn(),
      error: vi.fn()
    }))
  }
}));

describe('Continue Config Patcher', () => {
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      baseUrl: 'https://aidome.example.com/v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
  });

  it('should fail closed on malformed JSON and never write', async () => {
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{ malformed json');
    vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

    await expect(patchContinueConfig(mockProfile, '/path/to/config.json'))
      .rejects.toThrow('malformed existing configuration file');
    expect(fsSafe.writeFileAtomic).not.toHaveBeenCalled();
  });
});
