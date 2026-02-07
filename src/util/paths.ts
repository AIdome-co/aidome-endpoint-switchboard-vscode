/**
 * Path utilities for common file locations.
 */

import * as os from 'os';
import * as path from 'path';

/**
 * Gets the user's home directory.
 * @returns Home directory path
 */
export function getHomedir(): string {
  return os.homedir();
}

/**
 * Gets the user's home directory (alias for compatibility).
 * @returns Home directory path
 */
export function getHomeDir(): string {
  return getHomedir();
}

/**
 * Expands ~ in paths to home directory.
 * @param filePath The file path
 * @returns Expanded path
 */
export function expandTilde(filePath: string): string {
  if (filePath === '~') {
    return getHomedir();
  }
  if (filePath.startsWith('~/')) {
    return path.join(getHomedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Expands ~ in paths to home directory (alias for compatibility).
 * @param filePath The file path
 * @returns Expanded path
 */
export function expandHome(filePath: string): string {
  return expandTilde(filePath);
}

/**
 * Gets platform-specific config directory.
 * @param appName The application name
 * @returns Config directory path
 */
export function getConfigDir(appName: string): string {
  const platform = os.platform();
  
  switch (platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(getHomeDir(), 'AppData', 'Roaming'), appName);
    case 'darwin':
      return path.join(getHomeDir(), 'Library', 'Application Support', appName);
    default:
      return path.join(getHomeDir(), `.${appName.toLowerCase()}`);
  }
}

/**
 * Normalizes a file path.
 * @param filePath The file path
 * @returns Normalized path
 */
export function normalizePath(filePath: string): string {
  return path.normalize(expandTilde(filePath));
}
