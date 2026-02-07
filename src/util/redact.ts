/**
 * Redaction utilities for sensitive data.
 */

/**
 * Common secret patterns to detect and redact.
 */
const SECRET_PATTERNS = [
  /Bearer\s+[\w\-._~+/]+=*/gi,                    // Bearer tokens
  /sk-[a-zA-Z0-9]{32,}/gi,                         // OpenAI API keys (sk-...)
  /sk-proj-[a-zA-Z0-9_-]{32,}/gi,                  // OpenAI project keys
  /sk-ant-[a-zA-Z0-9_-]{32,}/gi,                   // Anthropic API keys
  /\b[A-Za-z0-9]{32,}\b/g,                         // Generic long alphanumeric (potential keys)
  /api[_-]?key[\s:=]+[\w\-._~+/]+=*/gi,           // API key patterns
  /x-api-key[\s:]+[\w\-._~+/]+=*/gi,              // x-api-key header values
  /password[\s:=]+\S+/gi,                          // Password patterns
  /token[\s:=]+[\w\-._~+/]+=*/gi,                 // Token patterns
];

/**
 * Redacts sensitive information from a string.
 * Scans for common secret patterns and replaces them with asterisks.
 * @param input The input string
 * @returns Redacted string
 */
export function redactString(input: string): string {
  let result = input;
  
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match) => {
      // Keep the prefix if it's a header or key identifier
      if (match.toLowerCase().includes('bearer')) {
        return 'Bearer ***';
      }
      if (match.toLowerCase().includes('api-key') || match.toLowerCase().includes('api_key')) {
        return 'api-key: ***';
      }
      if (match.toLowerCase().includes('x-api-key')) {
        return 'x-api-key: ***';
      }
      if (match.toLowerCase().startsWith('sk-')) {
        return match.substring(0, 7) + '***';
      }
      if (match.toLowerCase().includes('password')) {
        return 'password: ***';
      }
      if (match.toLowerCase().includes('token')) {
        return 'token: ***';
      }
      // For long alphanumeric strings, only redact if they look like keys (32+ chars)
      if (match.length >= 32 && /^[A-Za-z0-9]+$/.test(match)) {
        return '***';
      }
      return match; // Keep non-sensitive matches
    });
  }
  
  return result;
}

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
