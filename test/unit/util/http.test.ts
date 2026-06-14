/**
 * Unit tests for src/util/http.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
    })),
  },
}));

vi.mock('../../../src/config/runtimeSettings', () => ({
  getRuntimeSettings: () => ({
    httpTimeoutMs: 10_000,
    httpRetryBackoffMaxMs: 5_000,
    tlsVerify: true,
    verifier: {
      healthCheckTimeoutMs: 5_000,
    },
  }),
}));

class MockIncomingMessage extends EventEmitter {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;

  constructor(status: number, statusMessage: string, headers: Record<string, string> = {}) {
    super();
    this.statusCode = status;
    this.statusMessage = statusMessage;
    this.headers = headers;
  }
}

class MockClientRequest extends EventEmitter {
  writtenData: string | undefined;
  destroyed = false;
  options: any;

  write(data: string) {
    this.writtenData = data;
  }

  end() {
    // no-op
  }

  destroy() {
    this.destroyed = true;
  }
}

function createSuccessMock(body: unknown = { success: true }, status = 200, statusText = 'OK') {
  return (opts: any, callback: any) => {
    const req = new MockClientRequest();
    req.options = opts;
    setTimeout(() => {
      const res = new MockIncomingMessage(status, statusText);
      callback(res);
      res.emit('data', Buffer.from(JSON.stringify(body)));
      res.emit('end');
    }, 0);
    return req as any;
  };
}

function createErrorMock(errorMsg: string) {
  return (_opts: any, _callback: any) => {
    const req = new MockClientRequest();
    setTimeout(() => {
      req.emit('error', new Error(errorMsg));
    }, 0);
    return req as any;
  };
}

function createTimeoutMock() {
  return (_opts: any, _callback: any) => {
    const req = new MockClientRequest();
    setTimeout(() => {
      req.emit('timeout');
    }, 0);
    return req as any;
  };
}

function createHttpErrorMock(status: number, statusText: string) {
  return (_opts: any, callback: any) => {
    const req = new MockClientRequest();
    setTimeout(() => {
      const res = new MockIncomingMessage(status, statusText);
      callback(res);
      res.emit('data', Buffer.from(''));
      res.emit('end');
    }, 0);
    return req as any;
  };
}

vi.mock('http', () => ({
  request: vi.fn(),
}));

vi.mock('https', () => ({
  request: vi.fn(),
}));

import { httpRequest, httpGet, httpPost, isUrlReachable, HttpError } from '../../../src/util/http';
import * as http from 'http';
import * as https from 'https';

describe('HttpError', () => {
  it('has correct properties', () => {
    const err = new HttpError(503, 'Service Unavailable', 'Server down');
    expect(err.status).toBe(503);
    expect(err.statusText).toBe('Service Unavailable');
    expect(err.message).toBe('Server down');
    expect(err.name).toBe('HttpError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('httpRequest', () => {
  const proxyKeys = ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy'] as const;
  let originalProxyEnv: Record<(typeof proxyKeys)[number], string | undefined>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(http.request).mockReset();
    vi.mocked(https.request).mockReset();
    originalProxyEnv = {} as Record<(typeof proxyKeys)[number], string | undefined>;
    for (const key of proxyKeys) {
      originalProxyEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of proxyKeys) {
      if (originalProxyEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalProxyEnv[key];
      }
    }
    vi.useRealTimers();
  });

  it('makes a GET request to http URL', async () => {
    vi.mocked(http.request).mockImplementation(createSuccessMock());

    const promise = httpRequest('http://example.com/api');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(http.request).toHaveBeenCalled();
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true });
  });

  it('makes a GET request to https URL', async () => {
    vi.mocked(https.request).mockImplementation(createSuccessMock({ secure: true }));

    const promise = httpRequest('https://secure.example.com/api');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(https.request).toHaveBeenCalled();
    expect(result.body).toEqual({ secure: true });
  });

  it('sends POST body as JSON', async () => {
    let capturedReq: MockClientRequest | undefined;
    vi.mocked(http.request).mockImplementation((opts: any, callback: any) => {
      const req = new MockClientRequest();
      req.options = opts;
      capturedReq = req;
      setTimeout(() => {
        const res = new MockIncomingMessage(201, 'Created');
        callback(res);
        res.emit('data', Buffer.from(JSON.stringify({ id: 1 })));
        res.emit('end');
      }, 0);
      return req as any;
    });

    const promise = httpRequest('http://example.com/api', {
      method: 'POST',
      body: { name: 'test' },
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe(201);
    expect(capturedReq?.writtenData).toBe(JSON.stringify({ name: 'test' }));
  });

  it('rejects with HttpError on 4xx responses', async () => {
    vi.mocked(http.request).mockImplementation(createHttpErrorMock(404, 'Not Found'));

    const promise = httpRequest('http://example.com/missing');
    // Attach handler before advancing timers to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow(HttpError);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('does not retry 4xx errors', async () => {
    vi.mocked(http.request).mockImplementation(createHttpErrorMock(400, 'Bad Request'));

    const promise = httpRequest('http://example.com/bad', { retries: 3 });
    const assertion = expect(promise).rejects.toThrow(HttpError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(vi.mocked(http.request).mock.calls.length).toBe(1);
  });

  it('retries on network errors', async () => {
    let callCount = 0;
    vi.mocked(http.request).mockImplementation((_opts: any, callback: any) => {
      callCount++;
      const req = new MockClientRequest();
      const currentCall = callCount;
      setTimeout(() => {
        if (currentCall < 2) {
          req.emit('error', new Error('ECONNRESET'));
        } else {
          const res = new MockIncomingMessage(200, 'OK');
          callback(res);
          res.emit('data', Buffer.from(JSON.stringify({ ok: true })));
          res.emit('end');
        }
      }, 0);
      return req as any;
    });

    const promise = httpRequest('http://example.com/api', { retries: 2 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.status).toBe(200);
    expect(callCount).toBe(2);
  });

  it('rejects on timeout', async () => {
    vi.mocked(http.request).mockImplementation(createTimeoutMock());

    const promise = httpRequest('http://example.com/slow', { timeout: 100, retries: 0 });
    const assertion = expect(promise).rejects.toThrow(/timeout/i);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('rejects on network error', async () => {
    vi.mocked(http.request).mockImplementation(createErrorMock('ECONNREFUSED'));

    const promise = httpRequest('http://example.com/down', { retries: 0 });
    const assertion = expect(promise).rejects.toThrow(/Network error/);
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('uses proxy from options', async () => {
    vi.mocked(http.request).mockImplementation(createSuccessMock());

    const promise = httpRequest('http://example.com/api', {
      proxy: 'http://proxy.local:8080',
    });
    await vi.runAllTimersAsync();
    await promise;

    const lastCall = vi.mocked(http.request).mock.lastCall;
    const callArgs = lastCall?.[0] as any;
    expect(callArgs.hostname).toBe('proxy.local');
    expect(callArgs.path).toBe('http://example.com/api');
  });
});

describe('httpGet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(http.request).mockReset();
    vi.mocked(https.request).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns response body', async () => {
    vi.mocked(http.request).mockImplementation(createSuccessMock({ data: 'fetched' }));

    const promise = httpGet('http://example.com/data');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual({ data: 'fetched' });
  });
});

describe('httpPost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(http.request).mockReset();
    vi.mocked(https.request).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends data and returns body', async () => {
    vi.mocked(http.request).mockImplementation(createSuccessMock({ created: true }, 201, 'Created'));

    const promise = httpPost('http://example.com/submit', { key: 'value' });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toEqual({ created: true });
  });
});

describe('isUrlReachable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(http.request).mockReset();
    vi.mocked(https.request).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when URL is reachable', async () => {
    vi.mocked(http.request).mockImplementation(createSuccessMock());

    const promise = isUrlReachable('http://example.com');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(true);
  });

  it('returns false when URL is not reachable', async () => {
    vi.mocked(http.request).mockImplementation(createErrorMock('ECONNREFUSED'));

    const promise = isUrlReachable('http://down.example.com');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(false);
  });
});
