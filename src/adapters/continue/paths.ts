/**
 * Path utilities for Continue.dev configuration.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Gets the Continue.dev config directory path.
 * @returns Config directory path
 */
export function getContinueConfigDir(): string {
  return process.env.CONTINUE_GLOBAL_DIR?.trim() || path.join(os.homedir(), '.continue');
}

/**
 * Gets the Continue.dev config file path.
 * Continue.dev prefers config.yaml when it exists and retains config.json as
 * a legacy target. The selected extension determines the typed driver format.
 * @returns Config file path
 */
export function getContinueConfigPath(): string {
  const configDir = getContinueConfigDir();
  const yamlPath = path.join(configDir, 'config.yaml');
  return fs.existsSync(yamlPath) ? yamlPath : path.join(configDir, 'config.json');
}

/** Returns the legacy Continue JSON configuration path. */
export function getContinueJsonConfigPath(): string {
  return path.join(getContinueConfigDir(), 'config.json');
}

/** Returns the current Continue YAML configuration path. */
export function getContinueYamlConfigPath(): string {
  return path.join(getContinueConfigDir(), 'config.yaml');
}

/**
 * Gets the Continue.dev backup directory path.
 * @returns Backup directory path
 */
export function getContinueBackupDir(): string {
  return path.join(getContinueConfigDir(), 'backups');
}
