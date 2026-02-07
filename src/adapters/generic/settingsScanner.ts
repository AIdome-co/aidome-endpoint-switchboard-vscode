/**
 * Settings scanner for discovering configuration keys.
 */

import * as vscode from 'vscode';

/**
 * Scans extension configuration for matching setting keys.
 * @param extensionId The extension ID
 * @param patterns Array of glob patterns to match
 * @returns Array of matching setting keys
 */
export function scanExtensionSettings(extensionId: string, patterns: string[]): string[] {
  const extension = vscode.extensions.getExtension(extensionId);
  if (!extension) {
    return [];
  }

  const config = extension.packageJSON?.contributes?.configuration;
  if (!config) {
    return [];
  }

  const properties = config.properties || {};
  const keys = Object.keys(properties);
  const matches: string[] = [];

  for (const key of keys) {
    for (const pattern of patterns) {
      if (matchesPattern(key, pattern)) {
        matches.push(key);
        break;
      }
    }
  }

  return matches;
}

/**
 * Matches a key against a glob-style pattern.
 * @param key The key to match
 * @param pattern The pattern (supports * wildcard)
 * @returns True if matches
 */
function matchesPattern(key: string, pattern: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
  return regex.test(key);
}

/**
 * Gets the current value of a setting.
 * @param key The setting key
 * @returns The setting value or undefined
 */
export function getSettingValue(key: string): unknown {
  const config = vscode.workspace.getConfiguration();
  return config.get(key);
}

/**
 * Sets a setting value.
 * @param key The setting key
 * @param value The value to set
 * @param target Configuration target (user, workspace, etc.)
 * @returns Promise resolving when complete
 */
export async function setSettingValue(
  key: string,
  value: unknown,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  await config.update(key, value, target);
}
