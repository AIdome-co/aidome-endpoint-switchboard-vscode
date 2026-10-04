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

export type PlanStepData =
  | ConfigFileStepData
  | SetVscodeSettingStepData
  | SetEnvVarStepData
  | Record<string, unknown>;

/** Validation failure with an actionable message. */
export interface PlanStepDataValidation {
  ok: boolean;
  error?: string;
}

/** Validates an edit-config-file step's data at apply entry. */
export function validateConfigFileStepData(data: unknown): PlanStepDataValidation {
  if (!isRecord(data)) {
    // Legacy raw-value steps (no data at all) write step.newValue verbatim
    // and remain supported.
    return { ok: true };
  }
  if (typeof data.driver !== 'string') {
    // Driver-less data is the pre-built-content pattern (e.g. Claude Code):
    // the applier writes step.newValue as-is.
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
  if (typeof data.targetPath !== 'string' || data.targetPath.trim().length === 0) {
    return { ok: false, error: 'write-env-file requires a target .env file path' };
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
