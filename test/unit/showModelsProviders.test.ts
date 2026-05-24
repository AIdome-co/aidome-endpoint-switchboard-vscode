import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EndpointProfile } from '../../src/core/profiles/profileTypes';

const {
  mockWithProgress,
  mockShowError,
  mockShowWarning,
  mockGetProfiles,
  mockGetActiveProfile,
  mockGetSecret,
  mockAppendLine,
  mockShowOutput,
  mockHttpRequest,
  MockHttpError,
  mockLoggerInfo,
  mockLoggerError
} = vi.hoisted(() => ({
  mockWithProgress: vi.fn(),
  mockShowError: vi.fn(),
  mockShowWarning: vi.fn(),
  mockGetProfiles: vi.fn(),
  mockGetActiveProfile: vi.fn(),
  mockGetSecret: vi.fn(),
  mockAppendLine: vi.fn(),
  mockShowOutput: vi.fn(),
  mockHttpRequest: vi.fn(),
  MockHttpError: class MockHttpError extends Error {
    constructor(
      public status: number,
      public statusText: string,
      message: string
    ) {
      super(message);
      this.name = 'HttpError';
    }
  },
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn()
}));

vi.mock('vscode', () => ({
  window: {
    withProgress: mockWithProgress
  },
  ProgressLocation: { Notification: 15 }
}));

vi.mock('../../src/core/profiles/profileStore', () => ({
  ProfileStore: vi.fn().mockImplementation(class {
    getProfiles = mockGetProfiles;
    getActiveProfile = mockGetActiveProfile;
  })
}));

vi.mock('../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn().mockImplementation(class {
    getSecret = mockGetSecret;
  })
}));

vi.mock('../../src/ui/notifications', () => ({
  showError: mockShowError,
  showWarning: mockShowWarning
}));

vi.mock('../../src/ui/output', () => ({
  getOutputChannel: vi.fn(() => ({
    appendLine: mockAppendLine,
    show: mockShowOutput
  }))
}));

vi.mock('../../src/util/http', () => ({
  httpRequest: mockHttpRequest,
  HttpError: MockHttpError
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      info: mockLoggerInfo,
      error: mockLoggerError
    })
  }
}));

import { showModelsProviders } from '../../src/commands/showModelsProviders';

describe('showModelsProviders', () => {
  const profile: EndpointProfile = {
    id: 'profile-1',
    name: 'Gateway Prod',
    baseUrl: 'https://gateway.example.com/v1',
    dialect: 'openai.chat_completions',
    profileType: 'custom',
    authRef: 'Gateway Prod',
    createdAt: '2026-05-24T00:00:00.000Z',
    updatedAt: '2026-05-24T00:00:00.000Z'
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWithProgress.mockImplementation(async (_options, task) => task());
    mockGetProfiles.mockResolvedValue([profile]);
    mockGetActiveProfile.mockResolvedValue(profile);
    mockGetSecret.mockResolvedValue('token-123');
  });

  it('shows providers and models for a custom profile', async () => {
    mockHttpRequest
      .mockResolvedValueOnce({
        body: [
          {
            id: 'openai',
            name: 'OpenAI',
            type: 'upstream',
            status: 'active',
            supportedModels: ['gpt-4.1']
          }
        ]
      })
      .mockResolvedValueOnce({
        body: {
          data: [
            {
              id: 'gpt-4.1',
              owned_by: 'openai'
            }
          ]
        }
      });

    await showModelsProviders({} as any, profile.id);

    expect(mockHttpRequest).toHaveBeenNthCalledWith(
      1,
      'https://gateway.example.com/v1/providers',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer token-123' }
      })
    );
    expect(mockHttpRequest).toHaveBeenNthCalledWith(
      2,
      'https://gateway.example.com/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer token-123' }
      })
    );
    expect(mockAppendLine).toHaveBeenCalledWith('  • OpenAI (openai)');
    expect(mockAppendLine).toHaveBeenCalledWith('  • gpt-4.1 (gpt-4.1)');
    expect(mockShowOutput).toHaveBeenCalledTimes(1);
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('still shows models when the provider endpoint is unavailable', async () => {
    mockHttpRequest
      .mockRejectedValueOnce(new MockHttpError(404, 'Not Found', 'HTTP 404'))
      .mockResolvedValueOnce({
        body: {
          data: [
            {
              id: 'gpt-4.1-mini',
              owned_by: 'openai'
            }
          ]
        }
      });

    await showModelsProviders({} as any, profile.id);

    expect(mockAppendLine).toHaveBeenCalledWith('  Derived from model list because a dedicated providers list was unavailable.');
    expect(mockAppendLine).toHaveBeenCalledWith('  • openai (openai)');
    expect(mockAppendLine).toHaveBeenCalledWith('  • gpt-4.1-mini (gpt-4.1-mini)');
    expect(mockShowOutput).toHaveBeenCalledTimes(1);
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it('infers providers from provider-prefixed model identifiers', async () => {
    mockHttpRequest
      .mockRejectedValueOnce(new MockHttpError(404, 'Not Found', 'HTTP 404'))
      .mockResolvedValueOnce({
        body: {
          data: [
            {
              id: 'xai/grok-3-mini'
            }
          ]
        }
      });

    await showModelsProviders({} as any, profile.id);

    expect(mockAppendLine).toHaveBeenCalledWith('  • xai (xai)');
    expect(mockAppendLine).toHaveBeenCalledWith('  • xai/grok-3-mini (xai/grok-3-mini)');
    expect(mockAppendLine).toHaveBeenCalledWith('    Provider: xai');
    expect(mockShowOutput).toHaveBeenCalledTimes(1);
    expect(mockShowError).not.toHaveBeenCalled();
  });
});