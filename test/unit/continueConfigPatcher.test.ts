/**
 * Unit tests for Continue config patcher.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildContinueConfigContent,
  parseContinueConfigContent,
  patchContinueConfig
} from '../../src/adapters/continue/continueConfigPatcher';
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

  it('updates a YAML config while preserving unrelated fields', () => {
    const updated = buildContinueConfigContent(
      mockProfile.baseUrl,
      [
        'name: Existing config',
        'models:',
        '  - provider: openai',
        '    model: gpt-4o-mini',
        'requestOptions:',
        '  timeout: 30000'
      ].join('\n'),
      '/home/user/.continue/config.yaml'
    );

    const parsed = parseContinueConfigContent(updated, '/home/user/.continue/config.yaml');
    expect(parsed).toMatchObject({
      name: 'Existing config',
      requestOptions: { timeout: 30000 },
      models: [{ provider: 'openai', model: 'gpt-4o-mini', apiBase: mockProfile.baseUrl }]
    });
  });

  it('writes an anthropic provider for an anthropic profile', async () => {
    const anthropicProfile = {
      ...mockProfile,
      dialect: 'anthropic.messages' as const
    };
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('models:\n  - model: claude-sonnet-4\n');
    vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

    await patchContinueConfig(anthropicProfile, '/home/user/.continue/config.yaml');

    const written = vi.mocked(fsSafe.writeFileAtomic).mock.calls[0][1];
    const parsed = parseContinueConfigContent(written, '/home/user/.continue/config.yaml');
    expect(parsed.models?.[0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      apiBase: anthropicProfile.baseUrl
    });
  });
});
