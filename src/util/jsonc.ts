/**
 * JSON with comments (JSONC) parser utilities.
 */

import { parse as jsoncParse, ParseError, printParseErrorCode } from 'jsonc-parser';

/**
 * Parses JSONC (JSON with comments).
 * Uses Microsoft's jsonc-parser for correct handling of comments
 * inside string values (e.g., URLs containing "//").
 * @param content The JSONC content
 * @returns Parsed object
 * @throws Error if parsing fails
 */
export function parseJsonc<T>(content: string): T {
  const errors: ParseError[] = [];
  const result = jsoncParse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  
  if (errors.length > 0) {
    const firstError = errors[0];
    throw new SyntaxError(
      `JSONC parse error at offset ${firstError.offset}: ${printParseErrorCode(firstError.error)}`
    );
  }
  
  return result as T;
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
