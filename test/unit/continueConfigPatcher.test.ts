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

  it('should fall back to an empty config for malformed JSON when logging fails', async () => {
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{ malformed json');
    vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);
    vi.mocked(Logger.getInstance).mockImplementationOnce(() => {
      throw new Error('logger unavailable');
    });

    await expect(patchContinueConfig(mockProfile, '/path/to/config.json')).resolves.toBeUndefined();

    expect(fsSafe.writeFileAtomic).toHaveBeenCalled();
    const writtenContent = vi.mocked(fsSafe.writeFileAtomic).mock.calls[0][1];
    const parsed = JSON.parse(writtenContent);
    expect(parsed.models).toContainEqual(expect.objectContaining({
      provider: 'openai',
      apiBase: mockProfile.baseUrl
    }));
  });
});
