import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointProfile } from '../../src/core/profiles/profileTypes';

const { mockReadClaudeCodeGatewayConfig, mockGetSecret } = vi.hoisted(() => ({
  mockReadClaudeCodeGatewayConfig: vi.fn(),
  mockGetSecret: vi.fn(),
}));

vi.mock('../../src/adapters/claudeCode/claudeCodeConfigPatcher', async () => {
  const actual = await vi.importActual<typeof import('../../src/adapters/claudeCode/claudeCodeConfigPatcher')>(
    '../../src/adapters/claudeCode/claudeCodeConfigPatcher'
  );

  return {
    ...actual,
    readClaudeCodeGatewayConfig: mockReadClaudeCodeGatewayConfig,
  };
});

import { resolveAidomeProfileAuthToken } from '../../src/core/profiles/resolveAidomeProfileAuth';

describe('resolveAidomeProfileAuthToken', () => {
  const profile: EndpointProfile = {
    id: 'profile-1',
    name: 'mag',
    profileType: 'aidome',
    baseUrl: 'https://demo-lab-vm-4b50c78f.aidome.cloud/v1',
    dialect: 'anthropic.messages',
    authRef: 'mag',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prefers the live Claude gateway token when the base URL matches', async () => {
    mockReadClaudeCodeGatewayConfig.mockResolvedValue({
      baseUrl: 'https://demo-lab-vm-4b50c78f.aidome.cloud',
      apiKey: 'claude-settings-token',
      modelDiscoveryEnabled: true,
    });
    mockGetSecret.mockResolvedValue('stored-profile-secret');

    const token = await resolveAidomeProfileAuthToken(profile, {
      getSecret: mockGetSecret,
    } as any);

    expect(token).toBe('claude-settings-token');
    expect(mockGetSecret).not.toHaveBeenCalled();
  });

  it('falls back to the stored profile secret when Claude settings target a different gateway', async () => {
    mockReadClaudeCodeGatewayConfig.mockResolvedValue({
      baseUrl: 'https://demo-lab-vm-8a4ad0fc.aidome.cloud',
      apiKey: 'claude-settings-token',
      modelDiscoveryEnabled: true,
    });
    mockGetSecret.mockResolvedValue('stored-profile-secret');

    const token = await resolveAidomeProfileAuthToken(profile, {
      getSecret: mockGetSecret,
    } as any);

    expect(token).toBe('stored-profile-secret');
    expect(mockGetSecret).toHaveBeenCalledWith('mag');
  });
});