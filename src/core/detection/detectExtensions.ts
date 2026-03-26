/**
 * Extension detection using VS Code's extension API.
 */

import * as vscode from 'vscode';
import { Logger } from '../../util/log';
import { AssistantRegistry, AssistantEntry } from '../registry/registryTypes';

/**
 * Detected assistant information.
 */
export interface DetectedAssistant {
  assistantKey: string;
  displayName: string;
  extensionId: string;
  version: string;
  isActive: boolean;
  tier: 'A' | 'B' | 'C';
  kind: string;
}

/**
 * Cache for vscode.extensions.all to avoid repeated lookups.
 */
let extensionsCache: readonly vscode.Extension<any>[] | null = null;

/**
 * Invalidates the extensions cache.
 * Call this when extensions are installed/uninstalled.
 */
export function invalidateExtensionsCache(): void {
  extensionsCache = null;
}

/**
 * Gets all extensions with caching.
 * @returns Array of all extensions
 */
function getAllExtensions(): readonly vscode.Extension<any>[] {
  if (!extensionsCache) {
    extensionsCache = vscode.extensions.all;
  }
  return extensionsCache;
}

/**
 * Initializes extension change listeners to invalidate cache.
 * Should be called during extension activation.
 * @param context Extension context
 */
export function initializeExtensionCaching(context: vscode.ExtensionContext): void {
  // Listen for extension changes
  const disposable = vscode.extensions.onDidChange(() => {
    invalidateExtensionsCache();
  });
  
  context.subscriptions.push(disposable);
}

/**
 * Detects installed VS Code extensions from registry.
 * @param registry The assistant registry
 * @returns Array of detected assistants
 */
export function detectExtensions(registry: AssistantRegistry): DetectedAssistant[] {
  const detected: DetectedAssistant[] = [];
  const allExtensions = getAllExtensions();
  const logger = Logger.getInstance().scoped('Detection');
  
  for (const entry of registry.assistants) {
    const extensionIds = entry.detection.vscodeExtensionIds || [];
    logger.debug(`Checking registry entry: ${entry.key} against ${extensionIds.length} extension ID(s)`);
    
    for (const extensionId of extensionIds) {
      const normalizedId = normalizeExtensionId(extensionId);
      const extension = allExtensions.find(ext => ext.id.toLowerCase() === normalizedId);
      
      if (extension) {
        logger.debug(`Found ${entry.key}: extension ${extensionId} v${extension.packageJSON?.version}`);
        detected.push({
          assistantKey: entry.key,
          displayName: entry.displayName,
          extensionId: extensionId,
          version: extension.packageJSON?.version || 'unknown',
          isActive: extension.isActive,
          tier: entry.endpointSwitching.tier,
          kind: entry.kind
        });
        // Only detect once per assistant (use first matching extension ID)
        break;
      }
    }
  }
  
  return detected;
}

/**
 * Gets extension version if installed.
 * @param extensionId The extension ID
 * @returns Extension version or undefined
 */
export function getExtensionVersion(extensionId: string): string | undefined {
  const extension = vscode.extensions.getExtension(normalizeExtensionId(extensionId));
  return extension?.packageJSON?.version;
}

/**
 * Checks if an extension is active.
 * @param extensionId The extension ID
 * @returns True if extension is active
 */
export function isExtensionActive(extensionId: string): boolean {
  const extension = vscode.extensions.getExtension(normalizeExtensionId(extensionId));
  return extension?.isActive ?? false;
}

/**
 * Normalizes extension ID to lowercase.
 * @param extensionId The extension ID
 * @returns Normalized extension ID
 */
function normalizeExtensionId(extensionId: string): string {
  return extensionId.toLowerCase().trim();
}
