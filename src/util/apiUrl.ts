/**
 * Utilities for joining API base URLs and endpoint paths without duplicating
 * version segments such as `/v1`.
 */

/**
 * Joins a base URL with an API path while avoiding duplicate leading version
 * segments when the base URL already points at a versioned API root.
 */
export function joinApiPath(baseUrl: string, apiPath: string): string {
  const normalizedBase = baseUrl.replace(/\/$/, '');
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const baseEndsWithVersion = /\/v\d+$/i.test(normalizedBase);
  const pathStartsWithVersion = /^\/v\d+(?=\/|$)/i.test(normalizedPath);

  if (baseEndsWithVersion && pathStartsWithVersion) {
    return `${normalizedBase}${normalizedPath.replace(/^\/v\d+/i, '')}`;
  }

  return `${normalizedBase}${normalizedPath}`;
}