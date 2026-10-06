/** Shared driver helpers for typed VS Code settings. */

/**
 * Safely merges a nested property into an object setting.
 *
 * @param current Current effective setting value
 * @param path Nested property path from the descriptor
 * @param value New value
 * @returns A new setting object with unrelated properties preserved
 */
export function mergeObjectSetting(
  current: unknown,
  path: string[],
  value: unknown
): Record<string, unknown> {
  const output = isRecord(current) ? cloneRecord(current) : {};
  if (path.length === 0 || path.some(isUnsafeSegment)) {
    throw new Error('VS Code setting descriptor contains an invalid property path');
  }

  let target = output;
  for (const segment of path.slice(0, -1)) {
    const nested = target[segment];
    target[segment] = isRecord(nested) ? cloneRecord(nested) : {};
    target = target[segment] as Record<string, unknown>;
  }
  target[path[path.length - 1]] = value;
  return output;
}

/** Reads a typed nested property from an object setting. */
export function readObjectSetting(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    isRecord(item) ? cloneRecord(item) : item
  ]));
}

function isUnsafeSegment(value: string): boolean {
  return value.length === 0 || value === '__proto__' || value === 'constructor' || value === 'prototype';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
