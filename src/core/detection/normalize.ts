/**
 * Normalization utilities for assistant and extension IDs.
 */

/**
 * Normalizes an extension ID to lowercase.
 * @param extensionId The extension ID
 * @returns Normalized extension ID
 */
export function normalizeExtensionId(extensionId: string): string {
  return extensionId.toLowerCase();
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
