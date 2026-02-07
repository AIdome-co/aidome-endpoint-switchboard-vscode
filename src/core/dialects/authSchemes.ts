/**
 * Authentication scheme implementations for different dialects.
 */

import { AuthScheme } from './dialectTypes';

/**
 * Auth configuration for an API request.
 */
export interface AuthConfig {
  scheme: AuthScheme;
  apiKey?: string;
  token?: string;
  customHeaders?: Record<string, string>;
}

/**
 * Applies authentication to HTTP headers.
 * @param headers Existing headers object
 * @param config Auth configuration
 * @returns Headers with authentication applied
 */
export function applyAuth(headers: Record<string, string>, config: AuthConfig): Record<string, string> {
  const result = { ...headers };

  switch (config.scheme) {
    case 'bearer':
      if (config.token) {
        result['Authorization'] = `Bearer ${config.token}`;
      }
      break;

    case 'api-key-header':
      if (config.apiKey) {
        result['X-API-Key'] = config.apiKey;
      }
      break;

    case 'proprietary':
      // Custom headers for proprietary schemes
      if (config.customHeaders) {
        Object.assign(result, config.customHeaders);
      }
      break;
  }

  return result;
}

/**
 * Extracts authentication from headers.
 * @param headers HTTP headers
 * @returns Auth configuration or undefined
 */
export function extractAuth(headers: Record<string, string>): AuthConfig | undefined {
  // Check for Bearer token
  const authHeader = headers['Authorization'] || headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    return {
      scheme: 'bearer',
      token: authHeader.substring(7)
    };
  }

  // Check for API key header
  const apiKeyHeader = headers['X-API-Key'] || headers['x-api-key'];
  if (apiKeyHeader) {
    return {
      scheme: 'api-key-header',
      apiKey: apiKeyHeader
    };
  }

  return undefined;
}
