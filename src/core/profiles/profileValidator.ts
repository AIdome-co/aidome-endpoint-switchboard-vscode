/**
 * Validation utilities for endpoint profiles.
 * Validates URLs, API keys, and other profile configuration.
 */

/**
 * Validates an endpoint URL.
 * @param url The URL to validate
 * @returns True if valid, false otherwise
 */
export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates a profile name.
 * @param name The profile name
 * @returns True if valid, false otherwise
 */
export function validateProfileName(name: string): boolean {
  return name.length > 0 && name.length <= 100;
}

/**
 * Validates an API key format.
 * @param apiKey The API key to validate
 * @returns True if valid, false otherwise
 */
export function validateApiKey(apiKey: string): boolean {
  // Basic validation - non-empty and reasonable length
  return apiKey.length >= 8 && apiKey.length <= 512;
}

/**
 * Sanitizes a URL for display (removes sensitive query params).
 * @param url The URL to sanitize
 * @returns Sanitized URL string
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove common sensitive parameters
    parsed.searchParams.delete('api_key');
    parsed.searchParams.delete('apiKey');
    parsed.searchParams.delete('token');
    parsed.searchParams.delete('secret');
    return parsed.toString();
  } catch {
    return url;
  }
}
