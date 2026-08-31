/**
 * Extension detection using VS Code's extension API.
 */

import * as vscode from 'vscode';
import { Logger } from '../../util/log';
import { AssistantRegistry, AssistantEntry } from '../registry/registryTypes';
import { ExtensionIdResolver } from './extensionIdResolver';

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
 * Default resolver singleton shared across detection calls so marketplace
 * lookups are performed at most once per assistant per session.
 */
let defaultResolver: ExtensionIdResolver | undefined;

function getDefaultResolver(): ExtensionIdResolver {
  if (!defaultResolver) {
    defaultResolver = new ExtensionIdResolver();
  }
  return defaultResolver;
}

/**
 * Detects installed VS Code extensions from registry.
 *
 * Fast path matches each assistant's declared extension IDs against the
 * installed extensions. When no declared ID matches an installed extension,
 * the resolver falls back to resolving the canonical ID from the marketplace
 * (e.g. when a declared ID is stale or wrong) before giving up. Resolver
 * results are cached so the marketplace is queried at most once per assistant
 * per session.
 *
 * @param registry The assistant registry
 * @param resolver Injectable resolver for testability (defaults to a cached
 *   marketplace-backed resolver).
 * @returns Promise resolving to detected assistants
 */
export async function detectExtensions(
  registry: AssistantRegistry,
  resolver: ExtensionIdResolver = getDefaultResolver()
): Promise<DetectedAssistant[]> {
  const allExtensions = getAllExtensions();
  const logger = Logger.getInstance().scoped('Detection');
  
  logger.info(`Scanning ${allExtensions.length} VS Code extensions: ${allExtensions.map(e => e.id).join(', ')}`);

  const detectionResults = await Promise.all(registry.assistants.map(async (entry) => {
    const extensionIds = entry.detection.vscodeExtensionIds || [];
    logger.debug(`Checking registry entry: ${entry.key} against ${extensionIds.length} extension ID(s)`);

    // Fast path: match declared IDs directly against installed extensions.
    const declaredMatch = matchExtension(entry, extensionIds, allExtensions);
    if (declaredMatch) {
      return declaredMatch;
    }

    // Fallback path: a declared ID did not match an installed extension. Ask the
    // resolver for the canonical ID(s) (resolved from the market when the
    // declared ID is stale), and try those before declaring the assistant absent.
    let resolution;
    try {
      resolution = await resolver.resolveForAssistant(entry);
    } catch (error) {
      logger.warning(
        `Could not resolve extension ID(s) for ${entry.key}: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
    const resolvedIds = resolution.resolvedIds.some(id => extensionIds.includes(id))
      ? extensionIds
      : resolution.resolvedIds.filter(id => !extensionIds.includes(id));

    if (resolvedIds.length > 0) {
      logger.debug(`No declared ID matched for ${entry.key}; trying resolved ID(s) via ${resolution.status}: ${resolvedIds.join(', ')}`);
      const resolvedMatch = matchExtension(entry, resolvedIds, allExtensions);
      if (resolvedMatch) {
        return resolvedMatch;
      }
    }

    return undefined;
  }));

  return detectionResults.filter((result): result is DetectedAssistant => result !== undefined);
}

/**
 * Attempts to match an assistant against the installed extensions by candidate IDs.
 */
function matchExtension(
  entry: AssistantEntry,
  candidates: string[],
  allExtensions: readonly vscode.Extension<any>[]
): DetectedAssistant | undefined {
  const logger = Logger.getInstance().scoped('Detection');

  for (const extensionId of candidates) {
    const normalizedId = normalizeExtensionId(extensionId);
    const extension = allExtensions.find(ext => ext.id.toLowerCase() === normalizedId);
    
    if (extension) {
      logger.debug(`Found ${entry.key}: extension ${extensionId} v${extension.packageJSON?.version}`);
      return {
        assistantKey: entry.key,
        displayName: entry.displayName,
        extensionId: extensionId,
        version: extension.packageJSON?.version || 'unknown',
        isActive: extension.isActive,
        tier: entry.endpointSwitching.tier,
        kind: entry.kind
      };
    }
  }
  return undefined;
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
