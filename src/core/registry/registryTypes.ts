/**
 * Type definitions for the assistant registry system.
 * These types represent the structure of assistants.registry.json and related metadata.
 */

/**
 * Configuration hint for file-based configuration.
 */
export interface ConfigFileHint {
  path: string;
  format: 'json' | 'yaml' | 'toml';
  fields: string[];
}

/**
 * Configuration hint for settings-based configuration.
 */
export interface ConfigHint {
  settingKeyHints?: string[];
  configFileHints?: ConfigFileHint[];
  envVarHints?: string[];
}

/**
 * Endpoint switching configuration for an assistant.
 */
export interface EndpointSwitchingConfig {
  supported: boolean | 'partially' | 'enterprise-server-only';
  tier: 'A' | 'B' | 'C';
  preferredGatewayFrontDoor?: string;
  configurationModes: string[];
  settingKeyHints?: string[];
  configFileHints?: ConfigFileHint[];
  envVarHints?: string[];
  notes: string[];
}

/**
 * Detection configuration for an assistant.
 */
export interface DetectionConfig {
  vscodeExtensionIds?: string[];
  cliCommands?: string[];
  notes?: string[];
}

/**
 * Dialect configuration for an assistant.
 */
export interface DialectConfig {
  primary: string;
  alsoPossible: string[];
}

/**
 * Individual assistant entry in the registry.
 */
export interface AssistantEntry {
  key: string;
  displayName: string;
  kind: string;
  detection: DetectionConfig;
  dialect: DialectConfig;
  endpointSwitching: EndpointSwitchingConfig;
  sources: string[];
}

/**
 * Catalog of supported dialects with descriptions.
 */
export interface DialectCatalog {
  [dialectKey: string]: string;
}

/**
 * Complete assistant registry structure.
 */
export interface AssistantRegistry {
  $schemaVersion: string;
  updatedAt: string;
  dialectCatalog: DialectCatalog;
  assistants: AssistantEntry[];
}
