/**
 * Rules and validation for dialect compatibility.
 */

import { Dialect, DialectCompatibility, DialectRule } from './dialectTypes';

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

/**
 * Dialect rules mapping.
 */
const DIALECT_RULES: Record<Dialect, DialectRule> = {
  'openai.chat_completions': {
    dialect: 'openai.chat_completions',
    requiredEndpoints: ['/v1/chat/completions'],
    authScheme: 'bearer',
    supportsStreaming: true,
    requiredHeaders: {
      'Content-Type': 'application/json'
    }
  },
  'openai.responses': {
    dialect: 'openai.responses',
    requiredEndpoints: ['/v1/responses'],
    authScheme: 'bearer',
    supportsStreaming: false,
    requiredHeaders: {
      'Content-Type': 'application/json'
    }
  },
  'anthropic.messages': {
    dialect: 'anthropic.messages',
    requiredEndpoints: ['/v1/messages'],
    authScheme: 'api-key-header',
    supportsStreaming: true,
    requiredHeaders: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    }
  },
  'google.gemini.generate_content': {
    dialect: 'google.gemini.generate_content',
    requiredEndpoints: ['generateContent'],
    authScheme: 'query-param',
    supportsStreaming: true,
    requiredHeaders: {
      'Content-Type': 'application/json'
    }
  },
  'github.copilot': {
    dialect: 'github.copilot',
    requiredEndpoints: ['/v1/completions'],
    authScheme: 'proprietary',
    supportsStreaming: true
  },
  'tabnine.proprietary': {
    dialect: 'tabnine.proprietary',
    requiredEndpoints: ['/completions'],
    authScheme: 'proprietary',
    supportsStreaming: false
  },
  'unknown': {
    dialect: 'unknown',
    requiredEndpoints: [],
    authScheme: 'bearer',
    supportsStreaming: false
  }
};

/**
 * Gets the dialect rule for a specific dialect.
 * @param dialect The dialect
 * @returns The dialect rule
 */
export function getDialectRule(dialect: Dialect): DialectRule {
  return DIALECT_RULES[dialect] || DIALECT_RULES['unknown'];
}

/**
 * Gets all defined dialect rules.
 * @returns Array of all dialect rules
 */
export function getAllDialectRules(): DialectRule[] {
  return Object.values(DIALECT_RULES);
}
