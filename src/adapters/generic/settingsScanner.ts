/**
 * Settings scanner for discovering configuration keys.
 */

import * as vscode from 'vscode';

/**
 * Confidence score for a matched setting key.
 */
export interface SettingMatch {
  key: string;
  confidence: number; // 0-1 scale
  reason: string;
}

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
 * Scans extension configuration with confidence scoring.
 * @param extensionId The extension ID
 * @param patterns Array of glob patterns to match
 * @returns Array of matches with confidence scores
 */
export function scanExtensionSettingsWithConfidence(
  extensionId: string,
  patterns: string[]
): SettingMatch[] {
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
  const matches: SettingMatch[] = [];

  for (const key of keys) {
    const score = calculateConfidence(key, patterns);
    if (score > 0) {
      matches.push({
        key,
        confidence: score,
        reason: getConfidenceReason(key, patterns)
      });
    }
  }

  // Sort by confidence (highest first)
  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Discovers base URL related settings for any extension using heuristics.
 * @param extensionId The extension ID
 * @returns Array of potential base URL settings with confidence scores
 */
export function discoverBaseUrlSettings(extensionId: string): SettingMatch[] {
  const heuristics = [
    // High confidence patterns
    { pattern: '*baseUrl*', weight: 1.0 },
    { pattern: '*base_url*', weight: 1.0 },
    { pattern: '*apiBase*', weight: 0.95 },
    { pattern: '*api_base*', weight: 0.95 },
    { pattern: '*endpoint*', weight: 0.9 },
    { pattern: '*apiUrl*', weight: 0.85 },
    { pattern: '*api_url*', weight: 0.85 },
    // Medium confidence patterns
    { pattern: '*serverUrl*', weight: 0.7 },
    { pattern: '*server_url*', weight: 0.7 },
    { pattern: '*host*', weight: 0.6 },
    { pattern: '*url*', weight: 0.5 },
  ];

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
  const matches: SettingMatch[] = [];

  for (const key of keys) {
    let maxConfidence = 0;
    let bestPattern = '';

    for (const heuristic of heuristics) {
      if (matchesPattern(key, heuristic.pattern)) {
        if (heuristic.weight > maxConfidence) {
          maxConfidence = heuristic.weight;
          bestPattern = heuristic.pattern;
        }
      }
    }

    if (maxConfidence > 0) {
      matches.push({
        key,
        confidence: maxConfidence,
        reason: `Matches pattern ${bestPattern} (${(maxConfidence * 100).toFixed(0)}% confidence)`
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Discovers provider-related settings for any extension.
 * @param extensionId The extension ID
 * @returns Array of potential provider settings with confidence scores
 */
export function discoverProviderSettings(extensionId: string): SettingMatch[] {
  const heuristics = [
    { pattern: '*provider*', weight: 1.0 },
    { pattern: '*llmProvider*', weight: 0.95 },
    { pattern: '*aiProvider*', weight: 0.95 },
    { pattern: '*modelProvider*', weight: 0.95 },
    { pattern: '*backend*', weight: 0.7 },
  ];

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
  const matches: SettingMatch[] = [];

  for (const key of keys) {
    let maxConfidence = 0;
    let bestPattern = '';

    for (const heuristic of heuristics) {
      if (matchesPattern(key, heuristic.pattern)) {
        if (heuristic.weight > maxConfidence) {
          maxConfidence = heuristic.weight;
          bestPattern = heuristic.pattern;
        }
      }
    }

    if (maxConfidence > 0) {
      matches.push({
        key,
        confidence: maxConfidence,
        reason: `Matches pattern ${bestPattern} (${(maxConfidence * 100).toFixed(0)}% confidence)`
      });
    }
  }

  return matches.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Calculates confidence score for a key matching patterns.
 * @param key The setting key
 * @param patterns Array of patterns
 * @returns Confidence score (0-1)
 */
function calculateConfidence(key: string, patterns: string[]): number {
  for (const pattern of patterns) {
    if (matchesPattern(key, pattern)) {
      // Higher confidence for exact matches, lower for wildcards
      const wildcardCount = (pattern.match(/\*/g) || []).length;
      return Math.max(0.5, 1.0 - (wildcardCount * 0.2));
    }
  }
  return 0;
}

/**
 * Gets a human-readable reason for confidence score.
 * @param key The setting key
 * @param patterns Array of patterns
 * @returns Confidence reason
 */
function getConfidenceReason(key: string, patterns: string[]): string {
  for (const pattern of patterns) {
    if (matchesPattern(key, pattern)) {
      return `Matches pattern: ${pattern}`;
    }
  }
  return 'No match';
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

