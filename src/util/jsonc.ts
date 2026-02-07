/**
 * JSON with comments (JSONC) parser utilities.
 */

/**
 * Parses JSONC (JSON with comments).
 * @param content The JSONC content
 * @returns Parsed object
 */
export function parseJsonc<T>(content: string): T {
  // Remove single-line comments
  let cleaned = content.replace(/\/\/.*$/gm, '');
  
  // Remove multi-line comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  
  return JSON.parse(cleaned) as T;
}

/**
 * Stringifies to JSONC (preserves formatting).
 * @param obj The object to stringify
 * @param indent Indentation (default: 2)
 * @returns JSONC string
 */
export function stringifyJsonc(obj: unknown, indent = 2): string {
  return JSON.stringify(obj, null, indent);
}

/**
 * Safely parses JSONC.
 * @param content The JSONC content
 * @returns Parsed object or undefined on error
 */
export function safeParseJsonc<T>(content: string): T | undefined {
  try {
    return parseJsonc<T>(content);
  } catch {
    return undefined;
  }
}
