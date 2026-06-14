/**
 * Unit tests for BaseExtensionAdapter and formatUnknownError.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatUnknownError, BaseExtensionAdapter } from '../../src/adapters/BaseExtensionAdapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import { Plan, createPlan } from '../../src/core/orchestration/planBuilder';
import { VerificationResult } from '../../src/adapters/AssistantAdapter';

const { mockGetExtension, mockLoggerError } = vi.hoisted(() => ({
  mockGetExtension: vi.fn(),
  mockLoggerError: vi.fn()
}));

vi.mock('vscode', () => ({
  extensions: {
    getExtension: mockGetExtension
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn()
    }))
  }
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: mockLoggerError,
      warning: vi.fn(),
      info: vi.fn()
    })
  }
}));

class ConcreteAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'test.extension-id';
  verifyFn: (() => Promise<VerificationResult>) | undefined;

  async buildPlan(_profile: EndpointProfile): Promise<Plan> {
    return createPlan('test', ['test']);
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    if (this.verifyFn) {
      return this.verifyFn();
    }
    return { success: true, message: 'ok', details: {} };
  }

  getDisplayName(): string {
    return 'Test';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}

describe('formatUnknownError', () => {
  it('formats Error instances with name and message', () => {
    expect(formatUnknownError(new Error('something broke'))).toBe('Error: something broke');
  });

  it('formats TypeError instances preserving the error name', () => {
    expect(formatUnknownError(new TypeError('bad type'))).toBe('TypeError: bad type');
  });

  it('formats string throwables via String()', () => {
    expect(formatUnknownError('raw string')).toBe('raw string');
  });

  it('formats number throwables via String()', () => {
    expect(formatUnknownError(42)).toBe('42');
  });

  it('formats null throwables via String()', () => {
    expect(formatUnknownError(null)).toBe('null');
  });

  it('formats undefined throwables via String()', () => {
    expect(formatUnknownError(undefined)).toBe('undefined');
  });

  it('formats object throwables via String()', () => {
    expect(formatUnknownError({ code: 'ENOENT' })).toBe('[object Object]');
  });
});

describe('BaseExtensionAdapter', () => {
  let adapter: ConcreteAdapter;

  beforeEach(() => {
    adapter = new ConcreteAdapter();
    mockGetExtension.mockReset();
    mockLoggerError.mockReset();
  });

  describe('detect', () => {
    it('handles non-Error throwables without producing undefined messages', async () => {
      mockGetExtension.mockImplementation(() => {
        throw 'string error';
      });
      const result = await adapter.detect();

      expect(result).toBe(false);
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error detecting Test: string error',
        expect.any(Error)
      );
      const loggedError = mockLoggerError.mock.calls[0][1] as Error;
      expect(loggedError.message).toBe('string error');
    });

    it('handles null throwables safely', async () => {
      mockGetExtension.mockImplementation(() => {
        throw null;
      });
      const result = await adapter.detect();

      expect(result).toBe(false);
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error detecting Test: null',
        expect.any(Error)
      );
    });

    it('handles Error throwables with name preserved', async () => {
      mockGetExtension.mockImplementation(() => {
        throw new TypeError('bad extension id');
      });
      const result = await adapter.detect();

      expect(result).toBe(false);
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error detecting Test: TypeError: bad extension id',
        expect.any(TypeError)
      );
    });
  });

  describe('verify', () => {
    it('handles non-Error throwables without undefined message', async () => {
      adapter.verifyFn = async () => {
        throw 'string failure';
      };
      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Error verifying Test config: string failure');
      expect(result.details?.error).toBe('string failure');
    });

    it('handles null throwables without undefined message', async () => {
      adapter.verifyFn = async () => {
        throw null;
      };
      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Error verifying Test config: null');
      expect(result.details?.error).toBe('null');
    });

    it('handles Error throwables with message only in details', async () => {
      adapter.verifyFn = async () => {
        throw new Error('verify failed');
      };
      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Error verifying Test config: verify failed');
      expect(result.details?.error).toBe('verify failed');
    });
  });
});
