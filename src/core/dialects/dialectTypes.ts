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
  | 'tabnine.proprietary';

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
