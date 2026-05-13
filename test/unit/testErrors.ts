/**
 * Test helpers for filesystem-style errors.
 */

/**
 * Creates a Node.js-style ENOENT error for mocked filesystem calls.
 * @returns Error with code set to ENOENT
 */
export function createEnoentError(): Error & { code: 'ENOENT' } {
  return Object.assign(new Error('not found'), { code: 'ENOENT' as const });
}
