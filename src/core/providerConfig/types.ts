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
}

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
