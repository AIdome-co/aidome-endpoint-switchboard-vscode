/**
 * ID normalization and aliasing for assistant detection.
 */

/**
 * Known extension ID aliases/forks that map to canonical keys.
 */
const EXTENSION_ALIASES: Record<string, string> = {
  // Cline forks and aliases
  'saoudrizwan.claude-dev': 'cline',
  'cline.cline': 'cline',
  
  // Roo Code variants
  'rooveterinaryinc.roo-cline': 'roo-code',
  
  // Continue variants
  'continue.continue': 'continue',
  
  // Kilo Code variants
  'kilocode.kilo-code': 'kilo-code',
  
  // GitHub Copilot
  'github.copilot': 'github-copilot',
  'github.copilot-chat': 'github-copilot',
  
  // Claude Code
  'anthropic.claude-code': 'claude-code',
  
  // CodeGPT
  'codegpt.codegpt': 'codegpt',
  
  // Tabnine
  'tabnine.tabnine-vscode': 'tabnine'
};

/**
 * Normalizes an extension ID to lowercase.
 * @param extensionId The extension ID
 * @returns Normalized extension ID
 */
export function normalizeExtensionId(extensionId: string): string {
  return extensionId.toLowerCase();
}

/**
 * Maps an extension ID to its canonical assistant key.
 * @param extensionId The extension ID
 * @returns Canonical assistant key or the normalized extension ID if no mapping exists
 */
export function mapExtensionToAssistantKey(extensionId: string): string {
  const normalized = normalizeExtensionId(extensionId);
  return EXTENSION_ALIASES[normalized] || normalized;
}

/**
 * Normalizes an assistant key.
 * @param assistantKey The assistant key
 * @returns Normalized assistant key
 */
export function normalizeAssistantKey(assistantKey: string): string {
  return assistantKey.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * Normalizes a CLI command name.
 * @param command The command name
 * @returns Normalized command name
 */
export function normalizeCliCommand(command: string): string {
  return command.toLowerCase().trim();
}

/**
 * Extracts publisher and extension name from ID.
 * @param extensionId The extension ID (format: publisher.extension)
 * @returns Object with publisher and extension name
 */
export function parseExtensionId(extensionId: string): { publisher: string; extension: string } {
  const [publisher, extension] = extensionId.split('.');
  return { publisher, extension };
}

/**
 * Creates a fully qualified extension ID.
 * @param publisher The publisher name
 * @param extension The extension name
 * @returns Fully qualified extension ID
 */
export function makeExtensionId(publisher: string, extension: string): string {
  return `${publisher}.${extension}`;
}
