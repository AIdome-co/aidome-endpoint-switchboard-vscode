/**
 * Runtime settings for advanced timeouts and limits.
 */

import * as vscode from 'vscode';

const CONFIG_SECTION = 'aidome-switchboard';

export interface VerifierRuntimeSettings {
  tlsTimeoutMs: number;
  endpointReachabilityTimeoutMs: number;
  healthCheckTimeoutMs: number;
  modelListTimeoutMs: number;
  dialectValidationTimeoutMs: number;
  testPromptTimeoutMs: number;
}

export interface RuntimeSettings {
  cliDetectionTimeoutMs: number;
  httpTimeoutMs: number;
  httpRetryBackoffMaxMs: number;
  aidomeClientCacheTtlMs: number;
  logBufferSize: number;
  /** When false, HTTPS requests skip TLS certificate verification (rejectUnauthorized=false). Default: true. */
  tlsVerify: boolean;
  verifier: VerifierRuntimeSettings;
}

export const defaultRuntimeSettings: RuntimeSettings = {
  cliDetectionTimeoutMs: 2_000,
  httpTimeoutMs: 10_000,
  httpRetryBackoffMaxMs: 5_000,
  aidomeClientCacheTtlMs: 60_000,
  logBufferSize: 200,
  tlsVerify: true,
  verifier: {
    tlsTimeoutMs: 5_000,
    endpointReachabilityTimeoutMs: 10_000,
    healthCheckTimeoutMs: 5_000,
    modelListTimeoutMs: 10_000,
    dialectValidationTimeoutMs: 5_000,
    testPromptTimeoutMs: 15_000
  }
};

function getExtensionConfiguration(): vscode.WorkspaceConfiguration | undefined {
  try {
    return vscode.workspace?.getConfiguration(CONFIG_SECTION);
  } catch {
    return undefined;
  }
}

function parseNumber(value: unknown, minimum: number): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= minimum) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= minimum) {
      return parsed;
    }
  }

  return undefined;
}

function readNumberSetting(
  settingKey: string,
  defaultValue: number,
  minimum: number,
  envVar?: string
): number {
  const envValue = envVar ? parseNumber(process.env[envVar], minimum) : undefined;
  if (envValue !== undefined) {
    return envValue;
  }

  const configuration = getExtensionConfiguration();
  const configuredValue = parseNumber(configuration?.get(settingKey), minimum);
  if (configuredValue !== undefined) {
    return configuredValue;
  }

  return defaultValue;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1') {
      return true;
    }
    if (lower === 'false' || lower === '0') {
      return false;
    }
  }
  return undefined;
}

function readBooleanSetting(
  settingKey: string,
  defaultValue: boolean,
  envVar?: string
): boolean {
  const envValue = envVar ? parseBoolean(process.env[envVar]) : undefined;
  if (envValue !== undefined) {
    return envValue;
  }

  const configuration = getExtensionConfiguration();
  const configuredValue = parseBoolean(configuration?.get(settingKey));
  if (configuredValue !== undefined) {
    return configuredValue;
  }

  return defaultValue;
}

/**
 * Returns the current advanced runtime settings, using extension settings by
 * default and environment variables as optional overrides for automation.
 */
export function getRuntimeSettings(): RuntimeSettings {
  return {
    cliDetectionTimeoutMs: readNumberSetting(
      'advanced.cliDetectionTimeoutMs',
      defaultRuntimeSettings.cliDetectionTimeoutMs,
      1,
      'AIDOME_SWITCHBOARD_CLI_DETECTION_TIMEOUT_MS'
    ),
    httpTimeoutMs: readNumberSetting(
      'advanced.httpTimeoutMs',
      defaultRuntimeSettings.httpTimeoutMs,
      1,
      'HTTP_TIMEOUT_MS'
    ),
    httpRetryBackoffMaxMs: readNumberSetting(
      'advanced.httpRetryBackoffMaxMs',
      defaultRuntimeSettings.httpRetryBackoffMaxMs,
      1,
      'AIDOME_SWITCHBOARD_HTTP_RETRY_BACKOFF_MAX_MS'
    ),
    aidomeClientCacheTtlMs: readNumberSetting(
      'advanced.aidomeClientCacheTtlMs',
      defaultRuntimeSettings.aidomeClientCacheTtlMs,
      1,
      'AIDOME_SWITCHBOARD_AIDOME_CLIENT_CACHE_TTL_MS'
    ),
    logBufferSize: readNumberSetting(
      'advanced.logBufferSize',
      defaultRuntimeSettings.logBufferSize,
      1,
      'AIDOME_SWITCHBOARD_LOG_BUFFER_SIZE'
    ),
    tlsVerify: readBooleanSetting(
      'advanced.tlsVerify',
      defaultRuntimeSettings.tlsVerify,
      'AIDOME_SWITCHBOARD_TLS_VERIFY'
    ),
    verifier: {
      tlsTimeoutMs: readNumberSetting(
        'advanced.verifier.tlsTimeoutMs',
        defaultRuntimeSettings.verifier.tlsTimeoutMs,
        1,
        'AIDOME_SWITCHBOARD_VERIFIER_TLS_TIMEOUT_MS'
      ),
      endpointReachabilityTimeoutMs: readNumberSetting(
        'advanced.verifier.endpointReachabilityTimeoutMs',
        defaultRuntimeSettings.verifier.endpointReachabilityTimeoutMs,
        1,
        'AIDOME_SWITCHBOARD_VERIFIER_ENDPOINT_REACHABILITY_TIMEOUT_MS'
      ),
      healthCheckTimeoutMs: readNumberSetting(
        'advanced.verifier.healthCheckTimeoutMs',
        defaultRuntimeSettings.verifier.healthCheckTimeoutMs,
        1,
        'AIDOME_SWITCHBOARD_VERIFIER_HEALTH_CHECK_TIMEOUT_MS'
      ),
      modelListTimeoutMs: readNumberSetting(
        'advanced.verifier.modelListTimeoutMs',
        defaultRuntimeSettings.verifier.modelListTimeoutMs,
        1,
        'AIDOME_SWITCHBOARD_VERIFIER_MODEL_LIST_TIMEOUT_MS'
      ),
      dialectValidationTimeoutMs: readNumberSetting(
        'advanced.verifier.dialectValidationTimeoutMs',
        defaultRuntimeSettings.verifier.dialectValidationTimeoutMs,
        1,
        'AIDOME_SWITCHBOARD_VERIFIER_DIALECT_VALIDATION_TIMEOUT_MS'
      ),
      testPromptTimeoutMs: readNumberSetting(
        'advanced.verifier.testPromptTimeoutMs',
        defaultRuntimeSettings.verifier.testPromptTimeoutMs,
        1,
        'AIDOME_SWITCHBOARD_VERIFIER_TEST_PROMPT_TIMEOUT_MS'
      )
    }
  };
}