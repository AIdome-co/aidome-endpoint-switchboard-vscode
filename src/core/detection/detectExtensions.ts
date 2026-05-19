/**
 * Extension detection using VS Code's extension API.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
let installedExtensionDirCache: string[] | null = null;

/**
 * Invalidates the extensions cache.
 * Call this when extensions are installed/uninstalled.
 */
export function invalidateExtensionsCache(): void {
  extensionsCache = null;
  installedExtensionDirCache = null;
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

function getInstalledExtensionDirs(): string[] {
  if (installedExtensionDirCache) {
    return installedExtensionDirCache;
  }

  const roots = [
    path.join(os.homedir(), '.vscode', 'extensions'),
    path.join(os.homedir(), '.vscode-insiders', 'extensions'),
    path.join(os.homedir(), '.vscode-server', 'extensions'),
    path.join(os.homedir(), '.vscode-server-insiders', 'extensions')
  ];

  const discovered = new Set<string>();

  for (const root of roots) {
    try {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          discovered.add(path.join(root, entry.name));
        }
      }
    } catch {
      // Ignore missing or unreadable extension directories.
    }
  }

  installedExtensionDirCache = [...discovered];
  return installedExtensionDirCache;
}

function findExtensionOnDisk(normalizedId: string): { version: string } | undefined {
  const candidates = getInstalledExtensionDirs().filter(dir => {
    const folderName = path.basename(dir).toLowerCase();
    return folderName === normalizedId || folderName.startsWith(`${normalizedId}-`);
  });

  for (const candidate of candidates) {
    try {
      const manifestPath = path.join(candidate, 'package.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { version?: string };
      return {
        version: manifest.version || 'unknown'
      };
    } catch {
      // Fall back to folder-name detection only.
      return { version: 'unknown' };
    }
  }

  return undefined;
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

      const installedOnDisk = findExtensionOnDisk(normalizedId);
      if (installedOnDisk) {
        logger.info(`Found ${entry.key}: extension ${extensionId} on disk fallback v${installedOnDisk.version}`);
        detected.push({
          assistantKey: entry.key,
          displayName: entry.displayName,
          extensionId,
          version: installedOnDisk.version,
          isActive: false,
          tier: entry.endpointSwitching.tier,
          kind: entry.kind
        });
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
