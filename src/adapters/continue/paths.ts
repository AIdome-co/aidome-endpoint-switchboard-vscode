/**
 * Path utilities for Continue.dev configuration.
 */

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
 * Gets the Continue.dev config file path.
 * @returns Config file path
 */
export function getContinueConfigPath(): string {
  return path.join(getContinueConfigDir(), 'config.json');
}

/**
 * Gets the Continue.dev backup directory path.
 * @returns Backup directory path
 */
export function getContinueBackupDir(): string {
  return path.join(getContinueConfigDir(), 'backups');
}
