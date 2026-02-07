/**
 * Type definitions for LLM API dialects.
 * Dialects represent different API protocols (OpenAI, Anthropic, etc.).
 */

/**
 * Supported LLM API dialects.
 */
export type Dialect = 
  | 'openai.chat_completions'
  | 'openai.responses'
  | 'anthropic.messages'
  | 'google.gemini.generate_content'
  | 'github.copilot'
  | 'tabnine.proprietary'
  | 'unknown';

/**
 * Authentication scheme for an API.
 */
export type AuthScheme = 
  | 'bearer'
  | 'api-key-header'
  | 'query-param'
  | 'oauth2'
  | 'proprietary';

/**
 * Dialect definition with metadata.
 */
export interface DialectDefinition {
  key: Dialect;
  displayName: string;
  description: string;
  authScheme: AuthScheme;
  commonHeaders?: Record<string, string>;
  requiresApiKey: boolean;
  supportsStreaming: boolean;
}

/**
 * Dialect compatibility information.
 */
export interface DialectCompatibility {
  sourceDialect: Dialect;
  targetDialect: Dialect;
  compatible: boolean;
  requiresTranslation: boolean;
  notes?: string;
}

/**
 * Rule definition for a specific dialect.
 */
export interface DialectRule {
  dialect: Dialect;
  requiredEndpoints: string[];
  authScheme: AuthScheme;
  supportsStreaming: boolean;
  requiredHeaders?: Record<string, string>;
}

/**
 * Dialect inference result with confidence level.
 */
export interface DialectInference {
  dialect: Dialect;
  confidence: 'high' | 'medium' | 'low';
  source: 'aidome-capabilities' | 'registry-expected' | 'user-override' | 'url-pattern' | 'default';
}
