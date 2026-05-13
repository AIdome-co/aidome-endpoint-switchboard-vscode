/**
 * Unit tests for verifier auth propagation and versioned URL handling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Verifier } from '../../../src/core/orchestration/verifier';
import { EndpointProfile } from '../../../src/core/profiles/profileTypes';

const {
  httpRequestMock,
  MockHttpError,
  mockConfigGet,
  mockLoggerDebug,
  mockLoggerError,
  mockLoggerInfo,
  mockLoggerWarning
} = vi.hoisted(() => ({
  httpRequestMock: vi.fn(),
  MockHttpError: class extends Error {
    constructor(
      public status: number,
      public statusText: string,
      message: string
    ) {
      super(message);
      this.name = 'HttpError';
    }
  },
  mockConfigGet: vi.fn(),
  mockLoggerDebug: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarning: vi.fn()
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: mockConfigGet
    }))
  }
}));

vi.mock('../../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      debug: mockLoggerDebug,
      error: mockLoggerError,
      info: mockLoggerInfo,
      warning: mockLoggerWarning
    })
  }
}));

vi.mock('../../../src/util/http', () => {
  return {
    HttpError: MockHttpError,
    httpRequest: httpRequestMock
  };
});

describe('Verifier', () => {
  let verifier: Verifier;
  let profile: EndpointProfile;

  beforeEach(() => {
    verifier = new Verifier();
    profile = {
      id: 'profile-1',
      name: 'claude-test',
      profileType: 'custom',
      baseUrl: 'http://localhost:3000/v1',
      dialect: 'openai.responses',
      authRef: 'claude-test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    httpRequestMock.mockReset();
    mockConfigGet.mockReset();
    mockLoggerDebug.mockReset();
    mockLoggerError.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarning.mockReset();
  });

  it('uses the stored auth token and avoids duplicate /v1 segments for model-list probes', async () => {
    httpRequestMock.mockImplementation(async (url: string) => {
      if (url === 'http://localhost:3000/v1') {
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          body: {}
        };
      }

      if (url === 'http://localhost:3000/v1/models') {
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: { data: [{ id: 'anthropic/claude-sonnet-4-6' }] }
        };
      }

      if (url === 'http://localhost:3000/v1/responses') {
        throw new MockHttpError(404, 'Not Found', 'HTTP 404: Not Found');
      }

      if (url === 'http://localhost:3000/v1/chat/completions') {
        throw new MockHttpError(405, 'Method Not Allowed', 'HTTP 405: Method Not Allowed');
      }

      throw new Error(`Unhandled URL: ${url}`);
    });

    const report = await verifier.runVerificationPipeline(profile, {
      authToken: 'aid_pat_test_token'
    });

    const modelCall = httpRequestMock.mock.calls.find(([url]) => url === 'http://localhost:3000/v1/models');
    expect(modelCall).toBeDefined();
    expect(modelCall?.[1]).toMatchObject({
      headers: {
        Authorization: 'Bearer aid_pat_test_token'
      }
    });

    const duplicateModelCall = httpRequestMock.mock.calls.find(([url]) => url === 'http://localhost:3000/v1/v1/models');
    expect(duplicateModelCall).toBeUndefined();

    expect(report.steps.find((step) => step.name === 'model-list')?.status).toBe('passed');
    expect(report.steps.find((step) => step.name === 'dialect-validation')?.status).toBe('failed');
    expect(report.steps.find((step) => step.name === 'dialect-validation')?.message).toContain('openai.chat_completions');
  });
});