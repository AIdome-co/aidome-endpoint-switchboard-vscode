/**
 * Path utilities for Continue.dev configuration.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Gets the Continue.dev config directory path.
 * @returns Config directory path
 */
export function getContinueConfigDir(): string {
  return path.join(os.homedir(), '.continue');
}

/**
 * Gets the legacy Continue.dev JSON config path.
 * @returns JSON config file path
 */
export function getContinueConfigJsonPath(): string {
  return path.join(getContinueConfigDir(), 'config.json');
}

/**
 * Gets the current Continue.dev YAML config path.
 * @returns YAML config file path
 */
export function getContinueConfigYamlPath(): string {
  return path.join(getContinueConfigDir(), 'config.yaml');
}

/**
 * Gets Continue.dev runtime flags path.
 * @returns Continue RC file path
 */
export function getContinueRcPath(): string {
  return path.join(getContinueConfigDir(), '.continuerc.json');
}

/**
 * Gets the primary Continue.dev config file path.
 *
 * Continue still supports config.json, but newer installs prefer config.yaml.
 * Match Continue's own behavior by preferring config.yaml when it exists, using
 * config.json only when YAML is absent, and defaulting to config.yaml for fresh
 * installs where neither file exists yet.
 *
 * @returns Primary Continue config file path
 */
export function getContinueConfigPath(): string {
  const yamlPath = getContinueConfigYamlPath();
  if (fs.existsSync(yamlPath)) {
    return yamlPath;
  }

  const jsonPath = getContinueConfigJsonPath();
  if (fs.existsSync(jsonPath)) {
    return jsonPath;
  }

  return yamlPath;
}

/**
 * Gets the Continue.dev backup directory path.
 * @returns Backup directory path
 */
export function getContinueBackupDir(): string {
  return path.join(getContinueConfigDir(), 'backups');
}
