/**
 * Authentication scheme implementations for different dialects.
 */

import { AuthScheme, Dialect } from './dialectTypes';

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

/**
 * Maps dialect to authentication scheme and generates headers.
 * @param dialect The dialect
 * @param apiKey The API key or token
 * @returns Headers object ready to apply
 */
export function getAuthHeadersForDialect(dialect: Dialect, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {};

  switch (dialect) {
    case 'openai.chat_completions':
    case 'openai.responses':
      // Bearer token
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;

    case 'anthropic.messages':
      // x-api-key header
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      break;

    case 'google.gemini.generate_content':
      // API key can be in header or query param
      // For header variant:
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;

    case 'github.copilot':
    case 'tabnine.proprietary':
      // Proprietary schemes - handle separately
      break;

    default:
      // Default to Bearer
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
  }

  return headers;
}

/**
 * Gets the authentication scheme for a dialect.
 * @param dialect The dialect
 * @returns The authentication scheme
 */
export function getAuthSchemeForDialect(dialect: Dialect): AuthScheme {
  switch (dialect) {
    case 'openai.chat_completions':
    case 'openai.responses':
      return 'bearer';

    case 'anthropic.messages':
      return 'api-key-header';

    case 'google.gemini.generate_content':
      return 'query-param';

    case 'github.copilot':
    case 'tabnine.proprietary':
      return 'proprietary';

    default:
      return 'bearer';
  }
}
