/**
 * Rules and validation for dialect compatibility.
 */

import { Dialect, DialectCompatibility } from './dialectTypes';

/**
 * Checks if two dialects are compatible.
 * @param source Source dialect
 * @param target Target dialect
 * @returns Compatibility information
 */
export function checkDialectCompatibility(source: Dialect, target: Dialect): DialectCompatibility {
  // Exact match is always compatible
  if (source === target) {
    return {
      sourceDialect: source,
      targetDialect: target,
      compatible: true,
      requiresTranslation: false
    };
  }

  // OpenAI dialects are compatible with each other
  if (source.startsWith('openai.') && target.startsWith('openai.')) {
    return {
      sourceDialect: source,
      targetDialect: target,
      compatible: true,
      requiresTranslation: true,
      notes: 'OpenAI dialects can be translated between each other'
    };
  }

  // Default: not compatible
  return {
    sourceDialect: source,
    targetDialect: target,
    compatible: false,
    requiresTranslation: false,
    notes: 'No direct compatibility between these dialects'
  };
}

/**
 * Gets the recommended target dialect for a gateway.
 * @param assistantDialect The assistant's preferred dialect
 * @returns Recommended gateway dialect
 */
export function getRecommendedGatewayDialect(assistantDialect: Dialect): Dialect {
  // Default to OpenAI chat completions as it's most widely supported
  if (assistantDialect.startsWith('openai.')) {
    return 'openai.chat_completions';
  }
  
  // Otherwise return the assistant's primary dialect
  return assistantDialect;
}
