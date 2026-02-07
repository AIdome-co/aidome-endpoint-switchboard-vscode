/**
 * Dialect detection from API responses and configuration.
 */

import { Dialect, DialectInference } from './dialectTypes';
import type { AIdomeCapabilities } from '../aidome/types';
import type { AssistantEntry } from '../registry/registryTypes';

/**
 * Detects the dialect from an API response structure.
 * @param response The API response object
 * @returns Detected dialect or undefined
 */
export function detectDialectFromResponse(response: unknown): Dialect | undefined {
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }

  const obj = response as Record<string, unknown>;

  // OpenAI chat completions has 'choices' array
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const choice = obj.choices[0] as Record<string, unknown>;
    if ('message' in choice) {
      return 'openai.chat_completions';
    }
  }

  // Anthropic messages has 'content' array and 'role'
  if (Array.isArray(obj.content) && 'role' in obj) {
    return 'anthropic.messages';
  }

  return undefined;
}

/**
 * Detects dialect from endpoint URL patterns.
 * @param url The endpoint URL
 * @returns Detected dialect or undefined
 */
export function detectDialectFromUrl(url: string): Dialect | undefined {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    if (path.includes('/v1/chat/completions')) {
      return 'openai.chat_completions';
    }
    if (path.includes('/v1/messages')) {
      return 'anthropic.messages';
    }
    if (path.includes('generateContent')) {
      return 'google.gemini.generate_content';
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Infers dialect from AIdome capabilities response.
 * @param capabilities AIdome capabilities
 * @returns Dialect inference or undefined
 */
export function inferDialectFromCapabilities(capabilities: AIdomeCapabilities): DialectInference | undefined {
  if (!capabilities.supportedDialects || capabilities.supportedDialects.length === 0) {
    return undefined;
  }

  // Use first supported dialect with high confidence
  const dialectStr = capabilities.supportedDialects[0];
  const dialect = dialectStr as Dialect;
  
  return {
    dialect,
    confidence: 'high',
    source: 'aidome-capabilities'
  };
}

/**
 * Infers dialect from assistant registry entry.
 * @param assistant Assistant registry entry
 * @returns Dialect inference
 */
export function inferDialectFromRegistry(assistant: AssistantEntry): DialectInference {
  const primaryDialect = assistant.dialect.primary as Dialect;
  
  return {
    dialect: primaryDialect,
    confidence: 'high',
    source: 'registry-expected'
  };
}

/**
 * Infers dialect from user selection (override).
 * @param dialect User-selected dialect
 * @returns Dialect inference
 */
export function inferDialectFromUserSelection(dialect: Dialect): DialectInference {
  return {
    dialect,
    confidence: 'high',
    source: 'user-override'
  };
}

/**
 * Infers dialect from URL pattern.
 * @param url Endpoint URL
 * @returns Dialect inference or undefined
 */
export function inferDialectFromUrlPattern(url: string): DialectInference | undefined {
  const detected = detectDialectFromUrl(url);
  
  if (!detected) {
    return undefined;
  }
  
  return {
    dialect: detected,
    confidence: 'medium',
    source: 'url-pattern'
  };
}

/**
 * Comprehensive dialect inference from multiple sources.
 * Priority: user override > AIdome capabilities > registry > URL pattern > default
 * @param options Inference options
 * @returns Dialect inference
 */
export function inferDialect(options: {
  userSelection?: Dialect;
  capabilities?: AIdomeCapabilities;
  assistant?: AssistantEntry;
  endpointUrl?: string;
}): DialectInference {
  const { userSelection, capabilities, assistant, endpointUrl } = options;

  // Priority 1: User override
  if (userSelection) {
    return inferDialectFromUserSelection(userSelection);
  }

  // Priority 2: AIdome capabilities
  if (capabilities) {
    const inferred = inferDialectFromCapabilities(capabilities);
    if (inferred) {
      return inferred;
    }
  }

  // Priority 3: Registry expected dialect
  if (assistant) {
    return inferDialectFromRegistry(assistant);
  }

  // Priority 4: URL pattern
  if (endpointUrl) {
    const inferred = inferDialectFromUrlPattern(endpointUrl);
    if (inferred) {
      return inferred;
    }
  }

  // Default fallback
  return {
    dialect: 'openai.chat_completions',
    confidence: 'low',
    source: 'default'
  };
}
