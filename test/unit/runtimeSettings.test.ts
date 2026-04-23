/**
 * Unit tests for runtime settings resolution.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultRuntimeSettings, getRuntimeSettings } from '../../src/config/runtimeSettings';

const mockConfiguration = {
  get: vi.fn()
};

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => mockConfiguration)
  }
}));

describe('runtime settings', () => {
  const originalEnv = {
    cliDetectionTimeoutMs: process.env.AIDOME_SWITCHBOARD_CLI_DETECTION_TIMEOUT_MS,
    httpTimeoutMs: process.env.HTTP_TIMEOUT_MS,
    httpRetryBackoffMaxMs: process.env.AIDOME_SWITCHBOARD_HTTP_RETRY_BACKOFF_MAX_MS,
    aidomeClientCacheTtlMs: process.env.AIDOME_SWITCHBOARD_AIDOME_CLIENT_CACHE_TTL_MS,
    logBufferSize: process.env.AIDOME_SWITCHBOARD_LOG_BUFFER_SIZE,
    tlsTimeoutMs: process.env.AIDOME_SWITCHBOARD_VERIFIER_TLS_TIMEOUT_MS,
    endpointReachabilityTimeoutMs: process.env.AIDOME_SWITCHBOARD_VERIFIER_ENDPOINT_REACHABILITY_TIMEOUT_MS,
    healthCheckTimeoutMs: process.env.AIDOME_SWITCHBOARD_VERIFIER_HEALTH_CHECK_TIMEOUT_MS,
    modelListTimeoutMs: process.env.AIDOME_SWITCHBOARD_VERIFIER_MODEL_LIST_TIMEOUT_MS,
    dialectValidationTimeoutMs: process.env.AIDOME_SWITCHBOARD_VERIFIER_DIALECT_VALIDATION_TIMEOUT_MS,
    testPromptTimeoutMs: process.env.AIDOME_SWITCHBOARD_VERIFIER_TEST_PROMPT_TIMEOUT_MS,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfiguration.get.mockReturnValue(undefined);
    delete process.env.AIDOME_SWITCHBOARD_CLI_DETECTION_TIMEOUT_MS;
    delete process.env.HTTP_TIMEOUT_MS;
    delete process.env.AIDOME_SWITCHBOARD_HTTP_RETRY_BACKOFF_MAX_MS;
    delete process.env.AIDOME_SWITCHBOARD_AIDOME_CLIENT_CACHE_TTL_MS;
    delete process.env.AIDOME_SWITCHBOARD_LOG_BUFFER_SIZE;
    delete process.env.AIDOME_SWITCHBOARD_VERIFIER_TLS_TIMEOUT_MS;
    delete process.env.AIDOME_SWITCHBOARD_VERIFIER_ENDPOINT_REACHABILITY_TIMEOUT_MS;
    delete process.env.AIDOME_SWITCHBOARD_VERIFIER_HEALTH_CHECK_TIMEOUT_MS;
    delete process.env.AIDOME_SWITCHBOARD_VERIFIER_MODEL_LIST_TIMEOUT_MS;
    delete process.env.AIDOME_SWITCHBOARD_VERIFIER_DIALECT_VALIDATION_TIMEOUT_MS;
    delete process.env.AIDOME_SWITCHBOARD_VERIFIER_TEST_PROMPT_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env.AIDOME_SWITCHBOARD_CLI_DETECTION_TIMEOUT_MS = originalEnv.cliDetectionTimeoutMs;
    process.env.HTTP_TIMEOUT_MS = originalEnv.httpTimeoutMs;
    process.env.AIDOME_SWITCHBOARD_HTTP_RETRY_BACKOFF_MAX_MS = originalEnv.httpRetryBackoffMaxMs;
    process.env.AIDOME_SWITCHBOARD_AIDOME_CLIENT_CACHE_TTL_MS = originalEnv.aidomeClientCacheTtlMs;
    process.env.AIDOME_SWITCHBOARD_LOG_BUFFER_SIZE = originalEnv.logBufferSize;
    process.env.AIDOME_SWITCHBOARD_VERIFIER_TLS_TIMEOUT_MS = originalEnv.tlsTimeoutMs;
    process.env.AIDOME_SWITCHBOARD_VERIFIER_ENDPOINT_REACHABILITY_TIMEOUT_MS = originalEnv.endpointReachabilityTimeoutMs;
    process.env.AIDOME_SWITCHBOARD_VERIFIER_HEALTH_CHECK_TIMEOUT_MS = originalEnv.healthCheckTimeoutMs;
    process.env.AIDOME_SWITCHBOARD_VERIFIER_MODEL_LIST_TIMEOUT_MS = originalEnv.modelListTimeoutMs;
    process.env.AIDOME_SWITCHBOARD_VERIFIER_DIALECT_VALIDATION_TIMEOUT_MS = originalEnv.dialectValidationTimeoutMs;
    process.env.AIDOME_SWITCHBOARD_VERIFIER_TEST_PROMPT_TIMEOUT_MS = originalEnv.testPromptTimeoutMs;
  });

  it('should return defaults when no overrides are configured', () => {
    const settings = getRuntimeSettings();

    expect(settings).toEqual(defaultRuntimeSettings);
  });

  it('should read numeric overrides from extension settings', () => {
    const configuredValues: Record<string, number> = {
      'advanced.cliDetectionTimeoutMs': 3500,
      'advanced.httpTimeoutMs': 12000,
      'advanced.httpRetryBackoffMaxMs': 2500,
      'advanced.aidomeClientCacheTtlMs': 90000,
      'advanced.logBufferSize': 75,
      'advanced.verifier.tlsTimeoutMs': 4500,
      'advanced.verifier.endpointReachabilityTimeoutMs': 11000,
      'advanced.verifier.healthCheckTimeoutMs': 4200,
      'advanced.verifier.modelListTimeoutMs': 12500,
      'advanced.verifier.dialectValidationTimeoutMs': 4300,
      'advanced.verifier.testPromptTimeoutMs': 18000
    };
    mockConfiguration.get.mockImplementation((key: string) => configuredValues[key]);

    const settings = getRuntimeSettings();

    expect(settings.cliDetectionTimeoutMs).toBe(3500);
    expect(settings.httpTimeoutMs).toBe(12000);
    expect(settings.httpRetryBackoffMaxMs).toBe(2500);
    expect(settings.aidomeClientCacheTtlMs).toBe(90000);
    expect(settings.logBufferSize).toBe(75);
    expect(settings.verifier).toEqual({
      tlsTimeoutMs: 4500,
      endpointReachabilityTimeoutMs: 11000,
      healthCheckTimeoutMs: 4200,
      modelListTimeoutMs: 12500,
      dialectValidationTimeoutMs: 4300,
      testPromptTimeoutMs: 18000
    });
  });

  it('should let environment variables override extension settings', () => {
    mockConfiguration.get.mockImplementation((key: string) => {
      if (key === 'advanced.cliDetectionTimeoutMs') {
        return 3200;
      }
      if (key === 'advanced.httpTimeoutMs') {
        return 8000;
      }
      return undefined;
    });
    process.env.AIDOME_SWITCHBOARD_CLI_DETECTION_TIMEOUT_MS = '4100';
    process.env.HTTP_TIMEOUT_MS = '15000';

    const settings = getRuntimeSettings();

    expect(settings.cliDetectionTimeoutMs).toBe(4100);
    expect(settings.httpTimeoutMs).toBe(15000);
  });

  it('should ignore invalid overrides and fall back to defaults', () => {
    mockConfiguration.get.mockImplementation((key: string) => {
      if (key === 'advanced.logBufferSize') {
        return 0;
      }
      return undefined;
    });
    process.env.AIDOME_SWITCHBOARD_HTTP_RETRY_BACKOFF_MAX_MS = 'not-a-number';

    const settings = getRuntimeSettings();

    expect(settings.logBufferSize).toBe(defaultRuntimeSettings.logBufferSize);
    expect(settings.httpRetryBackoffMaxMs).toBe(defaultRuntimeSettings.httpRetryBackoffMaxMs);
  });
});