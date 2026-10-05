/**
 * Discriminated plan-step data model.
 *
 * The engine and adapters must emit step payloads that match one of these
 * shapes. `PlanStep.data` remains `Record<string, unknown>` for backward
 * compatibility with serialized plans, but `validatePlanStepData` re-derives
 * the discriminated type at apply entry so invalid combinations fail with an
 * actionable error BEFORE any mutation — instead of surfacing deep inside a
 * driver (or worse, succeeding vacuously).
 *
 * Invalid combinations that must be unrepresentable / rejected:
 * - TOML driver without a provider name
 * - Responses wire API anything other than 'responses' (the only supported wire)
 * - JSON object driver without a patches array
 * - JSONC provider-map driver without a provider ID
 * - environment binding without an environment variable name
 */

/** Data for `edit-config-file` steps carrying a typed driver payload. */
export type ConfigFileStepData =
  | JsonObjectStepData
  | JsoncProviderMapStepData
  | YamlModelArrayStepData
  | TomlTableStepData;

export interface PlanStepDataCommon {
  descriptorKey?: string;
  configPath?: string;
  profileId?: string;
  baseUrl?: string;
  /** The applier owns backup-before-atomic-write; this is preview metadata. */
  backupRequired?: boolean;
  [key: string]: unknown;
}

export interface JsonObjectStepData extends PlanStepDataCommon {
  driver: 'json-object';
  format: 'json' | 'jsonc';
  patches: ReadonlyArray<Record<string, unknown>>;
  removePaths?: ReadonlyArray<string[]>;
}

export interface JsoncProviderMapStepData extends PlanStepDataCommon {
  driver: 'jsonc-provider-map';
  mapPath: string[];
  providerId: string;
  baseUrlPath: string[];
  defaults: Record<string, unknown>;
  models?: Record<string, unknown>;
}

export interface YamlModelArrayStepData extends PlanStepDataCommon {
  driver: 'yaml-model-array';
  format: 'yaml' | 'jsonc';
  /** Stable Switchboard-managed entry identity. */
  identity?: string;
  provider?: string;
  useResponsesApi?: boolean;
}

export interface TomlTableStepData extends PlanStepDataCommon {
  driver: 'toml-table';
  format: 'toml';
  providerName: string;
  wireApi: 'responses';
  envKey?: string;
  model?: string;
}

export interface SetVscodeSettingStepData {
  settingKey: string;
  value: unknown;
  scope?: 'workspace' | 'global';
  driver?: 'vscode-setting';
  [key: string]: unknown;
}

export interface SetEnvVarStepData {
  envVarName: string;
  envVarValue: string;
  [key: string]: unknown;
}

/**
 * Typed data for a generic `write-env-file` step (GAP 2): a reusable
 * operation for any provider with an upstream-supported dotenv target.
 * The secret is resolved by the applier immediately before writing and
 * never appears in the plan itself.
 */
export interface WriteEnvFileStepData {
  envVarName: string;
  authRef?: string;
  /** REQUIRED: an explicit persistence policy is mandatory for any step that resolves a secret from storage and persists it to disk. */
  secretPolicy: 'target-persisted-at-apply';
  profileName?: string;
  preserveUnknown?: boolean;
  [key: string]: unknown;
}

export type PlanStepData =
  | ConfigFileStepData
  | SetVscodeSettingStepData
  | SetEnvVarStepData
  | WriteEnvFileStepData
  | Record<string, unknown>;

/** Validation failure with an actionable message. */
export interface PlanStepDataValidation {
  ok: boolean;
  error?: string;
}

/** Data keys that identify structured config-file step payloads. */
const CONFIG_METADATA_KEYS: ReadonlySet<string> = new Set([
  'configPath',
  'configType',
  'baseUrl',
  'format',
  'patches',
  'removePaths',
  'providerName',
  'providerId',
  'mapPath',
  'wireApi',
  'envKey',
  'identity',
  'models',
  'profileId'
]);

