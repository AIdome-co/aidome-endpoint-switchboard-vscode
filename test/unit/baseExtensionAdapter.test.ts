/**
 * Unit tests for BaseExtensionAdapter throwable handling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseExtensionAdapter, formatUnknownError } from '../../src/adapters/BaseExtensionAdapter';
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

  it('formats non-Error throwables via String()', () => {
    expect(formatUnknownError('raw string')).toBe('raw string');
    expect(formatUnknownError(42)).toBe('42');
    expect(formatUnknownError(null)).toBe('null');
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
        undefined,
        { error: 'string error' }
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
      expect(result.details).toEqual({ error: 'string failure' });
    });
  });
});
