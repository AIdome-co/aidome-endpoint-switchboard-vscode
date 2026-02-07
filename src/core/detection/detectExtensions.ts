/**
 * Extension detection using VS Code's extension API.
 */

import * as vscode from 'vscode';

/**
 * Detects installed VS Code extensions.
 * @param extensionIds Array of extension IDs to check
 * @returns Array of installed extension IDs
 */
export function detectExtensions(extensionIds: string[]): string[] {
  const installed: string[] = [];
  
  for (const id of extensionIds) {
    const extension = vscode.extensions.getExtension(id);
    if (extension) {
      installed.push(id);
    }
  }
  
  return installed;
}

/**
 * Gets extension version if installed.
 * @param extensionId The extension ID
 * @returns Extension version or undefined
 */
export function getExtensionVersion(extensionId: string): string | undefined {
  const extension = vscode.extensions.getExtension(extensionId);
  return extension?.packageJSON?.version;
}

/**
 * Checks if an extension is active.
 * @param extensionId The extension ID
 * @returns True if extension is active
 */
export function isExtensionActive(extensionId: string): boolean {
  const extension = vscode.extensions.getExtension(extensionId);
  return extension?.isActive ?? false;
}

/**
 * Gets all installed AI coding assistants.
 * @returns Array of installed assistant extension IDs
 */
export function getAllInstalledAssistants(): string[] {
  const knownAssistants = [
    'GitHub.copilot',
    'GitHub.copilot-chat',
    'saoudrizwan.claude-dev',
    'RooVeterinaryInc.roo-cline',
    'Continue.continue',
    'CodeGPT.codegpt',
    'TabNine.tabnine-vscode',
    'anthropic.claude-code',
    'kilocode.kilo-code'
  ];
  
  return detectExtensions(knownAssistants);
}