/**
 * Validates an edit-config-file step's data at apply entry.
 *
 * Driver-less step data is ONLY accepted when it carries no structured
 * configuration metadata (the true legacy pre-built-content pattern, e.g.
 * `step.newValue` holding pre-rendered content). A record that declares
 * config metadata (baseUrl, configPath, format, provider name, …) WITHOUT a
 * driver is rejected: the applier would otherwise fall back to writing
 * `step.newValue` verbatim, which historically replaced an entire TOML/JSON
 * config file with the raw base URL.
 */
/**
 * Detects structured configuration metadata in driver-less step data.
 * Shared with the applier so validation and the write path agree.
 */
export function hasConfigMetadata(data: unknown): boolean {
  return isRecord(data) && Object.keys(data).some(key => CONFIG_METADATA_KEYS.has(key));
}

/** Validates an edit-config-file step's data at apply entry. */
export function validateConfigFileStepData(data: unknown): PlanStepDataValidation {
  if (!isRecord(data)) {
    // Legacy raw-value steps (no data at all) write step.newValue verbatim
    // and remain supported.
    return { ok: true };
  }
  if (typeof data.driver !== 'string') {
    if (hasConfigMetadata(data)) {
      return {
        ok: false,
        error: 'config-file step declares configuration metadata but no driver — plans must declare a typed driver (json-object, jsonc-provider-map, yaml-model-array, toml-table) instead of relying on the verbatim raw-value fallback'
      };
    }
    return { ok: true };
  }

  switch (data.driver) {
    case 'toml-table': {
      if (typeof data.providerName !== 'string' || data.providerName.trim().length === 0) {
        return { ok: false, error: 'TOML driver requires a provider name' };
      }
      if (data.wireApi !== undefined && data.wireApi !== 'responses') {
        return { ok: false, error: `TOML wire API must be 'responses', received ${JSON.stringify(data.wireApi)}` };
      }
      return { ok: true };
    }
    case 'json-object': {
      if (!Array.isArray(data.patches)) {
        return { ok: false, error: 'JSON object driver requires a patches array' };
      }
      return { ok: true };
    }
    case 'jsonc-provider-map': {
      if (typeof data.providerId !== 'string' || data.providerId.trim().length === 0) {
        return { ok: false, error: 'JSONC provider-map driver requires a provider ID' };
      }
      return { ok: true };
    }
    case 'yaml-model-array': {
      if (data.format !== 'yaml' && data.format !== 'jsonc') {
        return { ok: false, error: 'yaml-model-array driver requires format yaml or jsonc' };
      }
      return { ok: true };
    }
    default:
      return { ok: false, error: `Unknown configuration driver: ${data.driver}` };
  }
}

/** Validates a write-env-file step's data at apply entry. */
export function validateWriteEnvFileStepData(data: unknown): PlanStepDataValidation {
  if (!isRecord(data)) {
    return { ok: false, error: 'write-env-file step requires data' };
  }
  if (typeof data.envVarName !== 'string' || data.envVarName.trim().length === 0) {
    return { ok: false, error: 'write-env-file requires a non-empty environment variable name' };
  }
  if (data.authRef !== undefined && (typeof data.authRef !== 'string' || data.authRef.trim().length === 0)) {
    return { ok: false, error: 'write-env-file authRef must be a non-empty string when provided' };
  }
  // GAP 13: fail closed — persisting a secret to disk without a declared
  // policy must be rejected at apply entry, not silently defaulted.
  if (typeof data.secretPolicy !== 'string' || data.secretPolicy.trim().length === 0) {
    return { ok: false, error: 'write-env-file requires an explicit secretPolicy ("target-persisted-at-apply") when persisting a credential' };
  }
  if (data.secretPolicy !== 'target-persisted-at-apply') {
    return { ok: false, error: 'write-env-file secretPolicy must be "target-persisted-at-apply"' };
  }
  return { ok: true };
}

/** Validates a set-env-var step's data at apply entry. */
export function validateSetEnvVarStepData(data: unknown): PlanStepDataValidation {
  if (!isRecord(data)) {
    return { ok: true };
  }
  if (data.envVarName !== undefined && (typeof data.envVarName !== 'string' || data.envVarName.trim().length === 0)) {
    return { ok: false, error: 'environment binding requires a non-empty environment variable name' };
  }
  return { ok: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
