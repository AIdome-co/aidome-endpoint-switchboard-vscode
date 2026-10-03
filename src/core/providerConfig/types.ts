/**
 * Shared types for assistant configuration descriptors and drivers.
 *
 * Descriptors describe a provider's configuration contract. They intentionally
 * contain no credential values; credentials are resolved from SecretStorage at
 * apply time by the provider-specific adapter or driver.
 */

/** Supported configuration persistence formats. */
export type ConfigFormat =
  | 'vscode-settings'
  | 'json'
  | 'jsonc'
  | 'yaml'
  | 'toml'
  | 'environment'
  | 'ui';

/** Configuration operation support level. */
export type ProviderConfigSupport = 'automatic' | 'guided' | 'unsupported';

/** Per-capability support level ( finer than provider-level support). */
export type FieldSupport = 'automatic' | 'guided' | 'external' | 'unsupported';

/** Policy for handling credentials during an apply operation. */
export type SecretPolicy =
  | 'secret-storage-only'
  | 'target-persisted-at-apply'
  | 'external-auth-store'
  | 'none';

/** Expected reload behavior after a target is changed. */
export type ReloadPolicy =
  | 'live'
  | 'restart-extension'
  | 'restart-application'
  | 'restart-process'
  | 'unknown';

/** Reusable implementation family for a configuration target. */
export type ConfigDriverKind =
  | 'vscode-setting'
  | 'json-object'
  | 'jsonc-provider-map'
  | 'yaml-model-array'
  | 'toml-table'
  | 'environment-binding'
  | 'external-auth-store'
  | 'guided-ui';

/** Evidence that a descriptor is tied to a known upstream contract. */
export interface VersionEvidence {
  repository: string;
  branch: string;
  commit: string;
  observedAt: string;
  confidence: 'high' | 'medium' | 'low';
  sourcePaths: string[];
}

/** Dialect and optional protocol supported by a target. */
export interface DialectBinding {
  dialect: string;
  protocol?: string;
  preferred?: boolean;
}

/** Candidate configuration location. */
export interface ConfigTargetDescriptor {
  id: string;
  format: ConfigFormat;
  driver: ConfigDriverKind;
  path?: string;
  settingKey?: string;
  environmentVariables?: string[];
  priority: number;
  requiresGuidance?: boolean;
}

/** Typed field binding inside a target. */
export interface ConfigFieldBinding {
  field: 'baseUrl' | 'apiKey' | 'model' | 'provider' | 'protocol' | 'headers' | 'tls';
  path: string;
  valueKind: 'string' | 'object' | 'array-entry' | 'env-binding' | 'ui-only';
  requiredFor: string[];
  secret?: boolean;
  preserveUnknown?: boolean;
  /** Per-capability support level; defaults to the descriptor-level support. */
  support?: FieldSupport;
  /** URL normalization to apply when comparing/writing this field. */
  urlNormalize?: 'openai-base-url';
}

/**
 * Value reference resolved by the descriptor compiler. NEVER carries secret
 * material — credentials stay as symbolic references (env names, authRef).
 */
export type DescriptorValueSource =
  | { type: 'literal'; value: string | number | boolean }
  | { type: 'profile-base-url'; normalize?: 'openai-base-url' }
  /** The first model discovered from the gateway; omitted when none. */
  | { type: 'discovered-model' };

/** A single typed configuration operation declared by a target. */
export type DescriptorOperation =
  /** Assign a value at an exact path. Empty path means the whole document/setting. */
  | { type: 'set'; path: string[]; value: DescriptorValueSource; setWhenMissing?: boolean; mergeObject?: boolean }
  | { type: 'remove'; path: string[] }
  /**
   * Insert or update one entry in a map (e.g. `model_providers.<name>`).
   * `fields` paths are relative to the entry.
   */
  | {
      type: 'upsert-map-entry';
      path: string[];
      entryKey: string;
      fields: Array<{ path: string[]; value: DescriptorValueSource; setWhenMissing?: boolean }>;
    }
  /**
   * Insert or update one entry in an array (e.g. Continue `models[]`).
   * Entries are identified by a stable identity field, never by URL alone.
   */
  | {
      type: 'upsert-array-entry';
      path: string[];
      identityField: 'name' | 'title';
      identityValue: string;
      fields: Array<{ path: (string | number)[]; value: DescriptorValueSource }>;
      /** Optional extra match: an existing entry whose field equals the source. */
      match?: { field: string; equals: DescriptorValueSource };
    };

/** Declarative plan for one target, compiled by the ProviderConfigEngine. */
export interface TargetPlan {
  targetId: string;
  operations: DescriptorOperation[];
  /** Extra data merged verbatim into the emitted plan step (no secrets). */
  stepData?: Record<string, unknown>;
}

/** Model discovery contract for targets that bind a discovered model. */
export interface ModelDiscoveryContract {
  enabled: boolean;
  /** Dialect the discovered model must serve (defaults to the preferred dialect). */
  dialect?: string;
}

/** How a provider's installed/configured target is discovered. */
export interface DiscoveryContract {
  extensionIds?: string[];
  cliCommands?: string[];
  environmentOverrides?: string[];
  notes: string[];
}

/** How a driver should verify its intended binding. */
export interface VerificationContract {
  requiredFields: string[];
  exactUrlMatch: boolean;
  selectedProviderRequired: boolean;
  protocolRequired: boolean;
  notes: string[];
}

/** Maintenance evidence needed to detect upstream drift. */
export interface DriftContract {
  sourceSymbols: string[];
  failClosedOnMissingEvidence: boolean;
  notes: string[];
}

/** Complete provider configuration contract. */
export interface ProviderConfigDescriptor {
  providerKey: string;
  displayName: string;
  dialects: DialectBinding[];
  targets: ConfigTargetDescriptor[];
  fields: ConfigFieldBinding[];
  driver: ConfigDriverKind;
  support: ProviderConfigSupport;
  tier: 'A' | 'B' | 'C';
  secretPolicy: SecretPolicy;
  reload: ReloadPolicy;
  discovery: DiscoveryContract;
  verification: VerificationContract;
  drift: DriftContract;
  versionEvidence: VersionEvidence;
  limitations: string[];
  /** Declarative operations per target; compiled to plan steps by the engine. */
  plan?: TargetPlan[];
  /** Gateway model discovery used to bind a discovered model id (never a secret). */
  modelDiscovery?: ModelDiscoveryContract;
}

/**
 * Stable identity prefix for Switchboard-managed model entries (Continue
 * `models[]` identity, verification). A user entry is only considered
 * Switchboard-managed when its identity field carries this name.
 */
export const AIDOME_MODEL_IDENTITY = 'AIdome Gateway';

/** Runtime options passed to a configuration driver. */
export interface ConfigDriverRequest {
  /** Validated endpoint URL from the active profile. */
  baseUrl: string;
  existingContent?: string;
  format?: ConfigFormat;
  options?: Readonly<Record<string, unknown>>;
  /** Resolved only during apply when the target explicitly needs it. */
  secret?: string;
}

/** A driver that renders one file-backed target. */
export interface ConfigFileDriver {
  readonly kind: ConfigDriverKind;
  render(request: ConfigDriverRequest): string;
}
