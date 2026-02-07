/**
 * HTTP utilities for making requests.
 */

/**
 * Makes an HTTP GET request.
 * @param url The URL to fetch
 * @param headers Optional headers
 * @returns Promise resolving to response data
 */
export async function httpGet<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json() as T;
}

/**
 * Makes an HTTP POST request.
 * @param url The URL to post to
 * @param data The data to post
 * @param headers Optional headers
 * @returns Promise resolving to response data
 */
export async function httpPost<T>(
  url: string,
  data: unknown,
  headers?: Record<string, string>
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json() as T;
}

/**
 * Checks if a URL is reachable.
 * @param url The URL to check
 * @returns Promise resolving to true if reachable
 */
export async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}
