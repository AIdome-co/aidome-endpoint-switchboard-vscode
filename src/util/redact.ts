/**
 * Redaction utilities for sensitive data.
 */

/**
 * Redacts an API key for display.
 * @param apiKey The API key
 * @param visibleChars Number of visible characters at start
 * @returns Redacted string
 */
export function redactApiKey(apiKey: string, visibleChars = 4): string {
  if (apiKey.length <= visibleChars) {
    return '***';
  }
  
  const visible = apiKey.substring(0, visibleChars);
  return `${visible}${'*'.repeat(Math.min(apiKey.length - visibleChars, 20))}`;
}

/**
 * Redacts sensitive data from an object.
 * @param obj The object to redact
 * @param sensitiveKeys Array of key names to redact
 * @returns Redacted object
 */
export function redactObject<T extends Record<string, unknown>>(
  obj: T,
  sensitiveKeys: string[] = ['apiKey', 'api_key', 'token', 'secret', 'password']
): T {
  const result = { ...obj };
  
  for (const key in result) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
      const value = result[key];
      if (typeof value === 'string') {
        result[key] = redactApiKey(value) as T[Extract<keyof T, string>];
      }
    }
  }
  
  return result;
}

/**
 * Redacts URLs containing sensitive query parameters.
 * @param url The URL
 * @returns Redacted URL
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const sensitiveParams = ['api_key', 'apiKey', 'token', 'secret'];
    
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        const value = parsed.searchParams.get(param) || '';
        parsed.searchParams.set(param, redactApiKey(value));
      }
    }
    
    return parsed.toString();
  } catch {
    return url;
  }
}
