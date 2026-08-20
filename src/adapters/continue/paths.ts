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
 * Gets the primary Continue.dev config path.
 *
 * Prefer an existing YAML config, then an existing JSON config, and use YAML
 * for a fresh install.
 * @returns Primary config file path
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
