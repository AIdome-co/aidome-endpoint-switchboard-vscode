/**
 * Unit tests for verifier auth propagation, versioned URL handling, and
 * dialect probe behavior.
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

  it('uses a POST probe for chat-completions dialect validation', async () => {
    profile.dialect = 'openai.chat_completions';

    httpRequestMock.mockImplementation(async (url: string, options?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
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

      if (url === 'http://localhost:3000/v1/chat/completions') {
        expect(options?.method).toBe('POST');
        expect(options?.body).toEqual({});
        expect(options?.headers).toMatchObject({
          Authorization: 'Bearer aid_pat_test_token'
        });

        throw new MockHttpError(400, 'Bad Request', 'HTTP 400: Bad Request');
      }

      throw new Error(`Unhandled URL: ${url}`);
    });

    const report = await verifier.runVerificationPipeline(profile, {
      authToken: 'aid_pat_test_token'
    });

    expect(report.steps.find((step) => step.name === 'dialect-validation')).toMatchObject({
      status: 'passed',
      message: 'Validated dialect via /v1/chat/completions (HTTP 400)'
    });
  });
});