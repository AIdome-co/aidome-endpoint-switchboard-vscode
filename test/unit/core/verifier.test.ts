/**
 * Unit tests for verifier auth propagation, versioned URL handling, and
 * dialect probe behavior.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Verifier } from '../../../src/core/orchestration/verifier';
import { EndpointProfile } from '../../../src/core/profiles/profileTypes';

const {
  dnsLookupMock,
  httpRequestMock,
  MockHttpError,
  mockConfigGet,
  mockLoggerDebug,
  mockLoggerError,
  mockLoggerInfo,
  mockLoggerWarning
} = vi.hoisted(() => ({
  dnsLookupMock: vi.fn(),
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

vi.mock('dns/promises', () => ({
  lookup: dnsLookupMock
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
    dnsLookupMock.mockReset();
    dnsLookupMock.mockResolvedValue({ address: '127.0.0.1', family: 4 });
    mockConfigGet.mockReset();
    mockLoggerDebug.mockReset();
    mockLoggerError.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarning.mockReset();
  });

  it('uses the stored auth token and avoids duplicate /v1 segments for model-list probes', async () => {
    let baseUrlCalls = 0;
    httpRequestMock.mockImplementation(async (url: string) => {
      if (url === 'http://localhost:3000/v1') {
        baseUrlCalls += 1;
        if (baseUrlCalls === 1) {
          return {
            status: 200,
            statusText: 'OK',
            headers: {},
            body: {}
          };
        }

        throw new Error(sensitiveError);
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


  it('keeps dialect validation skip output generic while debug logs include details', async () => {
    profile.dialect = 'openai.responses';
    const sensitiveError = 'connect ECONNREFUSED https://token.example.com/v1?api_key=secret at /home/user/config.json';

    let baseUrlCalls = 0;
    httpRequestMock.mockImplementation(async (url: string) => {
      if (url === 'http://localhost:3000/v1') {
        baseUrlCalls += 1;
        if (baseUrlCalls === 1) {
          return {
            status: 200,
            statusText: 'OK',
            headers: {},
            body: {}
          };
        }

        throw new Error(sensitiveError);
      }

      if (url === 'http://localhost:3000/v1/models') {
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: { data: [{ id: 'gpt-4' }] }
        };
      }

      if (url === 'http://localhost:3000/v1/responses') {
        throw new Error('dialect endpoint unreachable');
      }

      throw new Error(sensitiveError);
    });

    const report = await verifier.runVerificationPipeline(profile, {
      authToken: 'aid_pat_test_token'
    });

    const dialectStep = report.steps.find((step) => step.name === 'dialect-validation');
    expect(dialectStep).toMatchObject({
      status: 'skipped',
      message: 'Could not validate dialect (endpoint unreachable)'
    });
    expect(dialectStep?.message).not.toContain('token.example.com');
    expect(dialectStep?.message).not.toContain('secret');
    expect(dialectStep?.message).not.toContain('/home/user/config.json');
    expect(mockLoggerDebug).toHaveBeenCalledWith(`Dialect validation failed: ${sensitiveError}`);
  });

  it('uses dns.lookup for non-localhost DNS resolution', async () => {
    profile.baseUrl = 'http://gateway.example.com';
    profile.dialect = 'openai.chat_completions';

    httpRequestMock.mockImplementation(async (url: string) => {
      if (url === 'http://gateway.example.com') {
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          body: {}
        };
      }

      if (url === 'http://gateway.example.com/health') {
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          body: { status: 'healthy' }
        };
      }

      if (url === 'http://gateway.example.com/v1/models') {
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: { data: [{ id: 'anthropic/claude-sonnet-4-6' }] }
        };
      }

      if (url === 'http://gateway.example.com/v1/chat/completions') {
        throw new MockHttpError(400, 'Bad Request', 'HTTP 400: Bad Request');
      }

      throw new Error(`Unhandled URL: ${url}`);
    });

    const report = await verifier.runVerificationPipeline(profile, {
      authToken: 'aid_pat_test_token'
    });

    expect(dnsLookupMock).toHaveBeenCalledWith('gateway.example.com');
    expect(report.steps.find((step) => step.name === 'dns-resolution')).toMatchObject({
      status: 'passed',
      message: 'Hostname resolved successfully'
    });
  });

  it('reports partial verification as warnings instead of failure', async () => {
    profile.baseUrl = 'http://gateway.example.com';
    profile.dialect = 'openai.chat_completions';
    dnsLookupMock.mockRejectedValueOnce(new Error('lookup failed'));

    httpRequestMock.mockImplementation(async (url: string) => {
      if (url === 'http://gateway.example.com') {
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          body: {}
        };
      }

      if (url === 'http://gateway.example.com/health') {
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          body: { status: 'healthy' }
        };
      }

      if (url === 'http://gateway.example.com/v1/models') {
        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: { data: [{ id: 'anthropic/claude-sonnet-4-6' }] }
        };
      }

      if (url === 'http://gateway.example.com/v1/chat/completions') {
        throw new MockHttpError(400, 'Bad Request', 'HTTP 400: Bad Request');
      }

      throw new Error(`Unhandled URL: ${url}`);
    });

    const result = await verifier.verifyEndpoint(profile, false, 'aid_pat_test_token');

    expect(result.status).toBe('partial');
    expect(result.actionableMessage).toContain('Verification completed with warnings');
    expect(result.actionableMessage).not.toContain('Verification failed');
    expect(result.checks.find((check) => check.name === 'dns-resolution')?.status).toBe('fail');
    expect(result.checks.find((check) => check.name === 'tls-verification')?.status).toBe('warn');
  });
});