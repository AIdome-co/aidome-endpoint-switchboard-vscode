/**
 * Unit tests for BaseExtensionAdapter throwable handling.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseExtensionAdapter } from '../../src/adapters/BaseExtensionAdapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import { Plan } from '../../src/core/orchestration/planBuilder';
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

class ThrowingAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'test.throwing';

  constructor(private readonly verifyThrowable: unknown) {
    super();
  }

  async buildPlan(_profile: EndpointProfile): Promise<Plan> {
    return { profileId: 'profile', assistantKeys: ['test'], steps: [] };
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    throw this.verifyThrowable;
  }

  getDisplayName(): string {
    return 'Throwing Adapter';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}

describe('BaseExtensionAdapter', () => {
  beforeEach(() => {
    mockGetExtension.mockReset();
    mockLoggerError.mockReset();
  });

  it('detect handles non-Error throwables without undefined messages', async () => {
    const adapter = new ThrowingAdapter(new Error('unused'));
    mockGetExtension.mockImplementation(() => {
      throw 'lookup failed';
    });

    const result = await adapter.detect();

    expect(result).toBe(false);
    expect(mockLoggerError).toHaveBeenCalledWith(
      'Error detecting Throwing Adapter: lookup failed',
      undefined,
      { error: 'lookup failed' }
    );
  });

  it('verify handles non-Error throwables without undefined messages', async () => {
    const adapter = new ThrowingAdapter('verify failed');

    const result = await adapter.verify();

    expect(result.success).toBe(false);
    expect(result.message).toBe('Error verifying Throwing Adapter config: verify failed');
    expect(result.message).not.toContain('undefined');
    expect(result.details).toEqual({ error: 'verify failed' });
  });
});
