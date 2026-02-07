/**
 * Extension detection using VS Code's extension API.
 */

import * as vscode from 'vscode';
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
 * Detects installed VS Code extensions from registry.
 * @param registry The assistant registry
 * @returns Array of detected assistants
 */
export function detectExtensions(registry: AssistantRegistry): DetectedAssistant[] {
  const detected: DetectedAssistant[] = [];
  
  for (const entry of registry.assistants) {
    const extensionIds = entry.detection.vscodeExtensionIds || [];
    
    for (const extensionId of extensionIds) {
      const extension = vscode.extensions.getExtension(normalizeExtensionId(extensionId));
      if (extension) {
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
