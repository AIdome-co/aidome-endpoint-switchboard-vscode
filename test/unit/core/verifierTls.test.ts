/**
 * Unit tests for TLS verification behavior.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dnsResolveMock,
  httpRequestMock,
  httpsRequestMock,
  mockConfigGet,
  mockLoggerDebug,
  mockLoggerError,
  mockLoggerInfo,
  mockLoggerWarning
} = vi.hoisted(() => ({
  dnsResolveMock: vi.fn(),
  httpRequestMock: vi.fn(),
  httpsRequestMock: vi.fn(),
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

vi.mock('dns/promises', () => ({
  resolve: dnsResolveMock
}));

vi.mock('https', () => ({
  request: httpsRequestMock
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

vi.mock('../../../src/util/http', () => ({
  httpRequest: httpRequestMock,
  HttpError: class extends Error {
    constructor(
      public status: number,
      public statusText: string,
      message: string
    ) {
      super(message);
      this.name = 'HttpError';
    }
  }
}));

describe('Verifier TLS verification', () => {
  beforeEach(() => {
    dnsResolveMock.mockReset();
    httpRequestMock.mockReset();
    httpsRequestMock.mockReset();
    mockConfigGet.mockReset();
    mockLoggerDebug.mockReset();
    mockLoggerError.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarning.mockReset();
  });

  it('passes TLS verification when the handshake is authorized but certificate metadata is unavailable', async () => {
    dnsResolveMock.mockResolvedValue(['203.0.113.10']);

    httpsRequestMock.mockImplementation((options: unknown, callback: (res: { socket: unknown }) => void) => {
      const request = {
        destroy: vi.fn(),
        end: vi.fn(() => {
          callback({
            socket: {
              authorized: true,
              authorizationError: undefined,
              getPeerCertificate: () => ({})
            }
          });
        }),
        on: vi.fn(() => request)
      };

      return request;
    });

    httpRequestMock.mockImplementation(async (url: string) => {
      if (url === 'https://example.com') {
        return {
          status: 200,
          statusText: 'OK',
          headers: {},
          body: {}
        };
      }

      throw new Error(`Unhandled URL: ${url}`);
    });

    const { Verifier } = await import('../../../src/core/orchestration/verifier');

    const verifier = new Verifier();
    const report = await verifier.runVerificationPipeline({
      id: 'profile-1',
      name: 'tls-test',
      profileType: 'custom',
      baseUrl: 'https://example.com',
      dialect: 'unknown',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const tlsStep = report.steps.find((step) => step.name === 'tls-verification');
    expect(tlsStep?.status).toBe('passed');
    expect(tlsStep?.message).toContain('certificate details unavailable');
  });
});