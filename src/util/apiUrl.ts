/**
 * URL path-joining utility for AIdome API endpoints.
 */

/**
 * Joins a base URL with a relative API path, normalizing slashes so there
 * is exactly one `/` between the base and the path segment. When the base URL
 * already includes a version or route prefix also present at the start of the
 * appended path, the overlapping prefix is deduplicated.
 *
 * @param base - The base URL (e.g. `https://gateway.example.com` or `https://gateway.example.com/`).
 * @param path - The relative path to append (e.g. `/v1/models` or `v1/models`).
 * @returns The joined URL string with no double slashes in the seam.
 */
export function joinApiPath(base: string, path: string): string {
  const url = new URL(base);
  const baseSegments = url.pathname.split('/').filter(Boolean);
  const pathSegments = path.split('/').filter(Boolean);

  const maxOverlap = Math.min(baseSegments.length, pathSegments.length);
  let overlap = 0;

  for (let size = maxOverlap; size > 0; size -= 1) {
    const baseSuffix = baseSegments.slice(-size);
    const pathPrefix = pathSegments.slice(0, size);
    if (baseSuffix.join('/') === pathPrefix.join('/')) {
      overlap = size;
      break;
    }
  }

  const mergedSegments = [...baseSegments, ...pathSegments.slice(overlap)];
  url.pathname = mergedSegments.length > 0 ? `/${mergedSegments.join('/')}` : '/';
  return url.toString();
}
